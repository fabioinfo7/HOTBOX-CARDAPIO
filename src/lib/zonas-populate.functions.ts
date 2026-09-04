// Varredura automática de ruas ao redor da loja.
//
// Roda em duas etapas separadas (chamadas diferentes) de propósito: buscar
// as ruas candidatas no Overpass é rápido (uma chamada só), mas medir a
// distância de carro de cada rua até a loja via OSRM é lento (uma chamada
// por rua, com limite de taxa do servidor público). Se fizesse tudo numa
// função só, uma área grande facilmente estouraria o tempo limite da function
// serverless. Por isso o cliente busca a lista uma vez (fetchOverpassCandidatesFn)
// e processa em lotes pequenos (resolveZonaBatchFn), com barra de progresso.

import { createServerFn } from "@tanstack/react-start";
import {
  getRoadDistanceKm,
  loadTiers,
  pickTier,
  waitForNominatimSlot,
  type DeliveryConfig,
} from "./delivery-distance.server";
import { normalizeStreet, similarity } from "./zonas-entrega.server";

export type ZonaCandidate = { rua: string; lat: number; lng: number; bairro?: string | null };

/** Confere se um bairro (com pequena tolerância a erro de digitação/acento) está na lista de atendidos. */
function isBairroAtendido(bairro: string | null | undefined, bairrosAtendidos: string[]): boolean {
  const norm = normalizeStreet(bairro ?? "");
  if (!norm) return false;
  return bairrosAtendidos.some((b) => {
    const nb = normalizeStreet(b);
    if (!nb) return false;
    if (nb === norm || norm.includes(nb) || nb.includes(norm)) return true;
    return similarity(norm, nb) >= 0.72;
  });
}

/** Prefixos de logradouro — normaliza pra deduplicar "Rua X" e "R. X" como a mesma rua. */
function streetKey(name: string): string {
  const n = normalizeStreet(name);
  const parts = n.split(" ");
  const prefixes = ["rua", "r", "avenida", "av", "travessa", "tv", "estrada", "est", "alameda", "al"];
  if (parts.length > 1 && prefixes.includes(parts[0])) return parts.slice(1).join(" ");
  return n;
}

/** Chave combinada bairro+rua — é essa que identifica uma rua de forma
 *  única, não o nome da rua sozinho. Nomes de rua se repetem entre bairros
 *  diferentes o tempo todo no Brasil ("Rua das Flores" em dois bairros são
 *  ruas DIFERENTES) — usar só o nome da rua como chave fazia o sistema
 *  tratar essas ruas como duplicata uma da outra e ignorar a segunda. */
function ruaBairroKey(rua: string, bairro: string | null | undefined): string {
  return `${normalizeStreet(bairro ?? "")}||${streetKey(rua)}`;
}

const OVERPASS_SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const OVERPASS_HEADERS = {
  "Content-Type": "text/plain; charset=UTF-8",
  Accept: "application/json",
  "User-Agent": "HotBoxDelivery/1.0 (povoamento de zonas de entrega)",
};

/** Manda a query pros servidores públicos do Overpass, com espelho de reserva. */
async function queryOverpass(query: string): Promise<{ json?: any; error?: string; status?: number | null }> {
  let res: Response | null = null;
  let lastStatus: number | null = null;
  for (const server of OVERPASS_SERVERS) {
    try {
      const attempt = await fetch(server, {
        method: "POST",
        body: query,
        headers: OVERPASS_HEADERS,
        signal: AbortSignal.timeout(30000),
      });
      if (attempt.ok) {
        res = attempt;
        break;
      }
      lastStatus = attempt.status;
    } catch {
      continue;
    }
  }
  if (!res) {
    const timeoutHint =
      lastStatus === 504 || lastStatus == null
        ? " O servidor público está sobrecarregado agora — costuma normalizar sozinho, tente de novo em alguns minutos."
        : "";
    return {
      status: lastStatus,
      error: `A busca de ruas (Overpass) falhou${lastStatus ? ` (${lastStatus})` : ""}.${timeoutHint || " Tente de novo em alguns minutos."}`,
    };
  }
  try {
    const json = await res.json();
    return { json };
  } catch {
    return { error: "O Overpass devolveu uma resposta inválida. Tente de novo." };
  }
}

/**
 * Etapa 1 — busca no Overpass (OpenStreetMap) todas as vias com nome dentro
 * de um raio em linha reta ao redor da loja, e devolve UMA candidata por
 * nome de rua (o ponto médio do primeiro segmento encontrado — suficiente
 * pra medir a distância; se a rua for muito comprida e cruzar faixas de
 * preço diferentes, dá pra editar manualmente depois na tela de zonas).
 *
 * Usada só quando NENHUM bairro atendido está cadastrado ainda (sem lista
 * pra orientar a busca, o sistema não tem escolha e varre por raio). Assim
 * que há bairros cadastrados, o povoamento usa fetchOverpassCandidatesForBairroFn
 * (busca por bairro, ver abaixo), que cobre muito mais ruas dentro deles.
 */
export const fetchOverpassCandidatesFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logApi } = await import("./api-log.server");

  const { data: cfg } = await supabaseAdmin
    .from("store_config")
    .select("store_lat, store_lng, delivery_fee_tiers")
    .maybeSingle();

  if (cfg?.store_lat == null || cfg?.store_lng == null) {
    return {
      error: "Endereço da loja ainda não tem coordenadas. Busque as coordenadas em Configurações → Entrega primeiro.",
    };
  }

  const lat = Number(cfg.store_lat);
  const lng = Number(cfg.store_lng);

  const tiers = await loadTiers(supabaseAdmin, { delivery_fee_tiers: cfg.delivery_fee_tiers ?? [] } as DeliveryConfig);
  const maxKm = tiers.length ? Math.max(...tiers.map((t) => t.km_to)) : 8; // sem faixa configurada ainda: raio padrão de 8km
  // raio em linha reta maior que o alcance máximo configurado, porque rua
  // nunca é reta — 1.5x cobre bem a diferença na maioria das cidades.
  // Capado em 15km de raio: acima disso a consulta fica pesada demais pro
  // servidor público responder a tempo (504) — se as faixas passarem disso,
  // melhor rodar o povoamento de novo depois de ajustar as faixas.
  const radiusMeters = Math.min(Math.round(maxKm * 1.5 * 1000), 15000);

  // "out center" pede só o ponto central de cada rua (um par lat/lng), em vez
  // da geometria completa ("out geom", que devolve TODOS os pontos do
  // traçado) — é isso que causava o 504: a resposta ficava grande demais e o
  // servidor estourava o tempo limite antes de terminar. Com "out center" a
  // resposta fica uma fração do tamanho e é rápida mesmo em raios grandes.
  const query = `[out:json][timeout:25];way["highway"]["name"](around:${radiusMeters},${lat},${lng});out center;`;

  try {
    const { json, error, status } = await queryOverpass(query);
    if (error || !json) {
      await logApi(supabaseAdmin, {
        source: "zonas_populate_overpass",
        direction: "out",
        request_payload: { radiusMeters, lat, lng },
        error_message: error ?? `Overpass retornou ${status ?? "sem resposta"}`,
      });
      return { error: error ?? "A busca de ruas (Overpass) falhou." };
    }

    const ways = (json?.elements ?? []).filter((el: any) => el.type === "way" && el.tags?.name && el.center);

    const byKey = new Map<string, ZonaCandidate>();
    for (const way of ways) {
      const key = streetKey(way.tags.name);
      if (!key || byKey.has(key)) continue;
      // Algumas vias já vêm com o bairro na própria tag do OSM — aproveita
      // de graça (mesma resposta que já veio), sem gastar chamada extra.
      const bairro = way.tags["addr:suburb"] ?? way.tags["addr:neighbourhood"] ?? way.tags["addr:district"] ?? null;
      byKey.set(key, { rua: way.tags.name, lat: way.center.lat, lng: way.center.lon, bairro });
    }

    const candidates = Array.from(byKey.values());

    await logApi(supabaseAdmin, {
      source: "zonas_populate_overpass",
      direction: "out",
      request_payload: { radiusMeters, lat, lng },
      response_status: 200,
      response_body: `${candidates.length} ruas encontradas`,
    });

    return { candidates, radiusMeters };
  } catch (err: any) {
    await logApi(supabaseAdmin, {
      source: "zonas_populate_overpass",
      direction: "out",
      request_payload: { radiusMeters, lat, lng },
      error_message: String(err?.message ?? err),
    });
    return { error: "A busca de ruas (Overpass) não respondeu a tempo. Tente de novo em alguns minutos." };
  }
});

/** Devolve os nomes dos bairros atendidos ativos (Configurações → Bairros
 *  atendidos), pro cliente decidir se faz a varredura por bairro ou por raio. */
export const fetchBairrosAtendidosFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const { data } = await (supabaseAdmin as any).from("bairros_atendidos").select("nome").eq("ativo", true);
    return { bairros: (data ?? []).map((r: any) => String(r.nome)).filter(Boolean) };
  } catch {
    return { bairros: [] as string[] };
  }
});

type BairroArea =
  | { mode: "area"; areaId: number; lat: number; lng: number }
  | { mode: "bbox"; south: number; west: number; north: number; east: number; lat: number; lng: number }
  | { mode: "point"; lat: number; lng: number };

/** Tenta achar o bairro no Nominatim (busca estruturada por endereço). */
async function findBairroAreaNominatim(bairro: string, city: string): Promise<BairroArea | null> {
  await waitForNominatimSlot();
  const q = `${bairro}, ${city} - RJ, Brasil`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HotBoxDelivery/1.0 (povoamento de zonas de entrega)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const results: any[] = await res.json();
    if (!Array.isArray(results) || !results.length) return null;

    // prefere um resultado que seja de fato uma área administrativa/bairro
    // (não uma rua ou estabelecimento avulso com o mesmo nome)
    const areaLike = results.find(
      (r) =>
        (r.class === "boundary" && r.type === "administrative") ||
        (r.class === "place" && ["suburb", "neighbourhood", "quarter", "city_district"].includes(r.type)),
    );
    const chosen = areaLike ?? results[0];
    const lat = Number(chosen.lat);
    const lng = Number(chosen.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    if (areaLike && (areaLike.osm_type === "relation" || areaLike.osm_type === "way")) {
      // convenção do Overpass: id da área = 3600000000 + id da relation, ou
      // 2400000000 + id da way (quando o polígono é fechado por uma via só)
      const areaId =
        areaLike.osm_type === "relation" ? 3600000000 + Number(areaLike.osm_id) : 2400000000 + Number(areaLike.osm_id);
      return { mode: "area", areaId, lat, lng };
    }
    return { mode: "point", lat, lng };
  } catch {
    return null;
  }
}

/**
 * Segunda fonte, só usada quando o Nominatim não achou nada — Photon
 * (komoot.io) é gratuito, sem chave, e também usa dado do OpenStreetMap,
 * mas com um motor de busca diferente (tolera erro de digitação, aceita
 * busca livre) — em vários casos acha bairros que a busca estruturada do
 * Nominatim não encontrou. Tem limite de uso razoável (não documentado
 * oficialmente), por isso só é chamado como fallback, não em paralelo.
 */
async function findBairroAreaPhoton(bairro: string, city: string, storeLat: number, storeLng: number): Promise<BairroArea | null> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${bairro}, ${city}`)}&lat=${storeLat}&lon=${storeLng}&limit=5&lang=pt`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HotBoxDelivery/1.0 (povoamento de zonas de entrega)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const features: any[] = json?.features ?? [];
    if (!features.length) return null;

    const areaLike = features.find((f) => {
      const p = f.properties ?? {};
      return (
        (p.osm_key === "boundary" && p.osm_value === "administrative") ||
        (p.osm_key === "place" && ["suburb", "neighbourhood", "quarter", "city_district"].includes(p.osm_value))
      );
    });
    const chosen = areaLike ?? features[0];
    const [lng, lat] = chosen.geometry?.coordinates ?? [null, null];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // "extent" é um bbox [oeste, norte, leste, sul] — só vem preenchido pra
    // resultados que são de fato uma área (não um ponto avulso).
    const extent = (areaLike ?? chosen).properties?.extent;
    if (Array.isArray(extent) && extent.length === 4) {
      const [west, north, east, south] = extent.map(Number);
      if ([west, north, east, south].every(Number.isFinite)) {
        return { mode: "bbox", west, north, east, south, lat, lng };
      }
    }
    return { mode: "point", lat, lng };
  } catch {
    return null;
  }
}

/**
 * Busca no Nominatim (e, se não achar, no Photon como segunda tentativa
 * gratuita) o polígono/área de um bairro pra restringir a varredura a ele.
 * Nem todo bairro brasileiro tem área mapeada no OpenStreetMap (muitos
 * bairros informais não têm) — quando nenhuma das duas fontes acha um
 * polígono, cai pra um raio de 1.5km ao redor do centro do bairro (ainda
 * assim, muito mais preciso que varrer a cidade toda).
 */
async function findBairroArea(
  bairro: string,
  city: string,
): Promise<{ area: BairroArea; source: "nominatim" | "photon" } | null> {
  const fromNominatim = await findBairroAreaNominatim(bairro, city);
  if (fromNominatim) return { area: fromNominatim, source: "nominatim" };

  // só recorre ao Photon quando o Nominatim não achou NADA — evita gastar
  // chamada à toa quando a primeira fonte já resolveu.
  // Usa as coordenadas da loja como referência de proximidade (viés de
  // localização), já que ainda não temos um ponto melhor pra essa busca.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cfg } = await supabaseAdmin.from("store_config").select("store_lat, store_lng").maybeSingle();
  const storeLat = cfg?.store_lat != null ? Number(cfg.store_lat) : -22.79;
  const storeLng = cfg?.store_lng != null ? Number(cfg.store_lng) : -43.31;
  const fromPhoton = await findBairroAreaPhoton(bairro, city, storeLat, storeLng);
  if (fromPhoton) return { area: fromPhoton, source: "photon" };

  return null;
}

/**
 * Busca todas as ruas nomeadas DENTRO de um bairro específico — usada
 * quando já existem bairros atendidos cadastrados, pra varrer o máximo de
 * ruas possível ali dentro, em vez de depender de um raio a partir da loja
 * (que pode deixar ruas de fora, ou trazer ruas de bairros que não são
 * atendidos).
 */
export const fetchOverpassCandidatesForBairroFn = createServerFn({ method: "POST" })
  .inputValidator((data: { bairro: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logApi } = await import("./api-log.server");

    const { data: cfg } = await supabaseAdmin.from("store_config").select("fixed_delivery_city").maybeSingle();
    const city = cfg?.fixed_delivery_city || "Duque de Caxias";

    const found = await findBairroArea(data.bairro, city);
    if (!found) {
      return { error: `Não consegui localizar o bairro "${data.bairro}" — confira se o nome está escrito certo.` };
    }
    const { area, source } = found;

    function parseCandidates(json: any): ZonaCandidate[] {
      const ways = (json?.elements ?? []).filter((el: any) => el.type === "way" && el.tags?.name && el.center);
      const byKey = new Map<string, ZonaCandidate>();
      for (const way of ways) {
        const key = streetKey(way.tags.name);
        if (!key || byKey.has(key)) continue;
        // já sabemos exatamente qual bairro é (foi ele que buscamos) — não
        // precisa nem confiar na tag do OSM nem gastar reverse-geocoding depois.
        byKey.set(key, { rua: way.tags.name, lat: way.center.lat, lng: way.center.lon, bairro: data.bairro });
      }
      return Array.from(byKey.values());
    }

    function mergeCandidates(base: ZonaCandidate[], extra: ZonaCandidate[]): ZonaCandidate[] {
      const seen = new Set(base.map((c) => streetKey(c.rua)));
      const merged = [...base];
      for (const c of extra) {
        const key = streetKey(c.rua);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(c);
      }
      return merged;
    }

    const primaryQuery =
      area.mode === "area"
        ? `[out:json][timeout:25];area(${area.areaId})->.a;way(area.a)["highway"]["name"];out center;`
        : area.mode === "bbox"
          ? `[out:json][timeout:25];way["highway"]["name"](${area.south},${area.west},${area.north},${area.east});out center;`
          : // nenhuma das duas fontes achou um polígono/bbox pro bairro: já
            // começa pelo raio de 1.5km ao redor do centro dele
            `[out:json][timeout:25];way["highway"]["name"](around:1500,${area.lat},${area.lng});out center;`;

    const primary = await queryOverpass(primaryQuery);
    if (primary.error || !primary.json) {
      await logApi(supabaseAdmin, {
        source: "zonas_populate_overpass_bairro",
        direction: "out",
        request_payload: { bairro: data.bairro, areaMode: area.mode, foundBy: source },
        error_message: primary.error ?? `Overpass retornou ${primary.status ?? "sem resposta"}`,
      });
      return { error: primary.error ?? `A busca de ruas em "${data.bairro}" falhou.` };
    }

    let candidates = parseCandidates(primary.json);
    let usedFallbackRadius: number | null = null;

    // A área/bbox encontrada trouxe pouca ou nenhuma rua — isso é o que
    // costuma deixar bairros inteiros sem nenhuma rua listada (polígono
    // impreciso, geometria com furo, ou o bairro mal mapeado no OSM).
    // Em vez de aceitar isso, complementa SEMPRE com uma busca por raio ao
    // redor do centro do bairro, mesclando o que achar (sem duplicar) —
    // e se ainda estiver vazio, tenta de novo com um raio maior.
    const MIN_STREETS = 4;
    if (area.mode !== "point" && candidates.length < MIN_STREETS) {
      const radius1 = await queryOverpass(
        `[out:json][timeout:25];way["highway"]["name"](around:1500,${area.lat},${area.lng});out center;`,
      );
      if (radius1.json) {
        candidates = mergeCandidates(candidates, parseCandidates(radius1.json));
        usedFallbackRadius = 1500;
      }
    }
    if (candidates.length === 0) {
      const radius2 = await queryOverpass(
        `[out:json][timeout:25];way["highway"]["name"](around:3000,${area.lat},${area.lng});out center;`,
      );
      if (radius2.json) {
        candidates = mergeCandidates(candidates, parseCandidates(radius2.json));
        usedFallbackRadius = 3000;
      }
    }

    await logApi(supabaseAdmin, {
      source: "zonas_populate_overpass_bairro",
      direction: "out",
      request_payload: { bairro: data.bairro, areaMode: area.mode, foundBy: source, usedFallbackRadius },
      response_status: 200,
      response_body: `${candidates.length} ruas encontradas`,
    });

    return { candidates, areaMode: area.mode, foundBy: source, usedFallbackRadius };
  });

/**
 * Etapa 2 — recebe um lote pequeno de candidatas (o cliente chama isso
 * repetidamente, avançando pela lista inteira) e para cada uma: mede a
 * distância de carro real até a loja (reaproveitando getRoadDistanceKm, a
 * MESMA função usada no cálculo dinâmico de frete), classifica na faixa
 * correspondente, e grava/atualiza em zonas_entrega.
 */
/**
 * Descobre o bairro a partir de um ponto (lat/lng) via reverse-geocoding no
 * Nominatim. Respeita o mesmo limite de 1 requisição/segundo já usado no
 * cálculo dinâmico de frete (waitForNominatimSlot) — por isso essa busca
 * roda em sequência, uma rua de cada vez, nunca em paralelo.
 */
async function reverseGeocodeBairro(lat: number, lng: number): Promise<string | null> {
  try {
    await waitForNominatimSlot();
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "HotBoxDelivery/1.0 (povoamento de zonas de entrega)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const addr = json?.address ?? {};
    return addr.suburb ?? addr.neighbourhood ?? addr.city_district ?? addr.quarter ?? null;
  } catch {
    return null;
  }
}

export const resolveZonaBatchFn = createServerFn({ method: "POST" })
  .inputValidator((data: { candidates: ZonaCandidate[] }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select("store_lat, store_lng, delivery_fee_tiers")
      .maybeSingle();
    if (cfg?.store_lat == null || cfg?.store_lng == null) {
      return { error: "Endereço da loja sem coordenadas." };
    }
    const storeLat = Number(cfg.store_lat);
    const storeLng = Number(cfg.store_lng);
    const tiers = await loadTiers(supabaseAdmin, {
      delivery_fee_tiers: cfg.delivery_fee_tiers ?? [],
    } as DeliveryConfig);

    // Lista oficial de bairros atendidos (Configurações → Bairros atendidos).
    // Quando existe pelo menos 1 bairro ativo cadastrado, a varredura só
    // adiciona/mantém ruas desses bairros — mesmo que estejam dentro do
    // raio de km configurado. Sem isso, a varredura pega qualquer rua no
    // raio, mesmo em bairros que a loja não atende de verdade.
    let bairrosAtendidos: string[] = [];
    try {
      const { data: bairrosRows } = await (supabaseAdmin as any).from("bairros_atendidos").select("nome").eq("ativo", true);
      bairrosAtendidos = (bairrosRows ?? []).map((r: any) => String(r.nome)).filter(Boolean);
    } catch {
      // tabela ainda não existe — segue sem restringir por bairro
    }

    // já cadastradas — evita duplicar rua que já existe na tabela. Chave é
    // bairro+rua (não só rua — ver comentário de ruaBairroKey acima), pra
    // não confundir ruas de mesmo nome em bairros diferentes.
    const { data: existingRows } = await supabaseAdmin.from("zonas_entrega").select("id, rua, bairro");
    const existingByKey = new Map<string, { id: string; bairro: string | null }>();
    for (const row of existingRows ?? []) existingByKey.set(ruaBairroKey(row.rua, row.bairro), { id: row.id, bairro: row.bairro });

    let added = 0;
    let updated = 0;
    let outOfRange = 0;
    let foraDoBairro = 0;
    let assignedMaxTier = 0;
    let failed = 0;
    // Faixa de maior alcance cadastrada — usada como aproximação quando uma
    // rua está confirmadamente num bairro atendido mas a distância de
    // carro calculada passa da maior faixa configurada (ex: rota real deu
    // uma volta maior que o esperado). Sem isso, a rua seria descartada
    // mesmo estando no bairro certo — o que vai contra "buscar o máximo de
    // ruas nesses bairros": bairro cadastrado é o que manda, a faixa de km
    // só decide o preço.
    const maxTier = tiers.length ? tiers.reduce((a, b) => (b.km_to > a.km_to ? b : a)) : null;
    // Ruas que ficaram sem bairro nessa passada (nem o OSM tinha a tag, nem
    // já existia um salvo) — resolvidas depois, uma a uma.
    const needsBairro: { id: string; lat: number; lng: number; wasNew: boolean }[] = [];

    // concorrência pequena (5 por vez) pra não sobrecarregar o servidor
    // público de rotas — suficiente pra um lote processar rápido sem levar
    // bloqueio por excesso de requisições
    const CONCURRENCY = 5;
    for (let i = 0; i < data.candidates.length; i += CONCURRENCY) {
      const slice = data.candidates.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (candidate) => {
          try {
            // Já sabemos o bairro (veio taggeado no OSM, ou veio da busca
            // por bairro) e ele não está na lista de atendidos — nem vale a
            // pena gastar chamada de rota.
            const bairroConfirmadoAtendido =
              bairrosAtendidos.length > 0 && !!candidate.bairro && isBairroAtendido(candidate.bairro, bairrosAtendidos);
            if (bairrosAtendidos.length && candidate.bairro && !bairroConfirmadoAtendido) {
              foraDoBairro++;
              return;
            }
            const km = await getRoadDistanceKm(storeLat, storeLng, candidate.lat, candidate.lng);
            if (km == null) {
              failed++;
              return;
            }
            let { tier, outOfArea } = pickTier(tiers, km);
            if (outOfArea) {
              if (bairroConfirmadoAtendido && maxTier) {
                // bairro confirmado como atendido — não descarta, usa a
                // faixa de maior alcance como aproximação de preço.
                tier = maxTier;
                outOfArea = false;
                assignedMaxTier++;
              } else {
                outOfRange++;
                return;
              }
            }
            const key = ruaBairroKey(candidate.rua, candidate.bairro);
            const existingZona = existingByKey.get(key);
            if (existingZona) {
              await supabaseAdmin
                .from("zonas_entrega")
                .update({
                  distancia_km: km,
                  faixa_id: tier?.id ?? null,
                  lat: candidate.lat,
                  lng: candidate.lng,
                  // só preenche o bairro se a rua ainda não tinha um — nunca
                  // sobrescreve um valor já existente (pode ter sido
                  // corrigido manualmente).
                  ...(!existingZona.bairro && candidate.bairro ? { bairro: candidate.bairro } : {}),
                })
                .eq("id", existingZona.id);
              updated++;
              if (!existingZona.bairro && !candidate.bairro) {
                needsBairro.push({ id: existingZona.id, lat: candidate.lat, lng: candidate.lng, wasNew: false });
              }
            } else {
              const { data: inserted } = await supabaseAdmin
                .from("zonas_entrega")
                .insert({
                  rua: candidate.rua,
                  bairro: candidate.bairro ?? null,
                  distancia_km: km,
                  faixa_id: tier?.id ?? null,
                  lat: candidate.lat,
                  lng: candidate.lng,
                  entrega_disponivel: true,
                })
                .select("id")
                .single();
              added++;
              if (inserted?.id && !candidate.bairro) {
                needsBairro.push({ id: inserted.id, lat: candidate.lat, lng: candidate.lng, wasNew: true });
              }
            }
          } catch {
            failed++;
          }
        }),
      );
    }

    // Segunda fase: busca o bairro por reverse-geocoding pra quem ficou sem
    // — sequencial de propósito (1 requisição/segundo, limite do Nominatim).
    // É essa parte que deixa o povoamento mais lento, mas evita levar bloqueio
    // do servidor gratuito por excesso de requisições simultâneas.
    for (const item of needsBairro) {
      const bairro = await reverseGeocodeBairro(item.lat, item.lng);
      if (!bairro) continue;
      if (bairrosAtendidos.length && !isBairroAtendido(bairro, bairrosAtendidos)) {
        // só descobrimos o bairro real depois de já ter inserido/atualizado
        // a rua (o bairro não veio taggeado no OSM) — como não é um bairro
        // atendido, desfaz o registro em vez de manter uma rua fora da área.
        await supabaseAdmin.from("zonas_entrega").delete().eq("id", item.id);
        foraDoBairro++;
        if (item.wasNew) added--;
        else updated--;
        continue;
      }
      await supabaseAdmin.from("zonas_entrega").update({ bairro }).eq("id", item.id);
    }

    return { added, updated, outOfRange, foraDoBairro, assignedMaxTier, failed, processed: data.candidates.length };
  });

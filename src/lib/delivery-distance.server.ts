// Geocodifica o endereço do cliente e calcula a distância REAL de rota (não
// linha reta) até a loja, pra bater com as faixas de km configuradas.
//
// Geocoding: usa a API do Google Maps se houver chave configurada (mais
// confiável), ou cai no Nominatim (OpenStreetMap, gratuito, sem chave) — com
// viés geográfico pra perto da loja e restrito à cidade configurada, o que
// reduz muito o erro em endereços informais ou ruas com nome repetido.
//
// Distância: usa dois servidores OSRM independentes (infraestruturas
// diferentes, mesma tecnologia) como redundância real — se um estiver fora
// do ar, tenta o outro antes de cair pra uma estimativa de linha reta.

export type DeliveryTier = { km_from: number; km_to: number; fee: number };

export type DeliveryConfig = {
  delivery_pricing_mode: string;
  store_lat: number | null;
  store_lng: number | null;
  google_maps_api_key: string | null;
  delivery_fee_tiers: DeliveryTier[];
  default_delivery_fee: number;
  fixed_delivery_city?: string | null;
};

/**
 * Reverse-geocoding via Google Maps: dado um ponto (lat/lng), confirma o
 * bairro real segundo o Google — usado pra validar/corrigir o bairro que o
 * OpenStreetMap (Nominatim/Overpass, gratuitos) atribuiu a uma rua durante
 * o povoamento de zonas, já que o Google costuma ter dado de bairro mais
 * preciso pro Brasil. Só é chamado quando há uma chave do Google Maps
 * configurada (é uma API paga, ~US$5 a cada 1000 chamadas depois de uma
 * cota gratuita mensal) — sem chave, o sistema segue confiando só no
 * OpenStreetMap, como já fazia.
 */
export async function reverseGeocodeBairroGoogle(lat: number, lng: number, apiKey: string): Promise<string | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=sublocality|neighborhood&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const result = json?.results?.[0];
    const components: any[] = result?.address_components ?? [];
    return (
      components.find((c) => c.types?.includes("sublocality_level_1"))?.long_name ??
      components.find((c) => c.types?.includes("sublocality"))?.long_name ??
      components.find((c) => c.types?.includes("neighborhood"))?.long_name ??
      null
    );
  } catch {
    return null;
  }
}

async function geocodeGoogle(
  address: string,
  apiKey: string,
  storeLat: number | null,
  storeLng: number | null,
): Promise<{ lat: number; lng: number; bairro: string | null } | null> {
  const bias = storeLat != null && storeLng != null ? `&location=${storeLat},${storeLng}&radius=30000` : "";
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=br${bias}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json: any = await res.json();
  const result = json?.results?.[0];
  const loc = result?.geometry?.location;
  if (!loc) return null;
  const components: any[] = result?.address_components ?? [];
  const bairro =
    components.find((c) => c.types?.includes("sublocality_level_1"))?.long_name ??
    components.find((c) => c.types?.includes("sublocality"))?.long_name ??
    components.find((c) => c.types?.includes("neighborhood"))?.long_name ??
    null;
  return { lat: loc.lat, lng: loc.lng, bairro };
}

// Nominatim só aceita ~1 requisição/segundo — passar disso faz ele recusar a
// consulta (429), mesmo pra endereço válido. Esse throttle garante um
// intervalo mínimo de segurança entre chamadas consecutivas (compartilhado
// entre todas as consultas do processo), e o retry abaixo tenta de novo com
// backoff antes de desistir, em vez de já cravar "não encontrado" na primeira
// recusa por limite de taxa.
let lastNominatimCallAt = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

export async function waitForNominatimSlot() {
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS - elapsed));
  }
  lastNominatimCallAt = Date.now();
}

async function geocodeNominatim(
  address: string,
  storeLat: number | null,
  storeLng: number | null,
): Promise<{ lat: number; lng: number; bairro: string | null } | null> {
  const query = /brasil|brazil/i.test(address) ? address : `${address}, Brasil`;
  const viewbox =
    storeLat != null && storeLng != null
      ? `&viewbox=${storeLng - 0.35},${storeLat + 0.35},${storeLng + 0.35},${storeLat - 0.35}&bounded=0`
      : "";

  // cada tentativa: respeita o intervalo mínimo, e se levar 429 (limite de
  // taxa), espera um pouco mais e tenta de novo (até 2 vezes) antes de
  // desistir dessa URL
  const tryFetch = async (url: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitForNominatimSlot();
      const res = await fetch(url, {
        headers: { "User-Agent": "HotBoxDelivery/1.0 (pedidos automaticos)" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) {
        // limite de taxa — espera crescente (1.5s, 3s) e tenta de novo
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const json: any = await res.json();
      return json?.[0] ?? null;
    }
    return null;
  };

  // addressdetails=1 pra vir o bairro (suburb/neighbourhood) junto — sem
  // custo extra, é o mesmo request que já fazíamos.
  const restrictedUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=br${viewbox}&q=${encodeURIComponent(query)}`;
  let first = await tryFetch(restrictedUrl).catch(() => null);

  // 2ª tentativa: sem a restrição de país/área — alguns endereços (condomínios
  // novos, zona rural, etc.) não estão bem mapeados dentro do filtro do Brasil
  // no Nominatim, e essa restrição pode fazer um endereço válido não ser achado
  if (!first) {
    const openUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
    first = await tryFetch(openUrl).catch(() => null);
  }

  if (!first) return null;
  const addr = first.address ?? {};
  const bairro = addr.suburb ?? addr.neighbourhood ?? addr.city_district ?? addr.quarter ?? null;
  return { lat: Number(first.lat), lng: Number(first.lon), bairro };
}

function buildSearchAddress(rawAddress: string, fixedCity?: string | null): string {
  if (fixedCity && !rawAddress.toLowerCase().includes(fixedCity.toLowerCase())) {
    return `${rawAddress}, ${fixedCity}`;
  }
  return rawAddress;
}

export async function geocodeAddress(
  address: string,
  apiKey: string | null,
  storeLat: number | null = null,
  storeLng: number | null = null,
  fixedCity: string | null = null,
): Promise<{ lat: number; lng: number; bairro: string | null } | null> {
  const fullAddress = buildSearchAddress(address, fixedCity);
  try {
    if (apiKey) {
      const viaGoogle = await geocodeGoogle(fullAddress, apiKey, storeLat, storeLng);
      if (viaGoogle) return viaGoogle;
    }
    return await geocodeNominatim(fullAddress, storeLat, storeLng);
  } catch (err) {
    console.error("[delivery-distance] geocoding falhou:", err);
    return null;
  }
}

// ============================================================
// Cache de geocodificação por cliente — clientes recorrentes pedindo pro
// mesmo endereço não precisam geocodificar de novo (evita gasto de API paga
// e evita ficar refém do limite de taxa do Nominatim pra endereço que já
// sabemos onde fica). Só é usado quando o endereço bate exatamente com o
// último confirmado — qualquer mudança no texto do endereço já invalida o
// cache e geocodifica de novo, então nunca entrega coordenada desatualizada.
// ============================================================

function normalizeAddressForCache(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveDestination(
  customerAddress: string,
  apiKey: string | null,
  storeLat: number | null,
  storeLng: number | null,
  fixedCity: string | null,
  cache?: { supabaseAdmin: any; phone: string },
): Promise<{ lat: number; lng: number; bairro: string | null } | null> {
  const normalized = normalizeAddressForCache(customerAddress);

  if (cache) {
    try {
      const { data: cached } = await cache.supabaseAdmin
        .from("customer_address_cache")
        .select("address_normalized, lat, lng")
        .eq("phone", cache.phone)
        .maybeSingle();
      if (cached && cached.address_normalized === normalized) {
        // O cache guarda só lat/lng (não o bairro) — quem precisar do bairro
        // nesse caminho já deve tê-lo salvo da primeira vez que geocodificou.
        return { lat: Number(cached.lat), lng: Number(cached.lng), bairro: null };
      }
    } catch (err) {
      console.error("[delivery-distance] falha ao ler cache de endereço (segue sem cache):", err);
    }
  }

  const dest = await geocodeAddress(customerAddress, apiKey, storeLat, storeLng, fixedCity);

  if (dest && cache) {
    try {
      await cache.supabaseAdmin.from("customer_address_cache").upsert(
        {
          phone: cache.phone,
          address_normalized: normalized,
          lat: dest.lat,
          lng: dest.lng,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone" },
      );
    } catch (err) {
      console.error("[delivery-distance] falha ao gravar cache de endereço (não afeta o cálculo atual):", err);
    }
  }

  return dest;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const OSRM_SERVERS = [
  (lng1: number, lat1: number, lng2: number, lat2: number) =>
    `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`,
  (lng1: number, lat1: number, lng2: number, lat2: number) =>
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`,
];

export async function getRoadDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): Promise<number | null> {
  for (const buildUrl of OSRM_SERVERS) {
    try {
      const res = await fetch(buildUrl(lng1, lat1, lng2, lat2), {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json: any = await res.json();
      const meters = json?.routes?.[0]?.distance;
      if (typeof meters === "number") return meters / 1000;
    } catch (err) {
      console.error("[delivery-distance] um servidor de rota falhou, tentando o próximo:", err);
    }
  }
  return null;
}

export type FeeResult = {
  fee: number;
  distanceKm: number | null;
  outOfArea: boolean;
  usedDistancePricing: boolean;
  uncertain?: boolean;
  /** Veio da lista de ruas cadastradas (sem gastar geocodificação). */
  fromZona?: boolean;
  /** Motivo quando a entrega não está disponível para a rua cadastrada. */
  reason?: string;
  /** Bairro devolvido pela geocodificação (quando disponível), pra salvar
   *  junto com a rua aprendida em zonas_entrega. */
  bairro?: string | null;
};

export type Tier = DeliveryTier & { id?: string | null };

/** Faixas cadastradas em `faixas_entrega`, com as de `store_config` como fallback. */
export async function loadTiers(db: any | null, cfg: DeliveryConfig): Promise<Tier[]> {
  if (db) {
    try {
      const { data } = await db
        .from("faixas_entrega")
        .select("id, km_from, km_to, fee")
        .eq("ativo", true)
        .order("km_from", { ascending: true });
      if (Array.isArray(data) && data.length) {
        return data.map((t: any) => ({
          id: t.id,
          km_from: Number(t.km_from),
          km_to: Number(t.km_to),
          fee: Number(t.fee),
        }));
      }
    } catch (err) {
      console.error("[delivery-distance] falha ao ler faixas_entrega (usando as das configurações):", err);
    }
  }
  return (cfg.delivery_fee_tiers ?? []).map((t) => ({ ...t, id: null }));
}

export function pickTier(tiers: Tier[], distanceKm: number): { tier: Tier | null; outOfArea: boolean } {
  const sorted = tiers.slice().sort((a, b) => a.km_from - b.km_from);
  if (!sorted.length) return { tier: null, outOfArea: false };
  const exact = sorted.find((t) => distanceKm >= t.km_from && distanceKm < t.km_to);
  if (exact) return { tier: exact, outOfArea: false };

  const maxConfiguredKm = Math.max(...sorted.map((t) => t.km_to));
  // sem faixa exata — se está dentro do alcance máximo configurado, é quase
  // sempre um buraco na configuração das faixas (ex: 0-3km e 5-8km, sem
  // cobrir o intervalo de 3-5km) e não deveria travar o pedido como "fora de
  // área". Usa a faixa mais próxima em vez de recusar a entrega.
  if (distanceKm < maxConfiguredKm) {
    const nearest = sorted.reduce((best, t) => {
      const distToTier = distanceKm < t.km_from ? t.km_from - distanceKm : distanceKm - t.km_to;
      const distToBest = distanceKm < best.km_from ? best.km_from - distanceKm : distanceKm - best.km_to;
      return distToTier < distToBest ? t : best;
    });
    console.error(
      `[delivery-distance] ${distanceKm.toFixed(1)}km caiu num buraco entre faixas configuradas — usando a faixa mais próxima (${nearest.km_from}-${nearest.km_to}km). Confira as faixas em Configurações.`,
    );
    return { tier: nearest, outOfArea: false };
  }
  return { tier: null, outOfArea: true };
}

/** Calcula a taxa de entrega para um endereço, usando faixas de km se configurado, ou a taxa fixa como fallback. */
export async function calculateDeliveryFee(
  cfg: DeliveryConfig,
  customerAddress: string,
  cache?: { supabaseAdmin: any; phone: string },
  db?: any,
): Promise<FeeResult> {
  const database = cache?.supabaseAdmin ?? db ?? null;
  const safeFlatFee =
    cfg.default_delivery_fee > 0
      ? cfg.default_delivery_fee
      : cfg.delivery_fee_tiers?.length
        ? Math.max(...cfg.delivery_fee_tiers.map((t) => t.fee))
        : 0;
  const flatFallback: FeeResult = {
    fee: safeFlatFee,
    distanceKm: null,
    outOfArea: false,
    usedDistancePricing: false,
  };

  if (cfg.delivery_pricing_mode !== "distance" || cfg.store_lat == null || cfg.store_lng == null) {
    return flatFallback;
  }

  const tiers = await loadTiers(database, cfg);
  if (!tiers.length) return flatFallback;

  // O cálculo é sempre feito de forma dinâmica (geocodificação + rota real +
  // faixas configuradas) — a tela de "Zonas de entrega" é só um painel de
  // consulta pra loja; ela é alimentada automaticamente por esse cálculo
  // (upsertZonaFromCalculation logo abaixo), mas nunca é lida aqui pra
  // decidir preço ou bloquear rua. Isso evita ter duas fontes de verdade
  // divergentes — a única fonte real é sempre o cálculo do momento.
  const dynamic = await calculateDynamicFee(cfg, customerAddress, tiers, safeFlatFee, flatFallback, cache);
  if (
    database &&
    dynamic.usedDistancePricing &&
    !dynamic.uncertain &&
    !dynamic.outOfArea &&
    dynamic.distanceKm != null &&
    dynamic.tierId !== undefined
  ) {
    const { upsertZonaFromCalculation } = await import("./zonas-entrega.server");
    await upsertZonaFromCalculation(database, {
      address: customerAddress,
      distanceKm: dynamic.distanceKm,
      faixaId: dynamic.tierId,
      bairro: dynamic.bairro,
    });
  }
  const { tierId: _ignored, ...result } = dynamic;
  return result;
}

/** Fluxo original: geocodifica, mede a rota real e aplica a faixa de km. */
async function calculateDynamicFee(
  cfg: DeliveryConfig,
  customerAddress: string,
  tiers: Tier[],
  safeFlatFee: number,
  flatFallback: FeeResult,
  cache?: { supabaseAdmin: any; phone: string },
): Promise<FeeResult & { tierId?: string | null }> {
  const dest = await resolveDestination(
    customerAddress,
    cfg.google_maps_api_key,
    cfg.store_lat,
    cfg.store_lng,
    cfg.fixed_delivery_city ?? null,
    cache,
  );
  if (!dest) return flatFallback;

  const roadKm = await getRoadDistanceKm(cfg.store_lat!, cfg.store_lng!, dest.lat, dest.lng);
  const straightKm = haversineKm(cfg.store_lat!, cfg.store_lng!, dest.lat, dest.lng);
  const distanceKm = roadKm ?? straightKm * 1.3;
  const uncertain = roadKm == null;

  const maxConfiguredKm = Math.max(...tiers.map((t) => t.km_to));
  if (distanceKm > maxConfiguredKm * 3) {
    console.error(
      `[delivery-distance] distância suspeita (${distanceKm.toFixed(1)}km) — provável erro de geocodificação, usando taxa de reserva`,
    );
    // IMPORTANTE: nunca devolve a distância suspeita pra frente (popup de
    // aprovação, "você gasta", zonas de entrega). Ela é resultado de um erro
    // de geocodificação (endereço mal interpretado caindo longe da loja) —
    // se seguir como distanceKm, o popup calcula "você gasta" multiplicando
    // por essa distância absurda e mostra um custo de combustível centenas
    // de vezes maior que o real. Com distanceKm nulo, o popup mostra
    // "Distância não medida" em vez de um número inventado.
    return { ...flatFallback, distanceKm: null, uncertain: true };
  }

  const { tier, outOfArea } = pickTier(tiers, distanceKm);
  if (tier) {
    return {
      fee: Number(tier.fee),
      distanceKm,
      outOfArea: false,
      usedDistancePricing: true,
      uncertain,
      tierId: tier.id ?? null,
      bairro: dest.bairro,
    };
  }

  return { fee: safeFlatFee, distanceKm, outOfArea, usedDistancePricing: true, uncertain };
}

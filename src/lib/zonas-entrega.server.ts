// ============================================================
// Camada de ruas cadastradas (zonas_entrega)
//
// Roda ANTES do cálculo dinâmico (geocodificação + OSRM) em
// calculateDeliveryFee. Se a rua do cliente já está cadastrada, o valor sai
// direto da tabela — sem gastar geocoding e sem variação de resultado. Se
// não está, o fluxo dinâmico segue normalmente e o resultado é gravado aqui
// (aprendizado contínuo).
// ============================================================

/** Normaliza um nome de rua pra comparação: minúsculo, sem acento, sem pontuação. */
export function normalizeStreet(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove o prefixo de logradouro ("rua", "av", "travessa"...) pra comparar só o nome próprio. */
function stripPrefix(n: string): string {
  const parts = n.split(" ");
  const prefixes = [
    "rua",
    "r",
    "avenida",
    "av",
    "travessa",
    "tv",
    "estrada",
    "est",
    "alameda",
    "al",
    "praca",
    "praça",
    "rodovia",
    "rod",
    "beco",
    "vila",
  ];
  if (parts.length > 1 && prefixes.includes(parts[0])) return parts.slice(1).join(" ");
  return n;
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Similaridade por trigramas (mesma ideia do pg_trgm), 0 a 1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type ZonaRow = {
  id: string;
  rua: string;
  bairro: string | null;
  distancia_km: number | null;
  faixa_id: string | null;
  entrega_disponivel: boolean;
  observacao: string | null;
};

/**
 * Procura a rua do endereço do cliente entre as ruas cadastradas.
 * Retorna null quando não há uma correspondência suficientemente confiável —
 * nesse caso quem decide é o cálculo dinâmico.
 */
export async function findZonaByAddress(database: any, customerAddress: string): Promise<ZonaRow | null> {
  const norm = normalizeStreet(customerAddress);
  if (!norm) return null;

  try {
    const { data } = await database
      .from("zonas_entrega")
      .select("id, rua, bairro, distancia_km, faixa_id, entrega_disponivel, observacao");
    const rows: ZonaRow[] = data ?? [];
    if (!rows.length) return null;

    // "Rua das Flores, 120, Centro" → compara o nome da rua com cada
    // cadastro, tanto no texto completo quanto no primeiro trecho antes da
    // vírgula (que quase sempre é a rua + número).
    const firstChunk = normalizeStreet(String(customerAddress).split(",")[0] ?? "");
    const target = stripPrefix(firstChunk || norm)
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    let best: { row: ZonaRow; score: number } | null = null;
    for (const row of rows) {
      const candidate = stripPrefix(normalizeStreet(row.rua));
      if (!candidate) continue;
      let score = similarity(target, candidate);
      // rua cadastrada aparece literalmente dentro do endereço digitado
      if (score < 1 && candidate.length >= 5 && norm.includes(candidate)) score = Math.max(score, 0.9);
      if (!best || score > best.score) best = { row, score };
    }

    if (best && best.score >= 0.72) return best.row;
    return null;
  } catch {
    // tabela ainda não existe / erro de leitura — segue pro cálculo dinâmico
    return null;
  }
}

/**
 * Aprendizado contínuo: depois de um cálculo dinâmico bem-sucedido, grava
 * (ou atualiza) a rua na tabela pra que a próxima consulta do mesmo endereço
 * não precise geocodificar de novo.
 */
export async function upsertZonaFromCalculation(
  database: any,
  input: { address: string; distanceKm: number; faixaId: string | null; bairro?: string | null },
): Promise<void> {
  const rua = String(input.address ?? "")
    .split(",")[0]
    ?.trim();
  if (!rua) return;

  try {
    const existing = await findZonaByAddress(database, rua);
    if (existing) {
      // Rua já cadastrada: se a distância medida agora diverge bastante da
      // salva, marca como suspeita/variável pra revisão manual em vez de
      // sobrescrever silenciosamente um valor que pode ter sido ajustado à mão.
      const saved = existing.distancia_km != null ? Number(existing.distancia_km) : null;
      if (saved == null) {
        await database
          .from("zonas_entrega")
          .update({ distancia_km: input.distanceKm, faixa_id: input.faixaId })
          .eq("id", existing.id);
      } else if (Math.abs(saved - input.distanceKm) > 0.8) {
        await database
          .from("zonas_entrega")
          .update({
            distancia_suspeita: true,
            distancia_km_min: Math.min(saved, input.distanceKm),
            distancia_km_max: Math.max(saved, input.distanceKm),
          })
          .eq("id", existing.id);
      }
      return;
    }

    await database.from("zonas_entrega").insert({
      rua,
      bairro: input.bairro ?? null,
      distancia_km: input.distanceKm,
      faixa_id: input.faixaId,
      entrega_disponivel: true,
    });
  } catch {
    /* aprendizado é oportunista — nunca pode quebrar o cálculo do frete */
  }
}

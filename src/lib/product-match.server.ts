
// Casamento de nome de produto extraído pela IA com o cardápio real.
//
// Antes disso, a comparação era só "uma string contém a outra" — quebrava
// toda vez que a ordem das palavras ou uma pequena variação no nome não
// batia 100%, mesmo sendo claramente o mesmo item (ex: "batata recheada de
// frango cremoso com catupiry" vs. o nome cadastrado em outra ordem). Isso
// travava o pedido num loop: a IA pedia confirmação de novo, o cliente
// respondia a mesma coisa, e caía no mesmo erro outra vez.
//
// Mesma técnica de comparação por trigramas já usada em zonas-entrega.server.ts
// pra achar rua parecida — aqui aplicada a nome de produto.

export type ProductRow = { id: string; name: string; sale_price: number };

/** Tira acentos, pontuação e espaços duplicados. Genérico — serve pra produto e pra rua. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Similaridade de trigramas (mesma ideia do pg_trgm), 0 a 1. */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared++;
  });
  return shared / (ta.size + tb.size - shared);
}

/** Abaixo disso, não aceita como o mesmo produto — só entra como sugestão. */
export const PRODUCT_MATCH_THRESHOLD = 0.55;

export type ProductMatch = { product: ProductRow; score: number };

/** Pontua TODOS os produtos do cardápio contra o nome informado, do mais parecido pro menos. */
export function rankProducts(productList: ProductRow[], rawName: string): ProductMatch[] {
  const needle = normalizeText(String(rawName || ""));
  if (!needle) return [];
  return productList
    .map((p) => ({ product: p, score: textSimilarity(needle, normalizeText(p.name)) }))
    .sort((a, b) => b.score - a.score);
}

/** Melhor produto, só se estiver acima do limiar de aceite automático. */
export function findProductMatch(productList: ProductRow[], rawName: string): ProductRow | null {
  const needle = normalizeText(String(rawName || ""));
  if (!needle) return null;

  // Igualdade exata (normalizada) sempre vence, mesmo com score de trigrama < 1
  // por algum efeito de borda — ex.: nomes muito curtos.
  const exact = productList.find((p) => normalizeText(p.name) === needle);
  if (exact) return exact;

  const ranked = rankProducts(productList, rawName);
  const best = ranked[0];
  return best && best.score >= PRODUCT_MATCH_THRESHOLD ? best.product : null;
}

/** Top N candidatos mais parecidos, mesmo abaixo do limiar — pra IA oferecer ao cliente. */
export function findProductSuggestions(productList: ProductRow[], rawName: string, topN = 3): string[] {
  return rankProducts(productList, rawName)
    .slice(0, topN)
    .filter((m) => m.score > 0.15) // corta sugestão claramente sem relação nenhuma
    .map((m) => m.product.name);
}

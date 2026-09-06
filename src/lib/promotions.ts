// Lógica compartilhada de promoções — usada no cadastro (admin), no cardápio
// digital (loja pública) e em qualquer outro lugar que precise saber "esse
// produto está em promoção agora, e por qual preço?".
//
// Um produto (inclusive combo) pode ter até 3 tipos de promoção:
//   'period'    -> ativa entre promotion_start_at e promotion_end_at (data/hora exatas)
//   'recurring' -> ativa em certos dias da semana (0=domingo..6=sábado) + faixa de horário
//   'always'    -> ativa sempre que promotion_active estiver ligado, sem prazo
//
// O preço promocional (promotion_price) pode ser editado a qualquer momento
// pelo admin, independente do preço normal (sale_price).

export type PromotableProduct = {
  sale_price: number | string;
  promotion_active?: boolean | null;
  promotion_price?: number | string | null;
  promotion_type?: string | null;
  promotion_start_at?: string | null;
  promotion_end_at?: string | null;
  promotion_days_of_week?: number[] | null;
  promotion_time_start?: string | null; // "HH:MM" ou "HH:MM:SS"
  promotion_time_end?: string | null;
};

function parseTimeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

/** Diz se a promoção do produto está ativa neste exato momento (`at`, default = agora). */
export function isPromotionActive(p: PromotableProduct, at: Date = new Date()): boolean {
  if (!p.promotion_active) return false;
  const type = p.promotion_type || "period";

  if (type === "period") {
    const start = p.promotion_start_at ? new Date(p.promotion_start_at) : null;
    const end = p.promotion_end_at ? new Date(p.promotion_end_at) : null;
    if (start && at < start) return false;
    if (end && at > end) return false;
    return true;
  }

  if (type === "recurring") {
    const days = p.promotion_days_of_week;
    if (days && days.length > 0 && !days.includes(at.getDay())) return false;
    const startMin = parseTimeToMinutes(p.promotion_time_start);
    const endMin = parseTimeToMinutes(p.promotion_time_end);
    if (startMin != null && endMin != null) {
      const nowMin = at.getHours() * 60 + at.getMinutes();
      if (startMin <= endMin) {
        if (nowMin < startMin || nowMin > endMin) return false;
      } else {
        // faixa que cruza a meia-noite (ex: 22:00 às 02:00)
        if (nowMin < startMin && nowMin > endMin) return false;
      }
    }
    return true;
  }

  // 'always'
  return true;
}

/** Retorna o preço que deve ser cobrado agora, e se ele veio de uma promoção ativa. */
export function getEffectivePrice(
  p: PromotableProduct,
  at: Date = new Date(),
): { price: number; listPrice: number; isPromotion: boolean } {
  const listPrice = Number(p.sale_price) || 0;
  const promoPrice = p.promotion_price != null ? Number(p.promotion_price) : null;
  if (promoPrice != null && promoPrice >= 0 && isPromotionActive(p, at)) {
    return { price: promoPrice, listPrice, isPromotion: true };
  }
  return { price: listPrice, listPrice, isPromotion: false };
}

export const PROMOTION_DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type Coupon = {
  id?: string;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  active: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
  usage_limit?: number | null;
  usage_count?: number | null;
  min_order_value?: number | null;
  applicable_product_id?: string | null;
};

export type CouponValidationResult =
  | { ok: true; discount: number }
  | { ok: false; reason: string };

/**
 * Valida um cupom contra o carrinho atual e calcula o desconto.
 * `subtotal` = soma dos itens (preços já com promoção aplicada, se houver).
 * `cartProductIds` = ids dos produtos no carrinho, para checar `applicable_product_id`.
 */
export function validateCoupon(
  coupon: Coupon | null | undefined,
  subtotal: number,
  cartProductIds: string[],
  at: Date = new Date(),
): CouponValidationResult {
  if (!coupon) return { ok: false, reason: "Cupom não encontrado" };
  if (!coupon.active) return { ok: false, reason: "Cupom inativo" };
  if (coupon.valid_from && at < new Date(coupon.valid_from))
    return { ok: false, reason: "Cupom ainda não é válido" };
  if (coupon.valid_until && at > new Date(coupon.valid_until))
    return { ok: false, reason: "Cupom expirado" };
  if (coupon.usage_limit != null && (coupon.usage_count ?? 0) >= coupon.usage_limit)
    return { ok: false, reason: "Cupom esgotado" };
  if (coupon.min_order_value != null && subtotal < Number(coupon.min_order_value))
    return { ok: false, reason: `Pedido mínimo de ${Number(coupon.min_order_value).toFixed(2)} para usar este cupom` };
  if (coupon.applicable_product_id && !cartProductIds.includes(coupon.applicable_product_id))
    return { ok: false, reason: "Cupom não é válido para os itens do seu carrinho" };

  const discount =
    coupon.discount_type === "percentage"
      ? (subtotal * Number(coupon.discount_value)) / 100
      : Math.min(Number(coupon.discount_value), subtotal);
  return { ok: true, discount: Math.max(0, discount) };
}

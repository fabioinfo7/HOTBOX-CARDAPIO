import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { brasiliaDayRange } from "@/lib/brasilia-date";

async function requireStoreAdmin(context: any) {
  const { data: role } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "store_admin")
    .maybeSingle();
  return !!role;
}

const isPaymentFilter = (value: unknown): value is "all" | "pix" | "card" =>
  value === "all" || value === "pix" || value === "card";
const isProviderFilter = (value: unknown): value is "all" | "infinitepay" | "mercadopago" =>
  value === "all" || value === "infinitepay" || value === "mercadopago";

const DIGITAL_KINDS = ["infinitepay", "infinitepay_card", "infinitepay_pix", "mercadopago", "mercadopago_card", "mercadopago_pix"];

function applyPaymentFilter(query: any, payment: "all" | "pix" | "card") {
  if (payment === "pix") return query.in("payment_kind", ["infinitepay_pix", "mercadopago_pix"]);
  if (payment === "card") return query.in("payment_kind", ["infinitepay", "infinitepay_card", "mercadopago", "mercadopago_card"]);
  return query.in("payment_kind", DIGITAL_KINDS);
}

function applyProviderFilter(query: any, provider: "all" | "infinitepay" | "mercadopago") {
  return provider === "all" ? query : query.eq("payment_provider", provider);
}

export const listDigitalMenuFinanceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    from: string;
    to: string;
    payment?: "all" | "pix" | "card";
    provider?: "all" | "infinitepay" | "mercadopago";
    page?: number;
    pageSize?: number;
  }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;

    const payment = isPaymentFilter(data.payment) ? data.payment : "all";
    const provider = isProviderFilter(data.provider) ? data.provider : "all";
    const pageSize = Math.min(50, Math.max(10, Math.floor(Number(data.pageSize) || 15)));
    const page = Math.max(1, Math.floor(Number(data.page) || 1));
    const { since, until } = brasiliaDayRange(data.from, data.to);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select(
        "id,status,payment_provider,payment_kind,customer_name,customer_phone,subtotal,delivery_fee,coupon_code,coupon_discount,total,order_id,paid_at,created_at,updated_at,infinitepay_receipt_url,infinitepay_amount_cents,infinitepay_paid_amount_cents,infinitepay_installments,mercadopago_order_id,mercadopago_payment_id,mercadopago_order_status,mercadopago_order_status_detail,mercadopago_status,mercadopago_status_detail,mercadopago_payment_method_id,mercadopago_payment_type_id,mercadopago_installments,mercadopago_transaction_amount,mercadopago_net_received_amount,mercadopago_fee_amount,mercadopago_refunded_amount,mercadopago_refund_status,mercadopago_refunded_at,finance_reference,finance_note",
        { count: "exact" },
      )
      .eq("status", "paid")
      .is("finance_hidden_at", null)
      .gte("paid_at", since)
      .lte("paid_at", until);
    q = applyPaymentFilter(q, payment);
    q = applyProviderFilter(q, provider);

    const fromRow = (page - 1) * pageSize;
    const toRow = fromRow + pageSize - 1;
    const { data: rows, count, error } = await q.order("paid_at", { ascending: false }).range(fromRow, toRow);
    if (error) return { ok: false, error: error.message } as const;

    const orderIds = [...new Set((rows ?? []).map((r: any) => r.order_id).filter(Boolean))];
    const orderMap = new Map<string, any>();
    if (orderIds.length) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("id,order_number,external_display_id,status,customer_name,customer_phone,payment_method,payment_status,created_at")
        .in("id", orderIds);
      for (const order of orders ?? []) orderMap.set(String(order.id), order);
    }

    const { data: periodSummary, error: summaryError } = await (supabaseAdmin as any).rpc("digital_menu_finance_summary", {
      p_since: since,
      p_until: until,
      p_payment_kind: payment,
      p_provider: provider,
    });
    if (summaryError) return { ok: false, error: summaryError.message } as const;

    const { data: allTimeSummary, error: allTimeError } = await (supabaseAdmin as any).rpc("digital_menu_finance_summary", {
      p_since: null,
      p_until: null,
      p_payment_kind: "all",
      p_provider: "all",
    });
    if (allTimeError) return { ok: false, error: allTimeError.message } as const;

    const checkoutIds = (rows ?? []).map((r: any) => String(r.id));
    const refundMap = new Map<string, any[]>();
    if (checkoutIds.length) {
      const { data: refunds } = await (supabaseAdmin as any)
        .from("mercadopago_refunds")
        .select("id,checkout_id,mercadopago_order_id,mercadopago_transaction_id,mercadopago_refund_id,refund_type,amount,reason,status,requested_at,processed_at,error_message")
        .in("checkout_id", checkoutIds)
        .order("requested_at", { ascending: false });
      for (const refund of refunds ?? []) {
        const key = String(refund.checkout_id);
        refundMap.set(key, [...(refundMap.get(key) || []), refund]);
      }
    }

    let refundTotal = 0;
    if (provider !== "infinitepay") {
      let refundScope = (supabaseAdmin as any)
        .from("site_checkout_sessions")
        .select("id")
        .eq("status", "paid")
        .eq("payment_provider", "mercadopago")
        .gte("paid_at", since)
        .lte("paid_at", until);
      refundScope = applyPaymentFilter(refundScope, payment);
      const { data: refundCheckouts } = await refundScope;
      const refundCheckoutIds = (refundCheckouts ?? []).map((x: any) => String(x.id));
      if (refundCheckoutIds.length) {
        const { data: periodRefunds } = await (supabaseAdmin as any)
          .from("mercadopago_refunds")
          .select("amount,status,requested_at")
          .in("checkout_id", refundCheckoutIds)
          .gte("requested_at", since)
          .lte("requested_at", until)
          .in("status", ["processing", "processed"]);
        refundTotal = (periodRefunds ?? []).reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
      }
    }

    return {
      ok: true,
      page,
      pageSize,
      count: count ?? 0,
      periodSummary: { ...(periodSummary ?? {}), refund_total: refundTotal, net_total: Number(periodSummary?.sales_total || 0) - refundTotal },
      allTimeSummary: allTimeSummary ?? {},
      rows: (rows ?? []).map((row: any) => ({ ...row, order: row.order_id ? orderMap.get(String(row.order_id)) ?? null : null, refunds: refundMap.get(String(row.id)) || [] })),
    } as const;
  });

export const updateDigitalMenuFinanceMetaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { checkoutId: string; reference?: string | null; note?: string | null }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .update({
        finance_reference: String(data.reference ?? "").trim().slice(0, 120) || null,
        finance_note: String(data.note ?? "").trim().slice(0, 2000) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.checkoutId)
      .eq("status", "paid")
      .in("payment_kind", DIGITAL_KINDS);
    if (error) return { ok: false, error: error.message } as const;
    return { ok: true } as const;
  });

export const hideDigitalMenuFinanceRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { checkoutId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .update({
        finance_hidden_at: new Date().toISOString(),
        finance_hidden_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.checkoutId)
      .eq("status", "paid")
      .in("payment_kind", DIGITAL_KINDS);
    if (error) return { ok: false, error: error.message } as const;
    return { ok: true } as const;
  });

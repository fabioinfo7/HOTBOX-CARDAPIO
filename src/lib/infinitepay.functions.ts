import { createServerFn } from "@tanstack/react-start";

async function loadInfinitePayConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("infinitepay_enabled,infinitepay_handle,infinitepay_webhook_token")
    .eq("id", 1)
    .maybeSingle();

  return {
    enabled: data?.infinitepay_enabled === true,
    handle: String(data?.infinitepay_handle || "").replace(/^\$/, "").trim(),
    webhookToken: String(data?.infinitepay_webhook_token || "").trim(),
  };
}

function phoneE164(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
}

export const createInfinitePayCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; origin: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadInfinitePayConfig(supabaseAdmin);
    if (!cfg.handle) {
      return { error: "Pagamento online indisponível no momento. Configure a InfinitePay em Configurações → Pagamentos." };
    }

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,total,subtotal,coupon_discount,customer_name,customer_phone,order_data,items,delivery_fee,expires_at,order_id,payment_provider")
      .eq("id", data.checkoutId)
      .maybeSingle();

    if (error || !checkout) return { error: "Checkout não encontrado." };
    if (checkout.payment_provider && checkout.payment_provider !== "infinitepay") return { error: "Este checkout pertence a outro provedor de pagamento." };
    if (checkout.order_id) return { error: "Este checkout já gerou um pedido." };
    if (!["created", "payment_pending"].includes(String(checkout.status))) return { error: "Este checkout não está mais disponível." };
    if (new Date(checkout.expires_at).getTime() < Date.now()) return { error: "Este checkout expirou. Refaça o pedido." };

    const safeOrigin = new URL(data.origin).origin;
    const orderNsu = String(checkout.id);
    const webhookUrl = `${safeOrigin}/api/public/webhooks/infinitepay?token=${encodeURIComponent(cfg.webhookToken)}`;
    const redirectUrl = `${safeOrigin}/obrigado`;

    const items = Array.isArray(checkout.items) ? checkout.items : [];
    let ipItems: Array<{ quantity: number; price: number; description: string }>;
    if (Number(checkout.coupon_discount || 0) > 0) {
      ipItems = [{ quantity: 1, price: Math.round(Number(checkout.total) * 100), description: "Pedido HotBox Delivery — desconto aplicado" }];
    } else {
      ipItems = items.map((item: any) => ({
        quantity: Math.max(1, Number(item.qty || 1)),
        price: Math.round(Number(item.unit_price || 0) * 100),
        description: String(item.product_name || "Produto HotBox"),
      }));
      if (Number(checkout.delivery_fee || 0) > 0) {
        ipItems.push({ quantity: 1, price: Math.round(Number(checkout.delivery_fee) * 100), description: "Taxa de entrega" });
      }
    }

    const od = checkout.order_data || {};
    const payload: any = {
      handle: cfg.handle,
      order_nsu: orderNsu,
      redirect_url: redirectUrl,
      webhook_url: webhookUrl,
      items: ipItems,
      customer: {
        name: checkout.customer_name,
        phone_number: phoneE164(checkout.customer_phone),
      },
    };

    if (od.delivery_mode === "delivery") {
      payload.address = {
        cep: String(od.address_cep || "").replace(/\D/g, ""),
        street: od.address_street || undefined,
        neighborhood: od.address_neighborhood || undefined,
        number: od.address_number || undefined,
        complement: od.address_complement || undefined,
      };
    }

    const response = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || !body?.url) {
      return { error: String(body?.message || body?.error || "Não foi possível iniciar o pagamento pela InfinitePay.") };
    }

    await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .update({
        status: "payment_pending",
        infinitepay_order_nsu: orderNsu,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkout.id);

    return { url: String(body.url), checkoutId: checkout.id };
  });

export const confirmInfinitePayReturn = createServerFn({ method: "POST" })
  .inputValidator((data: { order_nsu: string; transaction_nsu: string; slug: string; receipt_url?: string | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadInfinitePayConfig(supabaseAdmin);
    if (!cfg.handle) return { ok: false, error: "Pagamento indisponível." };

    const { data: checkout } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,total,order_id,status")
      .eq("id", data.order_nsu)
      .maybeSingle();
    if (!checkout) return { ok: false, error: "Checkout não encontrado." };
    const alreadyCreatedOrderId = checkout.order_id ? String(checkout.order_id) : null;

    const response = await fetch("https://api.checkout.infinitepay.io/payment_check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: cfg.handle,
        order_nsu: data.order_nsu,
        transaction_nsu: data.transaction_nsu,
        slug: data.slug,
      }),
    });
    const checked: any = await response.json().catch(() => ({}));
    const expected = Math.round(Number(checkout.total) * 100);
    if (!response.ok || checked?.success !== true || checked?.paid !== true || Number(checked?.amount) !== expected) {
      return { ok: false, pending: true };
    }

    const capture = String(checked.capture_method || "");
    const paymentKind = capture === "pix" ? "infinitepay_pix" : "infinitepay_card";
    await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .update({
        payment_kind: paymentKind,
        infinitepay_transaction_nsu: data.transaction_nsu,
        infinitepay_invoice_slug: data.slug,
        infinitepay_receipt_url: data.receipt_url ? String(data.receipt_url) : undefined,
        infinitepay_amount_cents: Number(checked.amount ?? expected),
        infinitepay_paid_amount_cents: Number(checked.paid_amount ?? checked.amount ?? expected),
        infinitepay_installments: Math.max(1, Number(checked.installments ?? 1)),
        infinitepay_capture_method: capture || null,
        infinitepay_verified_at: new Date().toISOString(),
        infinitepay_verification_payload: checked,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkout.id);

    if (alreadyCreatedOrderId) return { ok: true, order_id: alreadyCreatedOrderId };

    const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
      p_checkout_id: checkout.id,
      p_confirmed_by: "infinitepay",
      p_provider_ref: data.transaction_nsu,
      p_stripe_session_id: null,
    });
    if (error || !finalized?.ok) return { ok: false, error: error?.message || finalized?.error || "Falha ao gerar pedido." };
    try {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout.functions");
      if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin, finalized.order_id);
    } catch {}
    return { ok: true, order_id: finalized.order_id };
  });

export { loadInfinitePayConfig };

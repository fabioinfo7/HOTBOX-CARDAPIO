import { createServerFn } from "@tanstack/react-start";

async function loadStripeConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("stripe_enabled,stripe_secret_key,stripe_publishable_key,stripe_webhook_secret")
    .eq("id", 1)
    .maybeSingle();
  return {
    enabled: data?.stripe_enabled === true,
    secretKey: String(data?.stripe_secret_key || process.env.STRIPE_SECRET_KEY || "").trim(),
    publishableKey: String(data?.stripe_publishable_key || "").trim(),
    webhookSecret: String(data?.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
  };
}

export const createStripeCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; origin: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadStripeConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.secretKey) {
      return { error: "Pagamento por cartão indisponível no momento. Configure e ative o Stripe em Configurações → Pagamentos." };
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, total, customer_name, customer_phone, payment_method, payment_status, status")
      .eq("id", data.orderId)
      .maybeSingle();

    if (error || !order) return { error: "Pedido não encontrado" };
    if (order.payment_method !== "card") return { error: "Este pedido não é pagamento em cartão" };
    if (order.payment_status === "paid") return { error: "Este pedido já está pago" };

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.secretKey);
    const safeOrigin = new URL(data.origin).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: Math.round(Number(order.total) * 100),
          product_data: { name: `Pedido #${order.order_number} — HotBox Delivery` },
        },
      }],
      success_url: `${safeOrigin}/pedido/${order.id}?paid=1`,
      cancel_url: `${safeOrigin}/pedido/${order.id}?canceled=1`,
      metadata: { order_id: order.id, order_number: String(order.order_number), source: "digital_menu" },
      payment_intent_data: { metadata: { order_id: order.id, source: "digital_menu" } },
      locale: "pt-BR",
    });

    await supabaseAdmin.from("orders").update({ payment_link: session.url }).eq("id", order.id);
    return { url: session.url };
  });

export { loadStripeConfig };

export const createStripeSiteCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; origin: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadStripeConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.secretKey) {
      return { error: "Stripe indisponível no momento. Verifique as configurações de pagamento." };
    }

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,payment_kind,total,customer_name,customer_phone,expires_at,order_id")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { error: "Checkout não encontrado." };
    if (checkout.order_id) return { error: "Este checkout já gerou um pedido." };
    if (!["created", "payment_pending"].includes(String(checkout.status))) return { error: "Este checkout não está mais disponível." };
    if (new Date(checkout.expires_at).getTime() < Date.now()) return { error: "Este checkout expirou. Refaça o pedido." };

    const method = checkout.payment_kind === "stripe_pix" ? "pix" : "card";
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.secretKey);
    const safeOrigin = new URL(data.origin).origin;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: [method as any],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: Math.round(Number(checkout.total) * 100),
            product_data: { name: "Pedido HotBox Delivery" },
          },
        }],
        success_url: `${safeOrigin}/checkout/${checkout.id}?stripe=success`,
        cancel_url: `${safeOrigin}/checkout/${checkout.id}?stripe=cancelled`,
        customer_email: undefined,
        metadata: {
          checkout_id: checkout.id,
          source: "digital_menu_v2",
          payment_kind: checkout.payment_kind,
        },
        payment_intent_data: {
          metadata: {
            checkout_id: checkout.id,
            source: "digital_menu_v2",
            payment_kind: checkout.payment_kind,
          },
        },
        ...(method === "pix"
          ? { payment_method_options: { pix: { expires_after_seconds: 15 * 60 } } }
          : {}),
        locale: "pt-BR",
      } as any);

      await (supabaseAdmin as any)
        .from("site_checkout_sessions")
        .update({
          status: "payment_pending",
          stripe_session_id: session.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkout.id);

      return { url: session.url, checkoutId: checkout.id };
    } catch (e: any) {
      const msg = String(e?.message || "Falha ao iniciar pagamento Stripe");
      if (method === "pix" && /pix|payment method|not available|not enabled/i.test(msg)) {
        return { error: "O Pix ainda não está habilitado na sua conta Stripe. Ative Pix no Dashboard da Stripe e tente novamente." };
      }
      return { error: msg };
    }
  });

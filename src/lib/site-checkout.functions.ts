import { createServerFn } from "@tanstack/react-start";
import { getEffectivePrice } from "@/lib/promotions";

export type SitePaymentKind = "infinitepay" | "mercadopago";

type CheckoutInput = {
  customer_name: string;
  customer_phone: string;
  delivery_mode: "delivery" | "pickup";
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_cep?: string | null;
  payment_kind: SitePaymentKind;
  coupon_code?: string | null;
  access_token?: string | null;
  items: Array<{ product_id: string; qty: number; notes?: string | null }>;
};

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

export const createSiteCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: CheckoutInput) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let customerUser: any = null;
    if (data.access_token) {
      const { data: authData } = await supabaseAdmin.auth.getUser(data.access_token);
      customerUser = authData?.user ?? null;
    }
    const name = String(data.customer_name || "").trim();
    const phone = digits(data.customer_phone);
    if (!name) return { error: "Informe o nome de quem vai receber." };
    if (phone.length < 10) return { error: "Informe um telefone válido." };
    if (!Array.isArray(data.items) || data.items.length === 0) return { error: "Seu carrinho está vazio." };
    if (!["infinitepay", "mercadopago"].includes(String(data.payment_kind || ""))) return { error: "Forma de pagamento inválida." };

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select("digital_payment_provider,infinitepay_enabled,infinitepay_handle,mercadopago_enabled,mercadopago_public_key,mercadopago_access_token,digital_menu_card_enabled,digital_menu_pix_enabled")
      .eq("id", 1)
      .maybeSingle();

    const activeProvider = String(cfg?.digital_payment_provider || "infinitepay") === "mercadopago" ? "mercadopago" : "infinitepay";
    if (activeProvider === "mercadopago") {
      if (cfg?.mercadopago_enabled !== true || !String(cfg?.mercadopago_public_key || "").trim() || !String(cfg?.mercadopago_access_token || "").trim()) {
        return { error: "Mercado Pago está selecionado, mas a integração ainda não está completamente configurada." };
      }
    } else if (cfg?.infinitepay_enabled !== true || !String(cfg?.infinitepay_handle || "").trim()) {
      return { error: "InfinitePay está selecionada, mas a integração ainda não está completamente configurada." };
    }

    let deliveryFee = 0;
    let normalizedNeighborhood = data.address_neighborhood || null;
    if (data.delivery_mode === "delivery") {
      if (!data.address_street || !data.address_number || !data.address_neighborhood) {
        return { error: "Preencha rua, número e bairro." };
      }
      const { data: quote, error: quoteError } = await supabaseAdmin.rpc("check_delivery_area_public", {
        p_neighborhood: data.address_neighborhood,
        p_street: data.address_street || null,
      });
      if (quoteError) return { error: "Não foi possível validar a área de entrega." };
      if (!quote?.supported) return { error: "Esse endereço está fora da área de entrega própria." };
      deliveryFee = Number(quote?.fee ?? 0) || 0;
      normalizedNeighborhood = String(quote?.neighborhood || data.address_neighborhood);
    }

    const requestedIds = Array.from(new Set(data.items.map((i) => String(i.product_id || "")).filter(Boolean)));
    const { data: products, error: productError } = await supabaseAdmin
      .from("products")
      .select("id,name,sale_price,active,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,loyalty_eligible")
      .in("id", requestedIds)
      .eq("active", true);
    if (productError) return { error: "Não foi possível validar os produtos." };

    const byId = new Map((products ?? []).map((p: any) => [String(p.id), p]));
    const serverItems: any[] = [];
    for (const item of data.items) {
      const p: any = byId.get(String(item.product_id));
      if (!p) return { error: "Um dos produtos do carrinho não está mais disponível." };
      const qty = Math.max(1, Math.min(50, Number(item.qty || 1)));
      const eff = getEffectivePrice(p);
      if (!Number.isFinite(eff.price) || eff.price <= 0) return { error: `Preço inválido para ${p.name}.` };
      serverItems.push({
        product_id: p.id,
        product_name: p.name,
        qty,
        unit_price: Number(eff.price),
        list_price: Number(eff.listPrice),
        is_promotion_price: Boolean(eff.isPromotion),
        notes: String(item.notes || "").trim() || null,
      });
    }

    const subtotal = Number(serverItems.reduce((sum, i) => sum + i.unit_price * i.qty, 0).toFixed(2));
    let discount = 0;
    let couponCode: string | null = null;
    let loyaltyRewardId: string | null = null;
    const requestedCoupon = String(data.coupon_code || "").trim().toUpperCase();
    if (customerUser) await (supabaseAdmin as any).rpc("release_stale_loyalty_rewards", { p_user_id: customerUser.id });
    if (requestedCoupon) {
      const { data: reward } = await (supabaseAdmin as any)
        .from("loyalty_rewards")
        .select("id,code,status,user_id")
        .ilike("code", requestedCoupon)
        .maybeSingle();

      if (reward) {
        if (!customerUser || reward.user_id !== customerUser.id) return { error: "Entre na conta do Clube HotBox dona deste cupom para usá-lo." };
        if (reward.status !== "available") return { error: "Este cupom de fidelidade já está sendo usado ou já foi resgatado." };
        if (data.delivery_mode !== "delivery") return { error: "A batata grátis do Clube HotBox é válida em pedidos com entrega." };
        const eligible = serverItems
          .filter((item) => Boolean((byId.get(String(item.product_id)) as any)?.loyalty_eligible))
          .sort((a, b) => Number(b.unit_price) - Number(a.unit_price))[0];
        if (!eligible) return { error: "Adicione ao carrinho uma batata participante do Clube HotBox." };
        discount = Number(eligible.unit_price || 0);
        couponCode = String(reward.code).toUpperCase();
        loyaltyRewardId = String(reward.id);
      } else {
        const { data: quote, error: couponError } = await supabaseAdmin.rpc("validate_coupon_public", {
          p_code: requestedCoupon,
          p_subtotal: subtotal,
          p_customer_phone: phone,
          p_cart: serverItems,
        });
        if (couponError || !quote?.ok) return { error: String(quote?.reason || couponError?.message || "Cupom inválido") };
        discount = Number(quote?.discount ?? 0) || 0;
        couponCode = String(quote?.code || requestedCoupon).trim().toUpperCase();
      }
    }

    const total = Number((Math.max(0, subtotal - discount) + deliveryFee).toFixed(2));
    if (total <= 0) return { error: "Total inválido." };

    const orderData = {
      customer_name: name,
      customer_phone: phone,
      delivery_mode: data.delivery_mode,
      address_street: data.delivery_mode === "delivery" ? data.address_street || null : null,
      address_number: data.delivery_mode === "delivery" ? data.address_number || null : null,
      address_complement: data.delivery_mode === "delivery" ? data.address_complement || null : null,
      address_neighborhood: data.delivery_mode === "delivery" ? normalizedNeighborhood : null,
      address_city: data.delivery_mode === "delivery" ? data.address_city || null : null,
      address_cep: data.delivery_mode === "delivery" ? digits(data.address_cep) || null : null,
    };

    if (customerUser) {
      await (supabaseAdmin as any).from("customer_profiles").upsert({
        user_id: customerUser.id,
        full_name: name,
        email: customerUser.email || null,
        phone,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      await (supabaseAdmin as any).from("loyalty_accounts").upsert({ user_id: customerUser.id }, { onConflict: "user_id", ignoreDuplicates: true });
    }

    const { data: checkout, error: insertError } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .insert({
        status: "created",
        payment_kind: activeProvider,
        payment_provider: activeProvider,
        customer_name: name,
        customer_phone: phone,
        order_data: orderData,
        items: serverItems,
        coupon_code: couponCode,
        coupon_discount: discount,
        customer_user_id: customerUser?.id || null,
        loyalty_reward_id: loyaltyRewardId,
        subtotal,
        delivery_fee: deliveryFee,
        total,
        expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      })
      .select("id,total,payment_kind,payment_provider,status")
      .single();
    if (insertError || !checkout) return { error: insertError?.message || "Não foi possível iniciar o checkout." };

    if (loyaltyRewardId && customerUser) {
      const { data: reserved, error: reserveError } = await (supabaseAdmin as any).rpc("reserve_loyalty_reward", {
        p_reward_id: loyaltyRewardId,
        p_checkout_id: checkout.id,
        p_user_id: customerUser.id,
      });
      if (reserveError || reserved !== true) {
        await (supabaseAdmin as any).from("site_checkout_sessions").delete().eq("id", checkout.id);
        return { error: "Este cupom acabou de ser usado em outra compra. Atualize seu Clube HotBox." };
      }
    }

    return { checkout };
  });

export const getSiteCheckoutStatus = createServerFn({ method: "GET" })
  .inputValidator((data: { checkoutId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,payment_kind,payment_provider,total,order_id,stripe_session_id,stripe_payment_intent_id,mercadopago_payment_id,mercadopago_status,expires_at,created_at")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { error: "Checkout não encontrado." };
    return { checkout };
  });

export async function notifyPaidSiteOrder(supabaseAdmin: any, orderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,external_display_id,customer_name,customer_phone,payment_method,payment_confirmed_by")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.customer_phone) return;
  const firstName = String(order.customer_name || "cliente").trim().split(/\s+/)[0];
  const ref = order.external_display_id || order.order_number;
  const refText = ref ? ` #${String(ref).replace(/^#/, "")}` : "";
  const method = order.payment_method === "pix" ? "Pix" : "cartão";
  const provider = order.payment_confirmed_by === "infinitepay" ? "InfinitePay" : order.payment_confirmed_by === "mercadopago" ? "Mercado Pago" : "pagamento online";
  const message = `✅ *Pagamento confirmado via ${provider}*\n\nOlá, ${firstName}! O pagamento do pedido${refText} via ${method} foi confirmado. Seu pedido já entrou no sistema da Hotbox e seguirá para preparo. 🍟🔥\n\nVamos avisar por aqui cada etapa até a entrega.`;
  try {
    const { sendWhatsappText } = await import("@/lib/whatsapp-send.server");
    await sendWhatsappText(supabaseAdmin, order.customer_phone, message);
  } catch (e) {
    console.error("[site-checkout] pagamento confirmado, mas aviso WhatsApp falhou", e);
  }
}

export const cancelSiteCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; access_token?: string | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let userId: string | null = null;
    if (data.access_token) {
      const { data: authData } = await supabaseAdmin.auth.getUser(data.access_token);
      userId = authData?.user?.id || null;
    }
    const { data: checkout } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,customer_user_id,loyalty_reward_id")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (!checkout || checkout.status === "paid") return { ok: false } as const;
    if (checkout.loyalty_reward_id && (!userId || checkout.customer_user_id !== userId)) return { ok: false } as const;
    await (supabaseAdmin as any).from("site_checkout_sessions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", checkout.id);
    if (checkout.loyalty_reward_id && userId) {
      await (supabaseAdmin as any).from("loyalty_rewards")
        .update({ status: "available", checkout_id: null, reserved_at: null, updated_at: new Date().toISOString() })
        .eq("id", checkout.loyalty_reward_id)
        .eq("user_id", userId)
        .eq("status", "reserved")
        .eq("checkout_id", checkout.id);
    }
    return { ok: true } as const;
  });

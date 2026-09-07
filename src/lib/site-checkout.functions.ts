// HOTBOX_BUILD_20260905_SITE_CHECKOUT_SERVER_SPLIT
import { createServerFn } from "@tanstack/react-start";
import { getEffectivePrice } from "@/lib/promotions";

export type SitePaymentKind = "infinitepay" | "mercadopago" | "delivery_card" | "delivery_pix";

type CheckoutAddonInput = {
  option_id: string;
};

type CheckoutItemInput = {
  product_id: string;
  qty: number;
  notes?: string | null;
  addons?: CheckoutAddonInput[];
  order_bump_id?: string | null;
};

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
  items: CheckoutItemInput[];
};

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}


export const quoteSiteDelivery = createServerFn({ method: "POST" })
  .inputValidator((data: {
    neighborhood: string;
    street?: string | null;
    number?: string | null;
    city?: string | null;
  }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const neighborhood = String(data.neighborhood || "").trim();
    const street = String(data.street || "").trim();
    const number = String(data.number || "").trim();
    const city = String(data.city || "").trim();
    if (!neighborhood) return { supported: false, reason: "missing_neighborhood" } as const;

    const { data: area, error: areaError } = await (supabaseAdmin as any).rpc("check_delivery_area_public", {
      p_neighborhood: neighborhood,
      p_street: street || null,
    });
    if (areaError) return { supported: false, reason: "area_check_failed", error: areaError.message } as const;
    if (!area?.supported) return { supported: false, reason: area?.reason || "outside_area", neighborhood: area?.neighborhood || neighborhood } as const;

    const normalizedNeighborhood = String(area?.neighborhood || neighborhood);
    const pricingMode = area?.pricing_mode === "distance" ? "distance" : "neighborhood";
    if (pricingMode === "neighborhood") {
      const fee = Number(area?.fee ?? 0);
      return {
        supported: true,
        pricingMode,
        neighborhood: normalizedNeighborhood,
        fee: Number.isFinite(fee) ? fee : 0,
        distanceKm: null,
        needsNumber: false,
      } as const;
    }

    if (!street || !number) {
      return {
        supported: true,
        pricingMode,
        neighborhood: normalizedNeighborhood,
        fee: null,
        distanceKm: null,
        needsNumber: true,
      } as const;
    }

    const { data: cfg } = await (supabaseAdmin as any)
      .from("store_config")
      .select("delivery_pricing_mode,store_lat,store_lng,google_maps_api_key,delivery_fee_tiers,default_delivery_fee,fixed_delivery_city")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg || cfg.store_lat == null || cfg.store_lng == null) {
      return { supported: true, pricingMode, neighborhood: normalizedNeighborhood, needsNumber: false, quoteUnavailable: true, reason: "store_location_missing" } as const;
    }

    const fullAddress = `${street}, ${number}, ${normalizedNeighborhood}, ${city || cfg.fixed_delivery_city || "Duque de Caxias"} - RJ, Brasil`;
    const { calculateDeliveryFee } = await import("@/lib/delivery-distance.server");
    const result = await calculateDeliveryFee(
      {
        delivery_pricing_mode: "distance",
        store_lat: Number(cfg.store_lat),
        store_lng: Number(cfg.store_lng),
        google_maps_api_key: cfg.google_maps_api_key || null,
        delivery_fee_tiers: Array.isArray(cfg.delivery_fee_tiers) ? cfg.delivery_fee_tiers : [],
        default_delivery_fee: Number(cfg.default_delivery_fee || 0),
        fixed_delivery_city: cfg.fixed_delivery_city || null,
      },
      fullAddress,
      undefined,
      supabaseAdmin,
    );

    if (result.outOfArea) {
      return { supported: false, pricingMode, neighborhood: normalizedNeighborhood, reason: "distance_outside_area", distanceKm: result.distanceKm } as const;
    }
    if (!result.usedDistancePricing || result.distanceKm == null) {
      return { supported: true, pricingMode, neighborhood: normalizedNeighborhood, needsNumber: false, quoteUnavailable: true, reason: "distance_unavailable" } as const;
    }
    return {
      supported: true,
      pricingMode,
      neighborhood: normalizedNeighborhood,
      fee: Number(result.fee || 0),
      distanceKm: Number(result.distanceKm),
      needsNumber: false,
      uncertain: Boolean(result.uncertain),
    } as const;
  });

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
    if (!["infinitepay", "mercadopago", "delivery_card", "delivery_pix"].includes(String(data.payment_kind || ""))) {
      return { error: "Forma de pagamento inválida." };
    }

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select("digital_payment_provider,infinitepay_enabled,infinitepay_handle,mercadopago_enabled,mercadopago_public_key,mercadopago_access_token,digital_menu_card_enabled,digital_menu_pix_enabled,digital_menu_pay_on_delivery_enabled,digital_menu_pay_on_delivery_card_enabled,digital_menu_pay_on_delivery_pix_enabled,delivery_pricing_mode,store_lat,store_lng,google_maps_api_key,delivery_fee_tiers,default_delivery_fee,fixed_delivery_city")
      .eq("id", 1)
      .maybeSingle();

    const requestedPayment = String(data.payment_kind || "");
    const isPayOnDelivery = requestedPayment === "delivery_card" || requestedPayment === "delivery_pix";
    const activeProvider = String(cfg?.digital_payment_provider || "infinitepay") === "mercadopago" ? "mercadopago" : "infinitepay";

    if (isPayOnDelivery) {
      if (data.delivery_mode !== "delivery") return { error: "Pagamento na entrega só está disponível para pedidos com entrega." };
      if (cfg?.digital_menu_pay_on_delivery_enabled !== true) return { error: "Pagamento na entrega está desabilitado." };
      if (requestedPayment === "delivery_card" && cfg?.digital_menu_pay_on_delivery_card_enabled !== true) {
        return { error: "Cartão na entrega está desabilitado." };
      }
      if (requestedPayment === "delivery_pix" && cfg?.digital_menu_pay_on_delivery_pix_enabled !== true) {
        return { error: "Pix na entrega está desabilitado." };
      }
    } else if (activeProvider === "mercadopago") {
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
      const { data: area, error: areaError } = await (supabaseAdmin as any).rpc("check_delivery_area_public", {
        p_neighborhood: data.address_neighborhood,
        p_street: data.address_street || null,
      });
      if (areaError) return { error: "Não foi possível validar a área de entrega." };
      if (!area?.supported) return { error: "Esse endereço está fora da área de entrega própria." };
      normalizedNeighborhood = String(area?.neighborhood || data.address_neighborhood);

      if (area?.pricing_mode === "distance") {
        const { calculateDeliveryFee } = await import("@/lib/delivery-distance.server");
        const fullAddress = `${data.address_street}, ${data.address_number}, ${normalizedNeighborhood}, ${data.address_city || cfg?.fixed_delivery_city || "Duque de Caxias"} - RJ, Brasil`;
        const result = await calculateDeliveryFee(
          {
            delivery_pricing_mode: "distance",
            store_lat: cfg?.store_lat == null ? null : Number(cfg.store_lat),
            store_lng: cfg?.store_lng == null ? null : Number(cfg.store_lng),
            google_maps_api_key: cfg?.google_maps_api_key || null,
            delivery_fee_tiers: Array.isArray(cfg?.delivery_fee_tiers) ? cfg.delivery_fee_tiers : [],
            default_delivery_fee: Number(cfg?.default_delivery_fee || 0),
            fixed_delivery_city: cfg?.fixed_delivery_city || null,
          },
          fullAddress,
          undefined,
          supabaseAdmin,
        );
        if (result.outOfArea) return { error: "Esse endereço está fora da distância máxima configurada para entrega própria." };
        if (!result.usedDistancePricing || result.distanceKm == null) return { error: "Não foi possível calcular a distância desse endereço com segurança. Confira rua e número." };
        deliveryFee = Number(result.fee || 0);
      } else {
        deliveryFee = Number(area?.fee ?? cfg?.default_delivery_fee ?? 0) || 0;
      }
    }

    const requestedIds = Array.from(new Set(data.items.map((i) => String(i.product_id || "")).filter(Boolean)));
    const { data: products, error: productError } = await supabaseAdmin
      .from("products")
      .select("id,name,sale_price,active,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,loyalty_eligible")
      .in("id", requestedIds)
      .eq("active", true);
    if (productError) return { error: "Não foi possível validar os produtos." };

    const byId = new Map((products ?? []).map((p: any) => [String(p.id), p]));

    // Adicionais e order bumps são recalculados no servidor.
    const requestedAddonIds = Array.from(new Set(
      data.items.flatMap((item) => (item.addons || []).map((a) => String(a.option_id || "")).filter(Boolean)),
    ));
    const requestedBumpIds = Array.from(new Set(
      data.items.map((item) => String(item.order_bump_id || "")).filter(Boolean),
    ));

    const [{ data: addonOptions }, { data: addonLinks }, { data: addonGroups }, { data: orderBumps }] = await Promise.all([
      requestedAddonIds.length
        ? (supabaseAdmin as any).from("menu_addon_options").select("id,group_id,name,price,active").in("id", requestedAddonIds)
        : Promise.resolve({ data: [] }),
      requestedIds.length
        ? (supabaseAdmin as any).from("product_addon_groups").select("product_id,group_id").in("product_id", requestedIds)
        : Promise.resolve({ data: [] }),
      (supabaseAdmin as any).from("menu_addon_groups").select("id,name,required,min_select,max_select,active"),
      requestedBumpIds.length
        ? (supabaseAdmin as any).from("menu_order_bumps").select("id,product_id,price_override,active").in("id", requestedBumpIds)
        : Promise.resolve({ data: [] }),
    ]);

    const addonById = new Map((addonOptions ?? []).map((a: any) => [String(a.id), a]));
    const groupById = new Map((addonGroups ?? []).map((g: any) => [String(g.id), g]));
    const groupsByProduct = new Map<string, Set<string>>();
    for (const link of addonLinks ?? []) {
      const productId = String((link as any).product_id);
      const set = groupsByProduct.get(productId) || new Set<string>();
      set.add(String((link as any).group_id));
      groupsByProduct.set(productId, set);
    }
    const bumpById = new Map((orderBumps ?? []).map((b: any) => [String(b.id), b]));

    const serverItems: any[] = [];
    for (const item of data.items) {
      const productId = String(item.product_id);
      const p: any = byId.get(productId);
      if (!p) return { error: "Um dos produtos do carrinho não está mais disponível." };
      const qty = Math.max(1, Math.min(50, Number(item.qty || 1)));
      const eff = getEffectivePrice(p);
      if (!Number.isFinite(eff.price) || eff.price <= 0) return { error: `Preço inválido para ${p.name}.` };

      let basePrice = Number(eff.price);
      const bumpId = String(item.order_bump_id || "");
      if (bumpId) {
        const bump: any = bumpById.get(bumpId);
        if (!bump || bump.active !== true || String(bump.product_id) !== productId) {
          return { error: `A oferta rápida de ${p.name} não está mais disponível.` };
        }
        const override = Number(bump.price_override);
        if (Number.isFinite(override) && override >= 0) basePrice = override;
      }

      const selectedAddons: any[] = [];
      const selectedCountByGroup = new Map<string, number>();
      const allowedGroups = groupsByProduct.get(productId) || new Set<string>();
      for (const rawAddon of item.addons || []) {
        const option: any = addonById.get(String(rawAddon.option_id));
        if (!option || option.active !== true || !allowedGroups.has(String(option.group_id))) {
          return { error: `Um adicional de ${p.name} não está mais disponível.` };
        }
        const group: any = groupById.get(String(option.group_id));
        if (!group || group.active !== true) return { error: `Um grupo de adicionais de ${p.name} está indisponível.` };
        selectedCountByGroup.set(String(option.group_id), (selectedCountByGroup.get(String(option.group_id)) || 0) + 1);
        selectedAddons.push({
          option_id: String(option.id),
          group_id: String(option.group_id),
          name: String(option.name),
          price: Number(option.price || 0),
        });
      }

      for (const groupId of allowedGroups) {
        const group: any = groupById.get(groupId);
        if (!group || group.active !== true) continue;
        const count = selectedCountByGroup.get(groupId) || 0;
        const min = Math.max(0, Number(group.min_select || 0), group.required ? 1 : 0);
        const max = Math.max(1, Number(group.max_select || 1));
        if (count < min) return { error: `Escolha pelo menos ${min} opção(ões) em "${group.name}" para ${p.name}.` };
        if (count > max) return { error: `Escolha no máximo ${max} opção(ões) em "${group.name}" para ${p.name}.` };
      }

      const addonsTotal = Number(selectedAddons.reduce((sum, a) => sum + Number(a.price || 0), 0).toFixed(2));
      const userNotes = String(item.notes || "").trim();
      const addonNotes = selectedAddons.length
        ? `Adicionais: ${selectedAddons.map((a) => `${a.name}${Number(a.price) > 0 ? ` (+R$ ${Number(a.price).toFixed(2).replace(".", ",")})` : ""}`).join(", ")}`
        : "";
      const notes = [addonNotes, userNotes].filter(Boolean).join(" | ") || null;

      serverItems.push({
        product_id: p.id,
        product_name: p.name,
        qty,
        base_unit_price: basePrice,
        addons_total: addonsTotal,
        addons: selectedAddons,
        order_bump_id: bumpId || null,
        unit_price: Number((basePrice + addonsTotal).toFixed(2)),
        list_price: Number(eff.listPrice),
        is_promotion_price: Boolean(eff.isPromotion || (bumpId && basePrice !== Number(eff.price))),
        notes,
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
          .sort((a, b) => Number(b.base_unit_price ?? b.unit_price) - Number(a.base_unit_price ?? a.unit_price))[0];
        if (!eligible) return { error: "Adicione ao carrinho uma batata participante do Clube HotBox." };
        discount = Number(eligible.base_unit_price ?? eligible.unit_price ?? 0);
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
        payment_kind: isPayOnDelivery ? requestedPayment : activeProvider,
        payment_provider: isPayOnDelivery ? "pay_on_delivery" : activeProvider,
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
      .select("id,total,payment_kind,payment_provider,status,order_id")
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

    if (isPayOnDelivery) {
      const method = requestedPayment === "delivery_pix" ? "pix" : "card";
      const { data: finalized, error: finalizeError } = await (supabaseAdmin as any).rpc("finalize_site_checkout_pay_on_delivery", {
        p_checkout_id: checkout.id,
        p_method: method,
      });
      if (finalizeError || !finalized?.ok) {
        return { error: finalizeError?.message || finalized?.error || "Não foi possível criar o pedido para pagamento na entrega." };
      }
      return {
        checkout: {
          ...checkout,
          status: "ordered",
          payment_kind: requestedPayment,
          payment_provider: "pay_on_delivery",
          order_id: finalized.order_id,
        },
        order_id: finalized.order_id,
        pay_on_delivery: true,
        payment_method: method,
      };
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

import { createServerFn } from "@tanstack/react-start";

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

async function authenticatedCustomer(accessToken?: string | null) {
  if (!accessToken) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

async function ensureCustomer(user: any, name?: string | null, phone?: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const fullName = String(name || user.user_metadata?.full_name || user.user_metadata?.name || "").trim() || null;
  const email = String(user.email || "").trim() || null;
  const cleanPhone = digits(phone) || null;

  await (supabaseAdmin as any).from("customer_profiles").upsert(
    {
      user_id: user.id,
      full_name: fullName,
      email,
      ...(cleanPhone ? { phone: cleanPhone } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  await (supabaseAdmin as any).from("loyalty_accounts").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
}

export const getCustomerLoyaltyStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, authenticated: false } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureCustomer(user);
    await (supabaseAdmin as any).rpc("release_stale_loyalty_rewards", { p_user_id: user.id });

    const [{ data: cfg }, { data: profile }, { data: account }, { data: rewards }, { data: ledger }] = await Promise.all([
      (supabaseAdmin as any).from("store_config").select("loyalty_enabled,loyalty_orders_required").eq("id", 1).maybeSingle(),
      (supabaseAdmin as any).from("customer_profiles").select("full_name,email,phone").eq("user_id", user.id).maybeSingle(),
      (supabaseAdmin as any).from("loyalty_accounts").select("points,lifetime_qualifying_orders,rewards_earned,rewards_redeemed").eq("user_id", user.id).maybeSingle(),
      (supabaseAdmin as any).from("loyalty_rewards").select("id,code,status,earned_at,redeemed_at").eq("user_id", user.id).in("status", ["available", "reserved"]).order("earned_at", { ascending: false }),
      (supabaseAdmin as any).from("loyalty_ledger").select("id,event_type,points_delta,description,created_at,order_id").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
    ]);

    return {
      ok: true,
      authenticated: true,
      user: { id: user.id, email: user.email ?? null, name: profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || null, phone: profile?.phone || null },
      enabled: cfg?.loyalty_enabled !== false,
      required: Math.max(1, Number(cfg?.loyalty_orders_required || 10)),
      points: Math.max(0, Number(account?.points || 0)),
      lifetimeOrders: Math.max(0, Number(account?.lifetime_qualifying_orders || 0)),
      rewardsEarned: Math.max(0, Number(account?.rewards_earned || 0)),
      rewardsRedeemed: Math.max(0, Number(account?.rewards_redeemed || 0)),
      rewards: rewards ?? [],
      history: ledger ?? [],
    } as const;
  });

export const quoteLoyaltyReward = createServerFn({ method: "POST" })
  .inputValidator((data: {
    accessToken?: string | null;
    code: string;
    deliveryMode: "delivery" | "pickup";
    items: Array<{ product_id: string; qty: number }>;
  }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, reason: "Entre na sua conta do Clube HotBox para usar este cupom." } as const;
    if (data.deliveryMode !== "delivery") return { ok: false, reason: "A recompensa do Clube HotBox é válida em pedidos com entrega." } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).rpc("release_stale_loyalty_rewards", { p_user_id: user.id });
    const code = String(data.code || "").trim().toUpperCase();
    const { data: reward } = await (supabaseAdmin as any)
      .from("loyalty_rewards")
      .select("id,code,status,user_id")
      .eq("user_id", user.id)
      .ilike("code", code)
      .in("status", ["available", "reserved"])
      .maybeSingle();
    if (!reward) return { ok: false, reason: "Este cupom de fidelidade não está disponível nesta conta." } as const;
    if (reward.status === "reserved") return { ok: false, reason: "Este cupom já está reservado em uma compra em andamento." } as const;

    const ids = Array.from(new Set((data.items || []).map((i) => String(i.product_id || "")).filter(Boolean)));
    if (!ids.length) return { ok: false, reason: "Adicione uma batata ao carrinho para usar sua recompensa." } as const;
    const { data: products } = await (supabaseAdmin as any)
      .from("products")
      .select("id,name,sale_price,active,loyalty_eligible,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end")
      .in("id", ids)
      .eq("active", true);
    const { getEffectivePrice } = await import("@/lib/promotions");
    let best: { id: string; name: string; price: number } | null = null;
    for (const p of products ?? []) {
      if (!(p as any).loyalty_eligible) continue;
      const cartRow = data.items.find((i) => i.product_id === p.id && Number(i.qty || 0) > 0);
      if (!cartRow) continue;
      const price = Number(getEffectivePrice(p as any).price || 0);
      if (price > 0 && (!best || price > best.price)) best = { id: p.id, name: p.name, price };
    }
    if (!best) return { ok: false, reason: "Este carrinho não possui uma batata participante do Clube HotBox." } as const;
    return { ok: true, code: reward.code, discount: best.price, rewardId: reward.id, productId: best.id, productName: best.name } as const;
  });

export const getLoyaltyAdminData = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, error: "Sessão inválida." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", user.id).eq("role", "store_admin").maybeSingle();
    if (!role) return { ok: false, error: "Acesso não autorizado." } as const;

    const [{ data: cfg }, { data: products }, { data: accounts }, { data: rewards }] = await Promise.all([
      (supabaseAdmin as any).from("store_config").select("loyalty_enabled,loyalty_orders_required").eq("id", 1).maybeSingle(),
      (supabaseAdmin as any).from("products").select("id,name,category,kind,active,loyalty_eligible").order("name"),
      (supabaseAdmin as any).from("loyalty_accounts").select("user_id,points,lifetime_qualifying_orders,rewards_earned,rewards_redeemed,updated_at").order("updated_at", { ascending: false }).limit(200),
      (supabaseAdmin as any).from("loyalty_rewards").select("id,user_id,code,status,earned_at,redeemed_at").order("earned_at", { ascending: false }).limit(200),
    ]);
    const userIds = Array.from(new Set((accounts ?? []).map((a: any) => a.user_id)));
    const { data: profiles } = userIds.length
      ? await (supabaseAdmin as any).from("customer_profiles").select("user_id,full_name,email,phone").in("user_id", userIds)
      : { data: [] as any[] };
    const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    return {
      ok: true,
      config: { enabled: cfg?.loyalty_enabled !== false, required: Math.max(1, Number(cfg?.loyalty_orders_required || 10)) },
      products: products ?? [],
      accounts: (accounts ?? []).map((a: any) => ({ ...a, profile: profileMap.get(a.user_id) ?? null })),
      rewards: rewards ?? [],
    } as const;
  });

export const saveLoyaltyAdminConfig = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null; enabled: boolean; required: number }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, error: "Sessão inválida." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", user.id).eq("role", "store_admin").maybeSingle();
    if (!role) return { ok: false, error: "Acesso não autorizado." } as const;
    const required = Math.max(1, Math.min(50, Math.floor(Number(data.required || 10))));
    const { error } = await (supabaseAdmin as any).from("store_config").update({ loyalty_enabled: !!data.enabled, loyalty_orders_required: required }).eq("id", 1);
    return error ? { ok: false, error: error.message } as const : { ok: true } as const;
  });

export const setProductLoyaltyEligible = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null; productId: string; eligible: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, error: "Sessão inválida." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", user.id).eq("role", "store_admin").maybeSingle();
    if (!role) return { ok: false, error: "Acesso não autorizado." } as const;
    const { error } = await (supabaseAdmin as any).from("products").update({ loyalty_eligible: !!data.eligible }).eq("id", data.productId);
    return error ? { ok: false, error: error.message } as const : { ok: true } as const;
  });

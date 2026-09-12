import { createServerFn } from "@tanstack/react-start";
import { getEffectivePrice } from "@/lib/promotions";

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

async function requireStoreAdmin(accessToken?: string | null) {
  const user = await authenticatedCustomer(accessToken);
  if (!user) return { ok: false as const, error: "Sessão inválida." };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "store_admin")
    .maybeSingle();

  if (!role) return { ok: false as const, error: "Acesso não autorizado." };
  return { ok: true as const, user, supabaseAdmin };
}

async function ensureCustomer(user: any, name?: string | null, phone?: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const fullName =
    String(name || user.user_metadata?.full_name || user.user_metadata?.name || "").trim() || null;
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

  await (supabaseAdmin as any)
    .from("loyalty_accounts")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
}

export const getCustomerLoyaltyStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user) return { ok: false, authenticated: false } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureCustomer(user);
    await (supabaseAdmin as any).rpc("release_stale_loyalty_rewards", { p_user_id: user.id });

    const [
      { data: cfg },
      { data: profile },
      { data: account },
      { data: rewards },
      { data: ledger },
    ] = await Promise.all([
      (supabaseAdmin as any)
        .from("store_config")
        .select("loyalty_enabled,loyalty_orders_required")
        .eq("id", 1)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("customer_profiles")
        .select("full_name,email,phone")
        .eq("user_id", user.id)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("loyalty_accounts")
        .select("points,lifetime_qualifying_orders,rewards_earned,rewards_redeemed,active,admin_notes")
        .eq("user_id", user.id)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("loyalty_rewards")
        .select("id,code,status,earned_at,redeemed_at")
        .eq("user_id", user.id)
        .in("status", ["available", "reserved"])
        .order("earned_at", { ascending: false }),
      (supabaseAdmin as any)
        .from("loyalty_ledger")
        .select("id,event_type,points_delta,description,created_at,order_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const accountActive = account?.active !== false;

    return {
      ok: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email ?? null,
        name:
          profile?.full_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          null,
        phone: profile?.phone || null,
      },
      enabled: cfg?.loyalty_enabled !== false && accountActive,
      accountActive,
      required: Math.max(1, Number(cfg?.loyalty_orders_required || 10)),
      points: Math.max(0, Number(account?.points || 0)),
      lifetimeOrders: Math.max(0, Number(account?.lifetime_qualifying_orders || 0)),
      rewardsEarned: Math.max(0, Number(account?.rewards_earned || 0)),
      rewardsRedeemed: Math.max(0, Number(account?.rewards_redeemed || 0)),
      rewards: accountActive ? rewards ?? [] : [],
      history: ledger ?? [],
    } as const;
  });

export const quoteLoyaltyReward = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      code: string;
      deliveryMode: "delivery" | "pickup";
      items: Array<{ product_id: string; qty: number }>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await authenticatedCustomer(data.accessToken);
    if (!user)
      return {
        ok: false,
        reason: "Entre na sua conta do Clube HotBox para usar este cupom.",
      } as const;
    if (data.deliveryMode !== "delivery")
      return {
        ok: false,
        reason: "A recompensa do Clube HotBox é válida em pedidos com entrega.",
      } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: account } = await (supabaseAdmin as any)
      .from("loyalty_accounts")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (account?.active === false) {
      return { ok: false, reason: "Sua participação no Clube HotBox está inativa." } as const;
    }

    await (supabaseAdmin as any).rpc("release_stale_loyalty_rewards", {
      p_user_id: user.id,
    });

    const code = String(data.code || "").trim().toUpperCase();
    const { data: reward } = await (supabaseAdmin as any)
      .from("loyalty_rewards")
      .select("id,code,status,user_id")
      .eq("user_id", user.id)
      .ilike("code", code)
      .in("status", ["available", "reserved"])
      .maybeSingle();

    if (!reward)
      return {
        ok: false,
        reason: "Este cupom de fidelidade não está disponível nesta conta.",
      } as const;
    if (reward.status === "reserved")
      return {
        ok: false,
        reason: "Este cupom já está reservado em uma compra em andamento.",
      } as const;

    const ids = Array.from(
      new Set(
        (data.items || [])
          .map((i) => String(i.product_id || ""))
          .filter(Boolean),
      ),
    );
    if (!ids.length)
      return {
        ok: false,
        reason: "Adicione uma batata ao carrinho para usar sua recompensa.",
      } as const;

    const { data: products } = await (supabaseAdmin as any)
      .from("products")
      .select(
        "id,name,sale_price,active,loyalty_eligible,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end",
      )
      .in("id", ids)
      .eq("active", true);

    let best: { id: string; name: string; price: number } | null = null;

    for (const p of products ?? []) {
      if (!(p as any).loyalty_eligible) continue;
      const cartRow = data.items.find(
        (i) => i.product_id === p.id && Number(i.qty || 0) > 0,
      );
      if (!cartRow) continue;

      const price = Number(getEffectivePrice(p as any).price || 0);
      if (price > 0 && (!best || price > best.price)) {
        best = { id: p.id, name: p.name, price };
      }
    }

    if (!best)
      return {
        ok: false,
        reason: "Este carrinho não possui uma batata participante do Clube HotBox.",
      } as const;

    return {
      ok: true,
      code: reward.code,
      discount: best.price,
      rewardId: reward.id,
      productId: best.id,
      productName: best.name,
    } as const;
  });

export const getLoyaltyAdminData = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null }) => data)
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { supabaseAdmin } = auth;

    const [
      { data: cfg },
      { data: products },
      { data: accounts },
      { data: rewards },
      { data: profiles },
      { data: ledger },
    ] = await Promise.all([
      (supabaseAdmin as any)
        .from("store_config")
        .select("loyalty_enabled,loyalty_orders_required")
        .eq("id", 1)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("products")
        .select("id,name,category,kind,active,loyalty_eligible")
        .order("name"),
      (supabaseAdmin as any)
        .from("loyalty_accounts")
        .select(
          "user_id,points,lifetime_qualifying_orders,rewards_earned,rewards_redeemed,active,admin_notes,created_at,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(500),
      (supabaseAdmin as any)
        .from("loyalty_rewards")
        .select(
          "id,user_id,code,status,earned_at,redeemed_at,created_at,coupon_id",
        )
        .order("earned_at", { ascending: false })
        .limit(1000),
      (supabaseAdmin as any)
        .from("customer_profiles")
        .select("user_id,full_name,email,phone,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000),
      (supabaseAdmin as any)
        .from("loyalty_ledger")
        .select(
          "id,user_id,event_type,points_delta,description,created_at,order_id,reward_id",
        )
        .order("created_at", { ascending: false })
        .limit(1500),
    ]);

    const profileMap = new Map(
      (profiles ?? []).map((p: any) => [String(p.user_id), p]),
    );

    const accountUserIds = new Set(
      (accounts ?? []).map((a: any) => String(a.user_id)),
    );

    return {
      ok: true,
      config: {
        enabled: cfg?.loyalty_enabled !== false,
        required: Math.max(1, Number(cfg?.loyalty_orders_required || 10)),
      },
      products: products ?? [],
      accounts: (accounts ?? []).map((a: any) => ({
        ...a,
        active: a.active !== false,
        profile: profileMap.get(String(a.user_id)) ?? null,
      })),
      availableProfiles: (profiles ?? []).filter(
        (p: any) => !accountUserIds.has(String(p.user_id)),
      ),
      rewards: rewards ?? [],
      ledger: ledger ?? [],
    } as const;
  });

export const saveLoyaltyAdminConfig = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      enabled: boolean;
      required: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const required = Math.max(
      1,
      Math.min(50, Math.floor(Number(data.required || 10))),
    );

    const { error } = await (auth.supabaseAdmin as any)
      .from("store_config")
      .update({
        loyalty_enabled: !!data.enabled,
        loyalty_orders_required: required,
      })
      .eq("id", 1);

    return error
      ? ({ ok: false, error: error.message } as const)
      : ({ ok: true } as const);
  });

export const setProductLoyaltyEligible = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      productId: string;
      eligible: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { error } = await (auth.supabaseAdmin as any)
      .from("products")
      .update({ loyalty_eligible: !!data.eligible })
      .eq("id", data.productId);

    return error
      ? ({ ok: false, error: error.message } as const)
      : ({ ok: true } as const);
  });

export const addExistingCustomerToLoyalty = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      userId: string;
      initialPoints?: number;
      initialLifetimeOrders?: number;
      notes?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const points = Math.max(0, Math.floor(Number(data.initialPoints || 0)));
    const lifetime = Math.max(
      points,
      Math.floor(Number(data.initialLifetimeOrders || 0)),
    );

    const { error } = await (auth.supabaseAdmin as any)
      .from("loyalty_accounts")
      .upsert(
        {
          user_id: data.userId,
          points,
          lifetime_qualifying_orders: lifetime,
          active: true,
          admin_notes: String(data.notes || "").trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error) return { ok: false, error: error.message } as const;

    if (points > 0) {
      await (auth.supabaseAdmin as any).from("loyalty_ledger").insert({
        user_id: data.userId,
        event_type: "adjustment",
        points_delta: points,
        description: "Marcações iniciais adicionadas manualmente pela loja",
      });
    }

    const { data: synced, error: syncError } = await (auth.supabaseAdmin as any)
      .rpc("loyalty_admin_sync_rewards", { p_user_id: data.userId });

    if (syncError) return { ok: false, error: syncError.message } as const;
    return { ok: true, sync: synced } as const;
  });

export const updateLoyaltyParticipant = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      userId: string;
      fullName?: string | null;
      email?: string | null;
      phone?: string | null;
      points: number;
      lifetimeOrders: number;
      adminNotes?: string | null;
      reason?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { supabaseAdmin } = auth;
    const points = Math.max(0, Math.floor(Number(data.points || 0)));
    const lifetime = Math.max(0, Math.floor(Number(data.lifetimeOrders || 0)));

    const { data: account, error: accountError } = await (supabaseAdmin as any)
      .from("loyalty_accounts")
      .select("points,lifetime_qualifying_orders")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (accountError) return { ok: false, error: accountError.message } as const;
    if (!account) return { ok: false, error: "Participante não encontrado." } as const;

    const oldPoints = Math.max(0, Number(account.points || 0));
    const oldLifetime = Math.max(
      0,
      Number(account.lifetime_qualifying_orders || 0),
    );

    const [{ error: profileError }, { error: updateError }] = await Promise.all([
      (supabaseAdmin as any)
        .from("customer_profiles")
        .upsert(
          {
            user_id: data.userId,
            full_name: String(data.fullName || "").trim() || null,
            email: String(data.email || "").trim() || null,
            phone: digits(data.phone) || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        ),
      (supabaseAdmin as any)
        .from("loyalty_accounts")
        .update({
          points,
          lifetime_qualifying_orders: lifetime,
          admin_notes: String(data.adminNotes || "").trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", data.userId),
    ]);

    if (profileError) return { ok: false, error: profileError.message } as const;
    if (updateError) return { ok: false, error: updateError.message } as const;

    const pointDelta = points - oldPoints;
    const lifetimeDelta = lifetime - oldLifetime;
    if (pointDelta !== 0 || lifetimeDelta !== 0 || data.reason) {
      const description = [
        "Ajuste manual pela loja",
        pointDelta !== 0
          ? `marcações ${pointDelta > 0 ? "+" : ""}${pointDelta}`
          : null,
        lifetimeDelta !== 0
          ? `compras válidas ${lifetimeDelta > 0 ? "+" : ""}${lifetimeDelta}`
          : null,
        String(data.reason || "").trim() || null,
      ]
        .filter(Boolean)
        .join(" · ");

      await (supabaseAdmin as any).from("loyalty_ledger").insert({
        user_id: data.userId,
        event_type: "adjustment",
        points_delta: pointDelta,
        description,
      });
    }

    const { data: synced, error: syncError } = await (supabaseAdmin as any)
      .rpc("loyalty_admin_sync_rewards", { p_user_id: data.userId });

    if (syncError) return { ok: false, error: syncError.message } as const;

    return { ok: true, sync: synced } as const;
  });

export const adjustLoyaltyMarks = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      userId: string;
      delta: number;
      countAsPurchase?: boolean;
      reason?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const delta = Math.trunc(Number(data.delta || 0));
    if (!delta) return { ok: false, error: "Informe um ajuste diferente de zero." } as const;

    const { data: account, error } = await (auth.supabaseAdmin as any)
      .from("loyalty_accounts")
      .select("points,lifetime_qualifying_orders,active")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (error) return { ok: false, error: error.message } as const;
    if (!account) return { ok: false, error: "Participante não encontrado." } as const;
    if (account.active === false)
      return { ok: false, error: "Reative o participante antes de ajustar marcações." } as const;

    const currentPoints = Math.max(0, Number(account.points || 0));
    const currentLifetime = Math.max(
      0,
      Number(account.lifetime_qualifying_orders || 0),
    );
    const nextPoints = Math.max(0, currentPoints + delta);
    const appliedDelta = nextPoints - currentPoints;
    const nextLifetime = data.countAsPurchase
      ? Math.max(0, currentLifetime + appliedDelta)
      : currentLifetime;

    const { error: updateError } = await (auth.supabaseAdmin as any)
      .from("loyalty_accounts")
      .update({
        points: nextPoints,
        lifetime_qualifying_orders: nextLifetime,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", data.userId);

    if (updateError) return { ok: false, error: updateError.message } as const;

    await (auth.supabaseAdmin as any).from("loyalty_ledger").insert({
      user_id: data.userId,
      event_type: "adjustment",
      points_delta: appliedDelta,
      description:
        String(data.reason || "").trim() ||
        (appliedDelta > 0
          ? "Marcação adicionada manualmente pela loja"
          : "Marcação removida manualmente pela loja"),
    });

    const { data: synced, error: syncError } = await (auth.supabaseAdmin as any)
      .rpc("loyalty_admin_sync_rewards", { p_user_id: data.userId });

    if (syncError) return { ok: false, error: syncError.message } as const;

    return { ok: true, sync: synced } as const;
  });

export const issueManualLoyaltyReward = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      userId: string;
      reason?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { data: result, error } = await (auth.supabaseAdmin as any).rpc(
      "loyalty_admin_issue_reward",
      {
        p_user_id: data.userId,
        p_reason: String(data.reason || "").trim() || null,
      },
    );

    return error
      ? ({ ok: false, error: error.message } as const)
      : ({ ok: true, reward: result } as const);
  });

export const cancelLoyaltyRewardAdmin = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      rewardId: string;
      reason?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { data: result, error } = await (auth.supabaseAdmin as any).rpc(
      "loyalty_admin_cancel_reward",
      {
        p_reward_id: data.rewardId,
        p_reason: String(data.reason || "").trim() || null,
      },
    );

    return error
      ? ({ ok: false, error: error.message } as const)
      : ({ ok: true, reward: result } as const);
  });

export const setLoyaltyParticipantActive = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      accessToken?: string | null;
      userId: string;
      active: boolean;
      reason?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;

    const { data: result, error } = await (auth.supabaseAdmin as any).rpc(
      "loyalty_admin_set_participant_active",
      {
        p_user_id: data.userId,
        p_active: !!data.active,
        p_reason: String(data.reason || "").trim() || null,
      },
    );

    return error
      ? ({ ok: false, error: error.message } as const)
      : ({ ok: true, participant: result } as const);
  });

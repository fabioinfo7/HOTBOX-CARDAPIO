import { createServerFn } from "@tanstack/react-start";

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

async function requireStoreAdmin(accessToken?: string | null) {
  if (!accessToken) return { ok: false as const, error: "Sessão inválida." };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { ok: false as const, error: "Sessão inválida." };
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "store_admin")
    .maybeSingle();
  if (!role) return { ok: false as const, error: "Acesso não autorizado." };
  return { ok: true as const, supabaseAdmin, user: data.user };
}

export type SalesRecoverySettings = {
  enabled: boolean;
  mode: "manual" | "automatic";
  abandoned_checkout_enabled: boolean;
  rejected_payment_enabled: boolean;
  abandoned_delay_minutes: number;
  rejected_delay_minutes: number;
  cooldown_hours: number;
  max_messages_per_phone_24h: number;
  abandoned_message: string;
  rejected_message: string;
};

export const getSalesRecoveryAdminData = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null; days?: number }) => data)
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;
    const { supabaseAdmin } = auth;
    const days = Math.max(1, Math.min(90, Number(data.days || 30)));
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [{ data: settings }, { data: sessions }, { data: events }, { data: logs }] = await Promise.all([
      (supabaseAdmin as any).from("sales_recovery_settings").select("*").eq("id", 1).maybeSingle(),
      (supabaseAdmin as any)
        .from("analytics_sessions")
        .select("id,customer_name,customer_phone,converted,last_seen_at,source,medium,campaign,checkout_id,order_id,revenue")
        .gte("first_seen_at", since)
        .not("customer_phone", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(5000),
      (supabaseAdmin as any)
        .from("analytics_events")
        .select("session_id,event_name,created_at,value,payment_method")
        .gte("created_at", since)
        .in("event_name", ["checkout_started", "payment_failed", "purchase", "order_created"])
        .order("created_at", { ascending: false })
        .limit(15000),
      (supabaseAdmin as any)
        .from("sales_recovery_log")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);

    const bySession = new Map<string, any[]>();
    for (const event of events || []) {
      const key = String(event.session_id || "");
      if (!key) continue;
      const list = bySession.get(key) || [];
      list.push(event);
      bySession.set(key, list);
    }

    const logKey = new Set(
      (logs || [])
        .filter((log: any) => ["sent", "skipped", "cancelled"].includes(String(log.status)))
        .map((log: any) => `${log.analytics_session_id || ""}:${log.recovery_type}`),
    );

    const now = Date.now();
    const opportunities = (sessions || []).flatMap((session: any) => {
      if (session.converted || !digits(session.customer_phone)) return [];
      const sessionEvents = bySession.get(String(session.id)) || [];
      const rejected = sessionEvents.find((e: any) => e.event_name === "payment_failed");
      const checkout = sessionEvents.find((e: any) => e.event_name === "checkout_started");
      const purchased = sessionEvents.some((e: any) => ["purchase", "order_created"].includes(e.event_name));
      if (purchased) return [];

      let type: "rejected_payment" | "abandoned_checkout" | null = null;
      let triggerAt = String(session.last_seen_at || "");
      let attemptedValue = Number(session.revenue || 0);
      if (rejected) {
        type = "rejected_payment";
        triggerAt = String(rejected.created_at || triggerAt);
        attemptedValue = Number(rejected.value || attemptedValue || 0);
      } else if (checkout) {
        type = "abandoned_checkout";
        // Abandono conta a partir do último sinal do visitante, não do momento
        // em que ele abriu o checkout. Assim não incomodamos quem ainda está preenchendo.
        triggerAt = String(session.last_seen_at || checkout.created_at || triggerAt);
      }
      if (!type) return [];

      const alreadyHandled = logKey.has(`${session.id}:${type}`);
      const minutesAgo = triggerAt ? Math.max(0, Math.floor((now - new Date(triggerAt).getTime()) / 60000)) : 0;
      return [{
        session_id: String(session.id),
        customer_name: session.customer_name || null,
        customer_phone: digits(session.customer_phone),
        recovery_type: type,
        trigger_at: triggerAt,
        minutes_ago: minutesAgo,
        source: session.source || null,
        medium: session.medium || null,
        campaign: session.campaign || null,
        checkout_id: session.checkout_id || null,
        order_id: session.order_id || null,
        attempted_value: attemptedValue,
        already_handled: alreadyHandled,
      }];
    });

    return {
      ok: true as const,
      settings: settings || null,
      opportunities,
      logs: logs || [],
    };
  });

export const saveSalesRecoverySettings = createServerFn({ method: "POST" })
  .inputValidator((data: { accessToken?: string | null; settings: SalesRecoverySettings }) => data)
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;
    const s = data.settings;
    const payload = {
      id: 1,
      enabled: Boolean(s.enabled),
      mode: s.mode === "automatic" ? "automatic" : "manual",
      abandoned_checkout_enabled: Boolean(s.abandoned_checkout_enabled),
      rejected_payment_enabled: Boolean(s.rejected_payment_enabled),
      abandoned_delay_minutes: Math.max(5, Math.min(1440, Number(s.abandoned_delay_minutes || 20))),
      rejected_delay_minutes: Math.max(0, Math.min(1440, Number(s.rejected_delay_minutes || 5))),
      cooldown_hours: Math.max(1, Math.min(720, Number(s.cooldown_hours || 24))),
      max_messages_per_phone_24h: Math.max(1, Math.min(10, Number(s.max_messages_per_phone_24h || 1))),
      abandoned_message: String(s.abandoned_message || "").trim(),
      rejected_message: String(s.rejected_message || "").trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await (auth.supabaseAdmin as any)
      .from("sales_recovery_settings")
      .upsert(payload, { onConflict: "id" });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const sendSalesRecoveryNow = createServerFn({ method: "POST" })
  .inputValidator((data: {
    accessToken?: string | null;
    sessionId: string;
    recoveryType: "abandoned_checkout" | "rejected_payment";
    message?: string | null;
  }) => data)
  .handler(async ({ data }) => {
    const auth = await requireStoreAdmin(data.accessToken);
    if (!auth.ok) return auth;
    const { supabaseAdmin } = auth;

    const { data: session } = await (supabaseAdmin as any)
      .from("analytics_sessions")
      .select("id,customer_name,customer_phone,converted,source,campaign,checkout_id,order_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) return { ok: false as const, error: "Sessão não encontrada." };
    if (session.converted) return { ok: false as const, error: "Esse cliente já concluiu a compra." };
    const phone = digits(session.customer_phone);
    if (!phone) return { ok: false as const, error: "Cliente ainda não informou telefone." };

    const { data: order } = await (supabaseAdmin as any)
      .from("orders")
      .select("id")
      .eq("customer_phone", phone)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (order) return { ok: false as const, error: "Esse telefone já possui pedido registrado." };

    const { data: cfg } = await (supabaseAdmin as any)
      .from("sales_recovery_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    const fallback = data.recoveryType === "rejected_payment" ? cfg?.rejected_message : cfg?.abandoned_message;
    const message = String(data.message || fallback || "Olá! Aqui é da HotBox Delivery. Posso te ajudar a finalizar seu pedido?").trim();

    const { sendEvolutionMarketingText } = await import("@/lib/whatsapp-send.server");
    const result = await sendEvolutionMarketingText(supabaseAdmin, phone, message);

    await (supabaseAdmin as any).from("sales_recovery_log").insert({
      analytics_session_id: String(session.id),
      customer_phone: phone,
      customer_name: session.customer_name || null,
      recovery_type: data.recoveryType,
      mode: "manual",
      status: result.ok ? "sent" : "failed",
      message,
      source: session.source || null,
      campaign: session.campaign || null,
      checkout_id: session.checkout_id || null,
      order_id: session.order_id || null,
      sent_at: result.ok ? new Date().toISOString() : null,
      error_message: result.ok ? null : (result.error || "Falha no número promocional da Evolution"),
    });

    return result.ok
      ? { ok: true as const }
      : { ok: false as const, error: result.error || "Não foi possível enviar pelo número promocional da Evolution." };
  });

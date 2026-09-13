import { createFileRoute } from "@tanstack/react-router";
import { sendWhatsappText } from "@/lib/whatsapp-send.server";

// Chamado por pg_cron a cada 5min. Lê alertas não notificados, envia pelo
// WhatsApp (Evolution ou Meta, conforme o provedor ativo em /loja/config)
// para o telefone do admin, e marca como notificado.
// Email só é enviado se o domínio de email do projeto estiver configurado.


async function processAutomaticSalesRecovery(supabaseAdmin: any) {
  const { data: cfg } = await supabaseAdmin
    .from("sales_recovery_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!cfg?.enabled || cfg?.mode !== "automatic") {
    return { enabled: false, sent: 0, skipped: 0, failed: 0 };
  }

  const lookback = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: sessions } = await supabaseAdmin
    .from("analytics_sessions")
    .select("id,customer_name,customer_phone,converted,last_seen_at,source,campaign,checkout_id,order_id")
    .eq("converted", false)
    .not("customer_phone", "is", null)
    .gte("last_seen_at", lookback)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (!sessions?.length) return { enabled: true, sent: 0, skipped: 0, failed: 0 };

  const sessionIds = sessions.map((s: any) => String(s.id));
  const { data: events } = await supabaseAdmin
    .from("analytics_events")
    .select("session_id,event_name,created_at,value")
    .in("session_id", sessionIds)
    .in("event_name", ["checkout_started", "payment_failed", "purchase", "order_created"])
    .order("created_at", { ascending: false });

  const bySession = new Map<string, any[]>();
  for (const event of events || []) {
    const key = String(event.session_id || "");
    const list = bySession.get(key) || [];
    list.push(event);
    bySession.set(key, list);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const now = Date.now();

  for (const session of sessions) {
    const phone = String(session.customer_phone || "").replace(/\D/g, "");
    if (!phone) { skipped++; continue; }

    const sessionEvents = bySession.get(String(session.id)) || [];
    if (sessionEvents.some((e: any) => ["purchase", "order_created"].includes(e.event_name))) { skipped++; continue; }

    const rejected = sessionEvents.find((e: any) => e.event_name === "payment_failed");
    const checkout = sessionEvents.find((e: any) => e.event_name === "checkout_started");
    let recoveryType: "rejected_payment" | "abandoned_checkout" | null = null;
    let triggerAt = String(session.last_seen_at || "");
    let delayMinutes = 0;
    let message = "";

    if (rejected && cfg.rejected_payment_enabled) {
      recoveryType = "rejected_payment";
      triggerAt = String(rejected.created_at || triggerAt);
      delayMinutes = Number(cfg.rejected_delay_minutes || 0);
      message = String(cfg.rejected_message || "").trim();
    } else if (checkout && cfg.abandoned_checkout_enabled) {
      recoveryType = "abandoned_checkout";
      // Só considera abandonado depois que a pessoa realmente parou de navegar.
      triggerAt = String(session.last_seen_at || checkout.created_at || triggerAt);
      delayMinutes = Number(cfg.abandoned_delay_minutes || 20);
      message = String(cfg.abandoned_message || "").trim();
    }

    if (!recoveryType || !message) { skipped++; continue; }
    if (now - new Date(triggerAt).getTime() < delayMinutes * 60000) { skipped++; continue; }

    const { data: existing } = await supabaseAdmin
      .from("sales_recovery_log")
      .select("id")
      .eq("analytics_session_id", String(session.id))
      .eq("recovery_type", recoveryType)
      .in("status", ["sent", "skipped", "cancelled"])
      .limit(1)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    const cooldownSince = new Date(now - Number(cfg.cooldown_hours || 24) * 3600000).toISOString();
    const { count: recentCount } = await supabaseAdmin
      .from("sales_recovery_log")
      .select("id", { count: "exact", head: true })
      .eq("customer_phone", phone)
      .eq("status", "sent")
      .gte("sent_at", cooldownSince);
    if (Number(recentCount || 0) >= Number(cfg.max_messages_per_phone_24h || 1)) { skipped++; continue; }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("customer_phone", phone)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (order) {
      await supabaseAdmin.from("sales_recovery_log").insert({
        analytics_session_id: String(session.id), customer_phone: phone, customer_name: session.customer_name || null,
        recovery_type: recoveryType, mode: "automatic", status: "cancelled", message, source: session.source || null,
        campaign: session.campaign || null, checkout_id: session.checkout_id || null, order_id: session.order_id || null,
        error_message: "cliente_ja_possui_pedido",
      });
      skipped++;
      continue;
    }

    try {
      const result = await sendWhatsappText(supabaseAdmin, phone, message);
      await supabaseAdmin.from("sales_recovery_log").insert({
        analytics_session_id: String(session.id), customer_phone: phone, customer_name: session.customer_name || null,
        recovery_type: recoveryType, mode: "automatic", status: result.ok ? "sent" : "failed", message,
        source: session.source || null, campaign: session.campaign || null, checkout_id: session.checkout_id || null,
        order_id: session.order_id || null, sent_at: result.ok ? new Date().toISOString() : null,
        error_message: result.ok ? null : "falha_no_provedor_whatsapp",
      });
      if (result.ok) sent++; else failed++;
    } catch (error: any) {
      failed++;
      await supabaseAdmin.from("sales_recovery_log").insert({
        analytics_session_id: String(session.id), customer_phone: phone, customer_name: session.customer_name || null,
        recovery_type: recoveryType, mode: "automatic", status: "failed", message, source: session.source || null,
        campaign: session.campaign || null, checkout_id: session.checkout_id || null, order_id: session.order_id || null,
        error_message: String(error?.message || error).slice(0, 500),
      });
    }
  }

  return { enabled: true, sent, skipped, failed };
}

export const Route = createFileRoute("/api/public/hooks/system-alerts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let recovery = { enabled: false, sent: 0, skipped: 0, failed: 0 };
        try {
          recovery = await processAutomaticSalesRecovery(supabaseAdmin);
        } catch (error) {
          console.error("[sales-recovery] falha no processamento automático:", error);
        }

        // primeiro roda o auto-cancel Pix (dupla garantia caso o cron SQL falhe)
        try {
          await supabaseAdmin.rpc("auto_cancel_stale_pix");
        } catch {
          /* ignore */
        }

        const { data: alerts } = await supabaseAdmin
          .from("system_alerts")
          .select("id, kind, severity, message, context, created_at")
          .is("notified_at", null)
          .order("created_at", { ascending: true })
          .limit(20);

        if (!alerts?.length) return Response.json({ ok: true, sent: 0, recovery });

        const { data: cfg } = await supabaseAdmin
          .from("store_config")
          .select(
            "store_name, admin_alert_phone, admin_alert_email, whatsapp_provider, evolution_api_url, evolution_api_token, evolution_instance, meta_access_token, meta_phone_number_id",
          )
          .maybeSingle();

        const phone = cfg?.admin_alert_phone?.replace(/\D/g, "") || "";
        const provider = cfg?.whatsapp_provider === "meta" ? "meta" : "evolution";
        const providerConfigured =
          provider === "meta"
            ? !!(cfg?.meta_access_token && cfg?.meta_phone_number_id)
            : !!(cfg?.evolution_api_url && cfg?.evolution_instance && cfg?.evolution_api_token);
        const canWa = !!(phone && providerConfigured);
        const notifiedIds: string[] = [];

        // se não dá nem pra tentar mandar WhatsApp, NÃO marca como notificado —
        // assim, assim que a configuração for corrigida, esses alertas pendentes
        // são enviados na próxima passada, em vez de ficarem perdidos pra sempre
        if (!canWa) {
          return Response.json({
            ok: true,
            sent: 0,
            whatsapp: false,
            pending: alerts.length,
            error: "WhatsApp não configurado — alertas continuam pendentes até isso ser corrigido",
          });
        }

        for (const a of alerts) {
          const emoji = a.severity === "info" ? "ℹ️" : a.severity === "warn" ? "⚠️" : "🚨";
          const text = `${emoji} *${cfg?.store_name ?? "Loja"}* — alerta\n\n*${a.kind}*\n${a.message}\n\n_${new Date(a.created_at).toLocaleString("pt-BR")}_`;

          try {
            const sent = await sendWhatsappText(supabaseAdmin, phone, text);
            if (sent.ok) notifiedIds.push(a.id);
            else console.error("[system-alerts] envio recusado pelo provedor ativo");
          } catch (e) {
            console.error("[system-alerts] falha enviando WhatsApp:", e);
          }
        }

        if (notifiedIds.length) {
          await supabaseAdmin
            .from("system_alerts")
            .update({ notified_at: new Date().toISOString() })
            .in("id", notifiedIds);
        }

        return Response.json({ ok: true, sent: notifiedIds.length, whatsapp: canWa, recovery });
      },
    },
  },
});

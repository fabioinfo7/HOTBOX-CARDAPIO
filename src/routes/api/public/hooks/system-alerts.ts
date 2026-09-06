import { createFileRoute } from "@tanstack/react-router";
import { sendWhatsappText } from "@/lib/whatsapp-send.server";

// Chamado por pg_cron a cada 5min. Lê alertas não notificados, envia pelo
// WhatsApp (Evolution ou Meta, conforme o provedor ativo em /loja/config)
// para o telefone do admin, e marca como notificado.
// Email só é enviado se o domínio de email do projeto estiver configurado.

export const Route = createFileRoute("/api/public/hooks/system-alerts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

        if (!alerts?.length) return Response.json({ ok: true, sent: 0 });

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

        return Response.json({ ok: true, sent: notifiedIds.length, whatsapp: canWa });
      },
    },
  },
});

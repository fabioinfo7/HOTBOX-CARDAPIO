import { createServerFn } from "@tanstack/react-start";

export const testAlertFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await supabaseAdmin.rpc("record_system_alert", {
    _kind: "teste_manual",
    _message:
      "Isso é um alerta de teste — se você recebeu essa mensagem no WhatsApp, o sistema de alertas está funcionando de ponta a ponta! 🎉",
    _severity: "info",
  });

  const { data: cfg } = await supabaseAdmin
    .from("store_config")
    .select(
      "admin_alert_phone, whatsapp_provider, evolution_api_url, evolution_api_token, evolution_instance, meta_access_token, meta_phone_number_id, app_public_url",
    )
    .maybeSingle();
  const provider = cfg?.whatsapp_provider === "meta" ? "meta" : "evolution";
  const providerConfigured =
    provider === "meta"
      ? !!(cfg?.meta_access_token && cfg?.meta_phone_number_id)
      : !!(cfg?.evolution_api_url && cfg?.evolution_instance && cfg?.evolution_api_token);
  const hasWhatsappConfig = !!(cfg?.admin_alert_phone && providerConfigured);

  if (!hasWhatsappConfig) {
    return {
      ok: false,
      error: `Falta configurar o telefone de alerta e/ou as credenciais do provedor ativo (${provider === "meta" ? "Meta Cloud API" : "Evolution API"}) antes de testar.`,
    };
  }
  if (!cfg?.app_public_url) {
    return {
      ok: false,
      error:
        "Falta configurar a 'URL pública do site' em Configurações → iFood (é usada por vários jobs automáticos, não só a iFood).",
    };
  }

  // dispara a notificação na hora, sem esperar o cron de 5 em 5 minutos
  const res = await fetch(`${cfg.app_public_url.replace(/\/$/, "")}/api/public/hooks/system-alerts`, {
    method: "POST",
  });
  const json: any = await res.json().catch(() => ({}));

  return { ok: true, sent: json?.sent ?? 0, whatsapp: json?.whatsapp ?? false };
});

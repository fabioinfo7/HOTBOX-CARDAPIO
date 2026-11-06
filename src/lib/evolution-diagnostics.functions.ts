import { createServerFn } from "@tanstack/react-start";

/**
 * Diagnóstico somente de leitura: confirma que o servidor do Hotbox alcança
 * a Evolution API e consulta o estado da instância. Não envia mensagens,
 * não altera a conexão e não interfere no webhook de entrada.
 */
export const testEvolutionConnectionFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cfg, error } = await supabaseAdmin
    .from("store_config")
    .select("evolution_api_url, evolution_instance, evolution_api_token, evolution_disabled, whatsapp_provider")
    .maybeSingle();

  if (error) return { ok: false, apiOk: false, instanceOk: false, error: "Não foi possível ler as configurações salvas do WhatsApp." };
  if (cfg?.whatsapp_provider === "meta") {
    return { ok: false, apiOk: false, instanceOk: false, error: "A Meta está selecionada como provedor ativo. Selecione Evolution API para testar essa conexão." };
  }
  if (cfg?.evolution_disabled) {
    return { ok: false, apiOk: false, instanceOk: false, error: "A Evolution está desativada pelo botão de emergência. Ative-a para testar." };
  }
  if (!cfg?.evolution_api_url || !cfg?.evolution_instance || !cfg?.evolution_api_token) {
    return { ok: false, apiOk: false, instanceOk: false, error: "Preencha e salve a URL, o nome da instância e o token da Evolution API." };
  }

  const baseUrl = String(cfg.evolution_api_url).trim().replace(/\/+$/, "");
  const instance = encodeURIComponent(String(cfg.evolution_instance).trim());
  try {
    const response = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      method: "GET",
      headers: { apikey: String(cfg.evolution_api_token) },
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        apiOk: true,
        instanceOk: false,
        status: response.status,
        error: `A Evolution respondeu HTTP ${response.status}. Confira a URL, o token e o nome da instância.`,
      };
    }

    let parsed: any = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch { /* resposta sem JSON */ }
    const state = String(parsed?.instance?.state ?? parsed?.state ?? parsed?.connectionStatus ?? "").toLowerCase();
    const connected = ["open", "connected", "online"].includes(state);
    return {
      ok: connected,
      apiOk: true,
      instanceOk: connected,
      state: state || "não informado",
      error: connected ? undefined : `A API respondeu, mas a instância não está conectada (estado: ${state || "não informado"}).`,
    };
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ok: false,
      apiOk: false,
      instanceOk: false,
      error: timedOut ? "A Evolution demorou mais de 10 segundos para responder." : "O servidor do Hotbox não conseguiu alcançar a Evolution API. Confira a URL e o serviço no Railway.",
    };
  }
});

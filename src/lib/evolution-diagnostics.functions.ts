import { createServerFn } from "@tanstack/react-start";

const EXPECTED_WEBHOOK_URL = "https://hotboxdelivery.up.railway.app/api/public/webhooks/evolution";

type DiagnosticCheck = {
  id: string;
  label: string;
  ok: boolean;
  level: "ok" | "warning" | "error";
  detail: string;
};

/**
 * Diagnóstico somente de leitura da integração Evolution -> Hotbox.
 * Consulta configurações, estado da instância, webhook registrado e banco.
 * Faz também um POST sintético de fromMe=true no endpoint público do Hotbox:
 * o próprio webhook deve ignorá-lo antes de criar conversa ou gravar mensagem.
 * Nenhuma mensagem é enviada a clientes e nenhuma configuração é alterada.
 */
export const testEvolutionConnectionFn = createServerFn({ method: "POST" }).handler(async () => {
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, level?: DiagnosticCheck["level"]) => {
    checks.push({ id, label, ok, detail, level: level ?? (ok ? "ok" : "error") });
  };

  let supabaseAdmin: any;
  let cfg: any;
  try {
    const mod = await import("@/integrations/supabase/client.server");
    supabaseAdmin = mod.supabaseAdmin;
    const { data, error } = await supabaseAdmin
      .from("store_config")
      .select("evolution_api_url, evolution_instance, evolution_api_token, evolution_disabled, whatsapp_provider, bot_global_active")
      .maybeSingle();
    if (error) throw error;
    cfg = data;
    add("supabase_config", "Configurações do Hotbox / Supabase", true, "O servidor conseguiu ler as configurações da integração.");
  } catch (err: any) {
    add("supabase_config", "Configurações do Hotbox / Supabase", false, err?.message || "Não foi possível consultar store_config.");
    return { ok: false, apiOk: false, instanceOk: false, checks, error: "Falha ao consultar as configurações do Hotbox." };
  }

  const providerOk = cfg?.whatsapp_provider !== "meta";
  add("provider", "Provedor ativo", providerOk, providerOk ? "Evolution API está selecionada." : "A Meta está selecionada. Troque o provedor para Evolution API se quiser usar esta integração.");
  const enabled = !cfg?.evolution_disabled;
  add("evolution_enabled", "Interruptor da Evolution", enabled, enabled ? "A Evolution não está desativada pelo sistema." : "A Evolution está desativada pelo botão de emergência.");
  add("manual_mode", "Atendimento manual", cfg?.bot_global_active === false, cfg?.bot_global_active === false ? "Resposta automática global desligada; as mensagens devem continuar sendo recebidas." : "A resposta automática global está ligada. Isso não impede o webhook, mas não corresponde ao modo manual solicitado.", cfg?.bot_global_active === false ? "ok" : "warning");

  if (!cfg?.evolution_api_url || !cfg?.evolution_instance || !cfg?.evolution_api_token) {
    add("credentials", "Credenciais da Evolution", false, "URL, instância ou token não estão preenchidos e salvos.");
    return { ok: false, apiOk: false, instanceOk: false, checks, error: "Faltam dados da Evolution nas configurações salvas." };
  }
  add("credentials", "Credenciais da Evolution", true, "URL, instância e token estão preenchidos (o token não é exibido).");

  const baseUrl = String(cfg.evolution_api_url).trim().replace(/\/+$/, "");
  const instance = encodeURIComponent(String(cfg.evolution_instance).trim());
  const headers = { apikey: String(cfg.evolution_api_token) };
  let apiOk = false;
  let instanceOk = false;

  try {
    const response = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text().catch(() => "");
    apiOk = response.ok;
    if (!response.ok) {
      add("evolution_api", "API Evolution", false, `A Evolution respondeu HTTP ${response.status}. Verifique URL e token.`);
      add("instance_state", "Estado do WhatsApp", false, "Não foi possível consultar o estado da instância.");
    } else {
      add("evolution_api", "API Evolution", true, `API respondeu HTTP ${response.status}.`);
      let parsed: any = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { /* resposta sem JSON */ }
      const state = String(parsed?.instance?.state ?? parsed?.state ?? parsed?.connectionStatus ?? "").toLowerCase();
      instanceOk = ["open", "connected", "online"].includes(state);
      add("instance_state", "Estado do WhatsApp", instanceOk, `Estado informado pela Evolution: ${state || "não informado"}.`);
    }
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    add("evolution_api", "API Evolution", false, timedOut ? "A Evolution não respondeu em 10 segundos." : "O servidor Hotbox não conseguiu alcançar a URL da Evolution.");
    add("instance_state", "Estado do WhatsApp", false, "Não foi possível consultar o estado da instância.");
  }

  // Confere o webhook realmente salvo dentro da instância (consulta GET; não altera nada).
  let webhookUrl = "";
  let webhookEvents: string[] = [];
  let webhookEnabled = false;
  let webhookByEvents = false;
  try {
    const response = await fetch(`${baseUrl}/webhook/find/${instance}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      add("webhook_read", "Leitura do webhook na Evolution", false, `GET /webhook/find respondeu HTTP ${response.status}. A versão da API, URL ou token pode não permitir essa consulta.`);
    } else {
      let parsed: any = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { /* resposta sem JSON */ }
      const hook = parsed?.webhook ?? parsed?.data?.webhook ?? parsed;
      webhookUrl = String(hook?.url ?? "");
      webhookEnabled = hook?.enabled === true;
      webhookByEvents = hook?.webhookByEvents === true || hook?.webhook_by_events === true;
      webhookEvents = Array.isArray(hook?.events) ? hook.events.map((event: unknown) => String(event).toUpperCase().replaceAll(".", "_")) : [];
      add("webhook_read", "Leitura do webhook na Evolution", true, "A configuração atual do webhook foi consultada.");
      add("webhook_enabled", "Webhook habilitado", webhookEnabled, webhookEnabled ? "A Evolution informa que o webhook está habilitado." : "O webhook está desabilitado na instância.");
      const urlMatches = webhookUrl.replace(/\/+$/, "") === EXPECTED_WEBHOOK_URL;
      add("webhook_url", "Endereço de destino", urlMatches, webhookUrl ? `Configurado: ${webhookUrl}${urlMatches ? "" : ` · Esperado: ${EXPECTED_WEBHOOK_URL}`}` : `Nenhum endereço configurado. Esperado: ${EXPECTED_WEBHOOK_URL}`);
      const hasMessageEvent = webhookEvents.includes("MESSAGES_UPSERT");
      add("webhook_event", "Evento de novas mensagens", hasMessageEvent, hasMessageEvent ? "MESSAGES_UPSERT está na lista de eventos." : `MESSAGES_UPSERT não aparece na lista. Eventos atuais: ${webhookEvents.join(", ") || "nenhum"}.`);
      add("webhook_by_events", "Webhook by Events", !webhookByEvents, webhookByEvents ? "Está ativado; a Evolution pode acrescentar /messages-upsert ao endereço, mas o Hotbox espera a rota sem sufixo. Desative essa opção." : "Desativado; o evento deve chegar na rota principal, como esperado.");
    }
  } catch (err: any) {
    add("webhook_read", "Leitura do webhook na Evolution", false, err?.name === "TimeoutError" ? "A consulta do webhook expirou após 10 segundos." : err?.message || "Falha ao consultar o webhook.");
  }

  // Testa leitura do banco usado para o chat e recupera pistas de eventos anteriores.
  try {
    const { error: conversationsError } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("id", { count: "exact", head: true });
    const { error: messagesError } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true });
    if (conversationsError || messagesError) {
      add("chat_tables", "Tabelas do chat", false, conversationsError?.message || messagesError?.message || "Falha ao consultar tabelas do chat.");
    } else {
      add("chat_tables", "Tabelas do chat", true, "O servidor consegue consultar whatsapp_conversations e whatsapp_messages.");
    }

    const { data: lastInbound, error: inboundError } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("created_at, body")
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inboundError) {
      add("last_inbound", "Última mensagem recebida", false, inboundError.message, "warning");
    } else {
      add("last_inbound", "Última mensagem recebida", true, lastInbound?.created_at
        ? `Última entrada gravada em ${new Date(lastInbound.created_at).toLocaleString("pt-BR")}.`
        : "Nenhuma mensagem de entrada encontrada no histórico.");
    }

    const { data: lastWebhookLog, error: logError } = await supabaseAdmin
      .from("api_logs")
      .select("created_at, response_status, event_type, error_message")
      .eq("source", "evolution_webhook")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (logError) {
      add("webhook_logs", "Registro de erros do webhook", false, logError.message, "warning");
    } else if (lastWebhookLog) {
      const status = lastWebhookLog.response_status ?? "sem status";
      const clue = lastWebhookLog.error_message || lastWebhookLog.event_type || "Sem detalhe adicional.";
      add("webhook_logs", "Registro de erros do webhook", Number(lastWebhookLog.response_status) < 500, `Último registro: HTTP ${status} em ${new Date(lastWebhookLog.created_at).toLocaleString("pt-BR")}. ${clue}`, Number(lastWebhookLog.response_status) >= 500 ? "warning" : "ok");
    } else {
      add("webhook_logs", "Registro de erros do webhook", true, "Nenhum registro de webhook Evolution encontrado em api_logs. Isso pode indicar que a Evolution ainda não está chamando este endpoint.");
    }
  } catch (err: any) {
    add("chat_tables", "Tabelas do chat", false, err?.message || "Falha inesperada ao consultar o banco.");
  }

  // POST sintético seguro: fromMe=true faz o handler encerrar sem gravar mensagem.
  // Confirma que o domínio público do Hotbox atende POST nessa rota.
  try {
    const probeUrl = EXPECTED_WEBHOOK_URL;
    const response = await fetch(probeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: String(cfg.evolution_instance),
        data: {
          key: { id: "HOTBOX_DIAGNOSTIC_PROBE", fromMe: true, remoteJid: "5521999999999@s.whatsapp.net" },
          message: { conversation: "diagnostic probe - ignored" },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.text().catch(() => "");
    let parsed: any = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch { /* resposta sem JSON */ }
    const safelyIgnored = response.ok && (parsed?.ignored === "from_me" || parsed?.ok === true);
    add("hotbox_post", "Teste POST na rota pública do Hotbox", safelyIgnored, safelyIgnored
      ? "O endpoint público respondeu e ignorou corretamente a mensagem sintética de teste (nenhuma conversa foi criada)."
      : `O endpoint respondeu HTTP ${response.status}, mas não confirmou o processamento esperado. Resposta: ${body.slice(0, 220) || "vazia"}`);
  } catch (err: any) {
    add("hotbox_post", "Teste POST na rota pública do Hotbox", false, err?.name === "TimeoutError" ? "O endpoint do Hotbox não respondeu em 12 segundos." : err?.message || "Não foi possível alcançar a rota pública do Hotbox.");
  }

  const hasCriticalFailure = checks.some((check) => check.level === "error" && !check.ok);
  const hasWarning = checks.some((check) => check.level === "warning" && !check.ok);
  return {
    ok: !hasCriticalFailure && !hasWarning && apiOk && instanceOk,
    apiOk,
    instanceOk,
    state: instanceOk ? "open" : "não confirmado",
    webhookUrl,
    webhookEvents,
    checks,
    error: hasCriticalFailure || hasWarning ? "O diagnóstico encontrou pontos que precisam de atenção. Veja os detalhes abaixo." : undefined,
  };
});

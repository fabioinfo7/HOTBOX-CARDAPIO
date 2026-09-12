import { createServerFn } from "@tanstack/react-start";

// Independente do Lovable: usa as mesmas chaves de IA já cadastradas em
// Configurações (store_config.openai_api_key / groq_api_key) — o mesmo
// esquema usado pelo bot de atendimento automático do WhatsApp.
const AI_PROVIDERS = {
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
} as const;

export const askAboutLogsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { question: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: logs } = await supabaseAdmin
      .from("api_logs")
      .select("source, direction, response_status, error_message, response_body, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    const logsText = (logs ?? []).map((l: any) =>
      `[${new Date(l.created_at).toLocaleString("pt-BR")}] ${l.source} (${l.direction}) — status: ${l.response_status ?? "?"}${l.error_message ? ` — ERRO: ${l.error_message}` : ""}${l.response_body ? ` — detalhe: ${String(l.response_body).slice(0, 300)}` : ""}`,
    ).join("\n");

    const systemPrompt = `Você é um assistente técnico que ajuda o dono de uma loja de delivery (não é programador) a entender os logs do sistema dele — principalmente da integração com a iFood e o WhatsApp.

Responda em português, de forma direta e simples, sem jargão técnico desnecessário — explique como se fosse pra alguém que não programa, mas não esconda detalhes importantes. Se identificar um erro real nos logs, explique a causa provável e o que fazer pra resolver. Se não tiver log nenhum relevante à pergunta, diga isso claramente em vez de inventar.

LOGS RECENTES (mais novo primeiro, até 100 registros):
${logsText || "(nenhum log registrado ainda)"}`;

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select("openai_api_key, groq_api_key")
      .maybeSingle();

    const order = [
      { provider: "openai" as const, key: cfg?.openai_api_key || null },
      { provider: "groq" as const, key: cfg?.groq_api_key || null },
    ];

    for (const { provider, key } of order) {
      if (!key) continue;
      const p = AI_PROVIDERS[provider];
      try {
        const res = await fetch(p.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: p.model,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: data.question }],
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (!res.ok) continue;
        const json: any = await res.json();
        const answer = json?.choices?.[0]?.message?.content;
        if (answer) return { answer };
      } catch {
        continue;
      }
    }

    return {
      answer:
        "Não consegui consultar a IA agora — confira se há uma chave da OpenAI ou da Groq cadastrada em Configurações → Integrações.",
    };
  });

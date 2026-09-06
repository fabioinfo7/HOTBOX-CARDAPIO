// Ponto único de envio de mensagens de WhatsApp do sistema inteiro — usado
// pelas respostas automáticas da IA (webhooks.evolution.ts), pelas respostas
// manuais do painel (/loja/chat) e pelo broadcast (chat.functions.ts).
//
// Quem decide qual provedor é usado é sempre store_config.whatsapp_provider
// ("evolution" ou "meta"), configurável em /loja/config sem precisar mexer
// em código. As duas implementações ficam isoladas uma da outra — trocar de
// provedor não exige (nem arrisca) tocar na lógica de conversa/IA/pedidos,
// só na camada de envio.

import {
  loadMetaConfig,
  metaSendText,
  metaSendMedia,
  metaMarkReadWithTyping,
  type MetaConfig,
} from "./meta-whatsapp-api.server";

export type EvoConfig = { url: string; instance: string; token: string };

export async function loadEvoConfig(supabaseAdmin: any): Promise<EvoConfig | null> {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("evolution_api_url, evolution_instance, evolution_api_token, evolution_disabled")
    .maybeSingle();
  if (data?.evolution_disabled) return null;
  if (!data?.evolution_api_url || !data?.evolution_instance || !data?.evolution_api_token) return null;
  return { url: data.evolution_api_url, instance: data.evolution_instance, token: data.evolution_api_token };
}

/** Verifica o botão de emergência "desabilitar Evolution por completo" — usado tanto pro envio quanto pro webhook de entrada. */
export async function isEvolutionDisabled(supabaseAdmin: any): Promise<boolean> {
  const { data } = await supabaseAdmin.from("store_config").select("evolution_disabled").maybeSingle();
  return data?.evolution_disabled === true;
}

export async function getWhatsappProvider(supabaseAdmin: any): Promise<"evolution" | "meta"> {
  const { data } = await supabaseAdmin.from("store_config").select("whatsapp_provider").maybeSingle();
  return data?.whatsapp_provider === "meta" ? "meta" : "evolution";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simula o tempo que uma pessoa levaria pra digitar a mensagem — em vez de
// responder instantaneamente. Propositalmente rápido: o objetivo é só
// quebrar o padrão "resposta em 200ms sempre", não fazer o cliente esperar.
// Tetos baixos pra não acumular demora quando várias mensagens saem em
// sequência (resumo do pedido + bloco Pix + chave Pix, por exemplo).
function humanTypingDelayMs(text: string, capMs = 3500): number {
  const words = Math.max(3, text.trim().split(/\s+/).length);
  const base = (words / 55) * 60000; // ritmo mais rápido de "digitação" (55 palavras/min)
  const jitter = base * (0.15 + Math.random() * 0.25);
  return Math.min(capMs, Math.max(600, Math.round(base + jitter)));
}

function preTypingPauseMs() {
  return 200 + Math.round(Math.random() * 400);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

async function logSendFailure(
  supabaseAdmin: any,
  source: string,
  numberWithDDI: string,
  detail: string,
  status?: number,
) {
  try {
    await supabaseAdmin.from("api_logs").insert({
      source,
      direction: "out",
      response_status: status,
      error_message: `Mensagem NÃO chegou ao cliente (${numberWithDDI}): ${detail.slice(0, 300)}`,
    });
  } catch {
    /* log não pode quebrar o fluxo */
  }
}

// ============================================================
// Evolution API — implementação isolada
// ============================================================

async function evoSendPresence(
  cfg: EvoConfig,
  numberWithDDI: string,
  presence: "composing" | "paused",
  delayMs: number,
) {
  try {
    await fetch(`${cfg.url.replace(/\/$/, "")}/chat/sendPresence/${encodeURIComponent(cfg.instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.token },
      body: JSON.stringify({ number: numberWithDDI, options: { presence, delay: delayMs } }),
    });
  } catch {
    // presença é só um efeito visual pro cliente — nunca pode travar o envio da mensagem real
  }
}

async function sendViaEvolution(
  supabaseAdmin: any,
  numberWithDDI: string,
  text: string,
): Promise<{ ok: boolean; externalId?: string }> {
  const cfg = await loadEvoConfig(supabaseAdmin);
  if (!cfg) {
    console.error(
      "[whatsapp-send] Evolution API não configurada, ou desabilitada pelo botão de emergência em /loja/config",
    );
    return { ok: false };
  }

  await sleep(preTypingPauseMs());
  const typingDelay = humanTypingDelayMs(text);
  await evoSendPresence(cfg, numberWithDDI, "composing", typingDelay);
  await sleep(typingDelay);
  await evoSendPresence(cfg, numberWithDDI, "paused", 0);

  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.token },
      // Evolution API v2 usa "textMessage: { text }" — não "text" direto na raiz
      body: JSON.stringify({ number: numberWithDDI, textMessage: { text } }),
    });
    const detail = await res.text().catch(() => "");
    if (!res.ok) {
      console.error(`[whatsapp-send/evolution] FALHOU: ${res.status} — ${detail} — número: ${numberWithDDI}`);
      await logSendFailure(supabaseAdmin, "evolution_send", numberWithDDI, `${res.status} ${detail}`, res.status);
      return { ok: false };
    }
    return { ok: true, externalId: extractEvolutionMessageId(detail) };
  } catch (e: any) {
    console.error("[whatsapp-send/evolution] EXCEÇÃO:", e?.message ?? e);
    await logSendFailure(supabaseAdmin, "evolution_send", numberWithDDI, String(e?.message ?? e));
    return { ok: false };
  }
}

// A Evolution devolve o ID da mensagem em "key.id" na resposta do envio —
// é esse ID que volta depois no evento de status "READ", e é assim que a
// gente casa uma mensagem enviada com a confirmação de leitura do cliente.
function extractEvolutionMessageId(responseBody: string): string | undefined {
  try {
    const json = JSON.parse(responseBody);
    return json?.key?.id ?? undefined;
  } catch {
    return undefined;
  }
}

async function sendMediaViaEvolution(
  cfg: EvoConfig,
  numberWithDDI: string,
  mediaUrl: string,
  mediaType: string,
  caption?: string,
): Promise<{ ok: boolean; externalId?: string; error?: string }> {
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/message/sendMedia/${encodeURIComponent(cfg.instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.token },
    body: JSON.stringify({
      number: numberWithDDI,
      mediatype: mediaType,
      media: mediaUrl,
      caption: caption ?? undefined,
    }),
  });
  const detail = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, error: `${res.status} ${detail}` };
  return { ok: true, externalId: extractEvolutionMessageId(detail) };
}

// ============================================================
// Meta Cloud API — implementação isolada
// ============================================================

async function sendViaMeta(
  supabaseAdmin: any,
  numberWithDDI: string,
  text: string,
): Promise<{ ok: boolean; externalId?: string }> {
  const cfg = await loadMetaConfig(supabaseAdmin);
  if (!cfg) {
    console.error("[whatsapp-send] Meta Cloud API não configurada (token/phone number id faltando em /loja/config)");
    return { ok: false };
  }

  await sleep(preTypingPauseMs());
  const typingDelay = humanTypingDelayMs(text, 4500); // teto um pouco maior que o padrão — a Meta já mostra "digitando" por conta própria

  // o indicador de "digitando" da Meta precisa do wamid da mensagem que está
  // sendo respondida — guardado em whatsapp_conversations a cada mensagem recebida
  const { data: conv } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("last_inbound_meta_message_id")
    .eq("phone", numberWithDDI.replace(/^55/, ""))
    .maybeSingle();
  if (conv?.last_inbound_meta_message_id) {
    await metaMarkReadWithTyping(cfg, conv.last_inbound_meta_message_id);
  }
  await sleep(typingDelay);

  const result = await metaSendText(cfg, numberWithDDI, text);
  if (!result.ok) {
    console.error(`[whatsapp-send/meta] FALHOU: ${result.status} — ${result.body} — número: ${numberWithDDI}`);
    await logSendFailure(supabaseAdmin, "meta_send", numberWithDDI, `${result.status} ${result.body}`, result.status);
    return { ok: false };
  }
  return { ok: true, externalId: extractMetaMessageId(result.body) };
}

// A resposta da Meta traz o wamid em "messages[0].id" — é esse ID que volta
// depois no webhook de status "read", pra casar com a mensagem enviada.
function extractMetaMessageId(responseBody?: string): string | undefined {
  if (!responseBody) return undefined;
  try {
    const json = JSON.parse(responseBody);
    return json?.messages?.[0]?.id ?? undefined;
  } catch {
    return undefined;
  }
}

async function sendMediaViaMeta(
  cfg: MetaConfig,
  numberWithDDI: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
) {
  const result = await metaSendMedia(cfg, numberWithDDI, mediaUrl, mediaType, caption);
  return { ...result, externalId: extractMetaMessageId(result.body) };
}

// ============================================================
// API pública deste módulo — é isso que o resto do sistema chama
// ============================================================

/** Manda texto pro cliente, com humanização (pausa + "digitando..."), pelo provedor ativo. Devolve se deu certo e o ID da mensagem no provedor (pra casar com a confirmação de leitura depois). */
export async function sendWhatsappText(
  supabaseAdmin: any,
  phone: string,
  text: string,
): Promise<{ ok: boolean; externalId?: string }> {
  const provider = await getWhatsappProvider(supabaseAdmin);
  const numberWithDDI = normalizePhone(phone);
  return provider === "meta"
    ? sendViaMeta(supabaseAdmin, numberWithDDI, text)
    : sendViaEvolution(supabaseAdmin, numberWithDDI, text);
}

/** Manda mídia (imagem/vídeo/áudio/documento) por URL pública, pelo provedor ativo. */
export async function sendWhatsappMedia(
  supabaseAdmin: any,
  phone: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  const provider = await getWhatsappProvider(supabaseAdmin);
  const numberWithDDI = normalizePhone(phone);

  if (provider === "meta") {
    const cfg = await loadMetaConfig(supabaseAdmin);
    if (!cfg) return { ok: false, error: "Meta Cloud API não configurada em /loja/config" };
    const r = await sendMediaViaMeta(cfg, numberWithDDI, mediaUrl, mediaType, caption);
    if (!r.ok) return { ok: false, error: `Falha ao enviar mídia via Meta: ${r.status} ${r.body}` };
    return { ok: true, externalId: r.externalId };
  }

  const cfg = await loadEvoConfig(supabaseAdmin);
  if (!cfg) return { ok: false, error: "Evolution API não configurada (ou desabilitada) em /loja/config" };
  const r = await sendMediaViaEvolution(cfg, numberWithDDI, mediaUrl, mediaType, caption);
  if (!r.ok) return { ok: false, error: "Falha ao enviar mídia: " + r.error };
  return { ok: true, externalId: r.externalId };
}


/**
 * Revoga uma mensagem enviada pela Evolution API para todos os participantes
 * do chat (equivalente ao "Apagar para todos" do WhatsApp).
 *
 * Requisitos:
 * - a mensagem precisa ter sido enviada por nós (fromMe=true);
 * - precisamos do ID externo retornado pela Evolution no envio;
 * - o WhatsApp/Evolution pode rejeitar mensagens fora da janela permitida
 *   para revogação. Nesse caso o chamador NÃO deve esconder a mensagem local.
 */
export async function deleteWhatsappMessageForEveryone(
  supabaseAdmin: any,
  phone: string,
  externalId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!externalId) return { ok: false, error: "A mensagem não possui ID do WhatsApp e não pode ser apagada para o cliente." };

  // IDs da Meta Cloud API normalmente começam com "wamid.". A Cloud API
  // oficial não oferece uma operação equivalente ao revoke do WhatsApp Web.
  if (externalId.startsWith("wamid.")) {
    return {
      ok: false,
      error: "Esta mensagem foi enviada pela Meta Cloud API. Esse provedor não oferece 'apagar para todos'.",
    };
  }

  const provider = await getWhatsappProvider(supabaseAdmin);
  if (provider !== "evolution") {
    return {
      ok: false,
      error: "Para apagar para todos, a Evolution API precisa estar selecionada como provedor do WhatsApp.",
    };
  }

  const cfg = await loadEvoConfig(supabaseAdmin);
  if (!cfg) {
    return { ok: false, error: "Evolution API não configurada ou desabilitada em /loja/config." };
  }

  const numberWithDDI = normalizePhone(phone);
  const remoteJid = `${numberWithDDI}@s.whatsapp.net`;

  try {
    const res = await fetch(
      `${cfg.url.replace(/\/$/, "")}/chat/deleteMessageForEveryone/${encodeURIComponent(cfg.instance)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json", apikey: cfg.token },
        body: JSON.stringify({ id: externalId, remoteJid, fromMe: true }),
      },
    );
    const detail = await res.text().catch(() => "");
    if (!res.ok) {
      console.error(`[whatsapp-delete/evolution] FALHOU: ${res.status} — ${detail}`);
      return {
        ok: false,
        error: `O WhatsApp não permitiu apagar essa mensagem para todos (${res.status}). ${detail.slice(0, 180)}`.trim(),
      };
    }

    return { ok: true };
  } catch (err: any) {
    console.error("[whatsapp-delete/evolution] EXCEÇÃO:", err?.message ?? err);
    return { ok: false, error: `Falha ao apagar a mensagem no WhatsApp: ${String(err?.message ?? err)}` };
  }
}

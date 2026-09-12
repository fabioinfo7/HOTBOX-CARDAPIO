// Toda a comunicação com a API oficial da Meta (WhatsApp Cloud API) mora
// aqui. Isolado do restante — nenhuma função daqui é usada pela Evolution
// API, e vice-versa. Quem decide qual dos dois é usado é sempre
// store_config.whatsapp_provider, checado em src/lib/whatsapp-send.server.ts.

const GRAPH_VERSION = "v22.0";

export type MetaConfig = {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string | null;
  appId: string | null;
  verifyToken: string | null;
  appSecret: string | null;
};

export async function loadMetaConfig(supabaseAdmin: any): Promise<MetaConfig | null> {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("meta_access_token, meta_phone_number_id, meta_waba_id, meta_app_id, meta_verify_token, meta_app_secret")
    .maybeSingle();
  if (!data?.meta_access_token || !data?.meta_phone_number_id) return null;
  return {
    accessToken: data.meta_access_token,
    phoneNumberId: data.meta_phone_number_id,
    wabaId: data.meta_waba_id ?? null,
    appId: data.meta_app_id ?? null,
    verifyToken: data.meta_verify_token ?? null,
    appSecret: data.meta_app_secret ?? null,
  };
}

function graphUrl(path: string) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`;
}

// ============================================================
// Verificação do handshake do webhook (GET) e da assinatura de cada
// requisição recebida (POST, header X-Hub-Signature-256)
// ============================================================

export function verifyMetaWebhookChallenge(searchParams: URLSearchParams, verifyToken: string): string | null {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

export async function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const { createHmac } = await import("node:crypto");
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  // comparação simples é suficiente aqui (não é um endpoint de altíssima
  // sensibilidade tipo autenticação de usuário — mesmo padrão usado no
  // resto do sistema pra webhooks assinados, ex: nfood)
  return expected === signatureHeader.trim();
}

// ============================================================
// Envio de texto
// ============================================================

export async function metaSendText(cfg: MetaConfig, phone: string, text: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  const res = await fetch(graphUrl(`${cfg.phoneNumberId}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text, preview_url: false },
    }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

// ============================================================
// Envio de mídia (imagem/vídeo/áudio/documento) — a Cloud API aceita mandar
// direto por link público, sem precisar fazer upload prévio pra Meta.
// ============================================================

export async function metaSendMedia(
  cfg: MetaConfig,
  phone: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
): Promise<{ ok: boolean; status?: number; body?: string }> {
  const mediaObj: any = { link: mediaUrl };
  if (caption && (mediaType === "image" || mediaType === "video" || mediaType === "document")) mediaObj.caption = caption;
  const res = await fetch(graphUrl(`${cfg.phoneNumberId}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: mediaType, [mediaType]: mediaObj }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

// ============================================================
// Indicador de "digitando..." oficial — precisa do ID da mensagem RECEBIDA
// que está sendo respondida. Some sozinho depois de ~25s ou quando a
// próxima mensagem é enviada, o que vier primeiro (limite da própria Meta,
// não é configurável).
// ============================================================

export async function metaMarkReadWithTyping(cfg: MetaConfig, inboundMessageId: string): Promise<void> {
  try {
    await fetch(graphUrl(`${cfg.phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: inboundMessageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch {
    // efeito visual — nunca pode travar o envio da mensagem real
  }
}

// ============================================================
// Download de mídia recebida (imagem de comprovante Pix, por exemplo) — a
// Meta manda só o media_id no webhook; é preciso: 1) consultar a URL
// temporária desse media_id, 2) baixar o conteúdo com o mesmo token.
// ============================================================

export async function metaDownloadMediaAsBase64(cfg: MetaConfig, mediaId: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const metaRes = await fetch(graphUrl(mediaId), { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    if (!meta?.url) return null;

    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    if (!fileRes.ok) return null;
    const buf = await fileRes.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { base64, mimeType: meta.mime_type || "image/jpeg" };
  } catch (err) {
    console.error("[meta] falha ao baixar mídia:", err);
    return null;
  }
}

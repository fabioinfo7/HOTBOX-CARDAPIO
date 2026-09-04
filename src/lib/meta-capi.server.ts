/**
 * meta-capi.server.ts
 * -------------------
 * Integração com a Meta Conversions API (CAPI) — server-side.
 *
 * Eventos suportados:
 *   - Lead         → quando um lead de campanha WhatsApp inicia conversa
 *   - Purchase     → quando um pedido é confirmado (order criada)
 *   - InitiateCheckout → quando o robô detecta intenção de compra
 *
 * Dados enviados são hasheados com SHA-256 antes de ir pra Meta,
 * conforme exigido pela Conversions API.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

import { createHash } from "node:crypto";

const GRAPH_VERSION = "v22.0";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type CapiConfig = {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
};

export type CapiUserData = {
  phone?: string;          // será hasheado com SHA-256
  name?: string;           // primeiro nome, será hasheado
  ctwaClid?: string;       // Click-to-WhatsApp Click ID — NÃO hashear
  fbpCookie?: string;      // _fbp cookie (se disponível)
  fbcCookie?: string;      // _fbc cookie (se disponível)
};

export type CapiEventOptions = {
  eventName: "Lead" | "Purchase" | "InitiateCheckout" | "Contact" | "CompleteRegistration";
  userData: CapiUserData;
  value?: number;           // valor em BRL (para Purchase)
  currency?: string;        // padrão "BRL"
  orderId?: string;         // ID do pedido (para Purchase)
  eventSourceUrl?: string;  // URL de origem (use a URL do seu domínio/whatsapp)
  customData?: Record<string, unknown>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

/** Normaliza telefone: remove tudo que não for dígito, garante DDI 55 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // já tem DDI BR
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  // sem DDI
  return "55" + digits;
}

/** Monta o campo user_data com os campos hasheados e os identificadores de clique */
function buildUserData(ud: CapiUserData) {
  const userData: Record<string, string> = {};

  if (ud.phone) {
    const normalized = normalizePhone(ud.phone);
    userData.ph = sha256(normalized);
  }

  if (ud.name) {
    const firstName = ud.name.trim().split(" ")[0];
    if (firstName) userData.fn = sha256(firstName);
  }

  // ctwa_clid: NÃO hashear — é um identificador de clique da Meta
  // Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
  if (ud.ctwaClid) {
    userData.ctwa_clid = ud.ctwaClid;
  }

  if (ud.fbpCookie) userData.fbp = ud.fbpCookie;
  if (ud.fbcCookie) userData.fbc = ud.fbcCookie;

  // Indica que o evento veio de fora do browser
  userData.client_ip_address = "0.0.0.0"; // não temos IP real em mensagens WhatsApp
  userData.client_user_agent = "WhatsApp/Bot";

  return userData;
}

// ── Função principal ─────────────────────────────────────────────────────────

/**
 * Carrega configuração do Pixel/CAPI a partir da store_config.
 * Retorna null se não configurado.
 */
export async function loadCapiConfig(supabaseAdmin: any): Promise<CapiConfig | null> {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("meta_pixel_id, meta_capi_access_token, meta_test_event_code")
    .maybeSingle();

  if (!data?.meta_pixel_id || !data?.meta_capi_access_token) return null;

  return {
    pixelId: data.meta_pixel_id,
    accessToken: data.meta_capi_access_token,
    testEventCode: data.meta_test_event_code ?? null,
  };
}

/**
 * Envia um evento para a Meta Conversions API.
 * Não lança exceção — erros são logados e retornados no resultado.
 */
export async function sendCapiEvent(
  cfg: CapiConfig,
  options: CapiEventOptions,
): Promise<{ success: boolean; response?: unknown; error?: string }> {
  const eventTime = Math.floor(Date.now() / 1000);

  const event: Record<string, unknown> = {
    event_name: options.eventName,
    event_time: eventTime,
    action_source: "business_messaging", // correto para mensagens WhatsApp
    event_source_url: options.eventSourceUrl ?? `https://wa.me/`,
    user_data: buildUserData(options.userData),
  };

  if (options.value !== undefined || options.orderId) {
    const customData: Record<string, unknown> = {
      currency: options.currency ?? "BRL",
      ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.orderId ? { order_id: options.orderId } : {}),
      ...options.customData,
    };
    event.custom_data = customData;
  }

  const body: Record<string, unknown> = {
    data: [event],
  };

  if (cfg.testEventCode) {
    body.test_event_code = cfg.testEventCode;
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events?access_token=${cfg.accessToken}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const responseJson = await res.json().catch(async () => ({ raw: await res.text() }));

    if (!res.ok) {
      return {
        success: false,
        response: responseJson,
        error: `HTTP ${res.status}`,
      };
    }

    return { success: true, response: responseJson };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

// ── Wrappers de alto nível ────────────────────────────────────────────────────

/**
 * Dispara evento "Lead" quando um novo lead de campanha WhatsApp inicia conversa.
 * Deve ser chamado ao detectar ctwa_clid no referral do webhook da Meta.
 */
export async function fireLeadEvent(
  supabaseAdmin: any,
  opts: {
    phone: string;
    name?: string;
    ctwaClid?: string;
    conversationId?: string;
  },
): Promise<void> {
  const cfg = await loadCapiConfig(supabaseAdmin);
  if (!cfg) return; // CAPI não configurado — ignora silenciosamente

  const result = await sendCapiEvent(cfg, {
    eventName: "Lead",
    userData: {
      phone: opts.phone,
      name: opts.name,
      ctwaClid: opts.ctwaClid,
    },
  });

  // Salva no log
  await supabaseAdmin.from("meta_capi_events").insert({
    event_name: "Lead",
    phone: opts.phone,
    payload: { phone: opts.phone, ctwa_clid: opts.ctwaClid },
    response: result.response ?? null,
    success: result.success,
  }).catch(() => {}); // não pode travar o fluxo

  // Marca na conversa que o evento Lead foi enviado
  if (opts.conversationId && result.success) {
    await supabaseAdmin
      .from("whatsapp_conversations")
      .update({ capi_lead_sent_at: new Date().toISOString() })
      .eq("id", opts.conversationId)
      .catch(() => {});
  }

  if (!result.success) {
    console.error("[CAPI] Falha ao enviar evento Lead:", result.error, result.response);
  }
}

/**
 * Dispara evento "Purchase" quando um pedido é confirmado.
 * Deve ser chamado logo após a criação do pedido no banco.
 */
export async function firePurchaseEvent(
  supabaseAdmin: any,
  opts: {
    phone: string;
    name?: string;
    orderId: string;
    value: number;
    ctwaClid?: string;
    conversationId?: string;
  },
): Promise<void> {
  const cfg = await loadCapiConfig(supabaseAdmin);
  if (!cfg) return;

  const result = await sendCapiEvent(cfg, {
    eventName: "Purchase",
    userData: {
      phone: opts.phone,
      name: opts.name,
      ctwaClid: opts.ctwaClid,
    },
    value: opts.value,
    currency: "BRL",
    orderId: opts.orderId,
  });

  await supabaseAdmin.from("meta_capi_events").insert({
    event_name: "Purchase",
    phone: opts.phone,
    payload: { phone: opts.phone, order_id: opts.orderId, value: opts.value },
    response: result.response ?? null,
    success: result.success,
  }).catch(() => {});

  if (opts.conversationId && result.success) {
    await supabaseAdmin
      .from("whatsapp_conversations")
      .update({ capi_purchase_sent_at: new Date().toISOString() })
      .eq("id", opts.conversationId)
      .catch(() => {});
  }

  if (!result.success) {
    console.error("[CAPI] Falha ao enviar evento Purchase:", result.error, result.response);
  }
}

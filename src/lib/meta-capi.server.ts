/**
 * HotBox Delivery — Meta Conversions API
 *
 * Suporta eventos do site/cardápio e do WhatsApp.
 * Dados pessoais usados para correspondência são normalizados e hasheados
 * com SHA-256 antes do envio, conforme o padrão da Meta.
 */

import { createHash } from "node:crypto";

const GRAPH_VERSION = "v22.0";

export type CapiConfig = {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
};

export type CapiUserData = {
  phone?: string;
  name?: string;
  externalId?: string;
  ctwaClid?: string;
  fbpCookie?: string;
  fbcCookie?: string;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

export type CapiEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "AddPaymentInfo"
  | "Purchase"
  | "Lead"
  | "Contact"
  | "CompleteRegistration";

export type CapiEventOptions = {
  eventName: CapiEventName;
  userData: CapiUserData;
  value?: number;
  currency?: string;
  orderId?: string;
  eventId?: string;
  eventSourceUrl?: string;
  actionSource?: "website" | "business_messaging";
  customData?: Record<string, unknown>;
};

function sha256(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return "55" + digits;
}

function buildUserData(
  ud: CapiUserData,
  actionSource: "website" | "business_messaging",
) {
  const userData: Record<string, string> = {};

  if (ud.phone) {
    const normalized = normalizePhone(ud.phone);
    if (normalized) userData.ph = sha256(normalized);
  }

  if (ud.name) {
    const firstName = ud.name.trim().split(/\s+/)[0];
    if (firstName) userData.fn = sha256(firstName);
  }

  if (ud.externalId) {
    userData.external_id = sha256(String(ud.externalId));
  }

  // Identificadores próprios da Meta NÃO devem ser hasheados.
  if (ud.ctwaClid) userData.ctwa_clid = ud.ctwaClid;
  if (ud.fbpCookie) userData.fbp = ud.fbpCookie;
  if (ud.fbcCookie) userData.fbc = ud.fbcCookie;

  if (ud.clientIpAddress) {
    userData.client_ip_address = ud.clientIpAddress;
  } else if (actionSource === "business_messaging") {
    // Compatibilidade com o fluxo antigo de WhatsApp.
    userData.client_ip_address = "0.0.0.0";
  }

  if (ud.clientUserAgent) {
    userData.client_user_agent = ud.clientUserAgent;
  } else if (actionSource === "business_messaging") {
    userData.client_user_agent = "WhatsApp/Bot";
  }

  return userData;
}

export async function loadCapiConfig(
  supabaseAdmin: any,
): Promise<CapiConfig | null> {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("meta_pixel_id, meta_capi_access_token, meta_test_event_code")
    .maybeSingle();

  if (!data?.meta_pixel_id || !data?.meta_capi_access_token) return null;

  return {
    pixelId: String(data.meta_pixel_id),
    accessToken: String(data.meta_capi_access_token),
    testEventCode: data.meta_test_event_code ?? null,
  };
}

export async function sendCapiEvent(
  cfg: CapiConfig,
  options: CapiEventOptions,
): Promise<{ success: boolean; response?: unknown; error?: string }> {
  const eventTime = Math.floor(Date.now() / 1000);
  const actionSource = options.actionSource ?? "business_messaging";

  const event: Record<string, unknown> = {
    event_name: options.eventName,
    event_time: eventTime,
    action_source: actionSource,
    user_data: buildUserData(options.userData, actionSource),
  };

  if (options.eventId) {
    event.event_id = options.eventId;
  }

  if (options.eventSourceUrl) {
    event.event_source_url = options.eventSourceUrl;
  } else if (actionSource === "business_messaging") {
    event.event_source_url = "https://wa.me/";
  }

  const customData: Record<string, unknown> = {
    ...(options.currency ? { currency: options.currency } : {}),
    ...(options.value !== undefined
      ? { value: Number(options.value) }
      : {}),
    ...(options.orderId ? { order_id: options.orderId } : {}),
    ...(options.customData || {}),
  };

  if (Object.keys(customData).length) {
    event.custom_data = customData;
  }

  const body: Record<string, unknown> = { data: [event] };

  if (cfg.testEventCode) {
    body.test_event_code = cfg.testEventCode;
  }

  try {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events` +
      `?access_token=${encodeURIComponent(cfg.accessToken)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let responseJson: unknown = null;

    try {
      responseJson = raw ? JSON.parse(raw) : null;
    } catch {
      responseJson = { raw };
    }

    if (!res.ok) {
      return {
        success: false,
        response: responseJson,
        error: `HTTP ${res.status}`,
      };
    }

    return { success: true, response: responseJson };
  } catch (err: any) {
    return {
      success: false,
      error: String(err?.message ?? err),
    };
  }
}

// Fluxo legado/WhatsApp preservado.
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
  if (!cfg) return;

  const eventId = opts.conversationId
    ? `lead_${opts.conversationId}`
    : undefined;

  const result = await sendCapiEvent(cfg, {
    eventName: "Lead",
    eventId,
    actionSource: "business_messaging",
    userData: {
      phone: opts.phone,
      name: opts.name,
      ctwaClid: opts.ctwaClid,
    },
  });

  try {
    await supabaseAdmin.from("meta_capi_events").insert({
      event_name: "Lead",
      event_id: eventId ?? null,
      phone: opts.phone,
      source: "whatsapp",
      payload: {
        phone: opts.phone,
        ctwa_clid: opts.ctwaClid,
      },
      response: result.response ?? null,
      success: result.success,
    });
  } catch (err) {
    console.error("[CAPI] Falha ao registrar evento Lead:", err);
  }

  if (opts.conversationId && result.success) {
    try {
      await supabaseAdmin
        .from("whatsapp_conversations")
        .update({ capi_lead_sent_at: new Date().toISOString() })
        .eq("id", opts.conversationId);
    } catch (err) {
      console.error("[CAPI] Falha ao marcar Lead como enviado:", err);
    }
  }

  if (!result.success) {
    console.error(
      "[CAPI] Falha ao enviar Lead:",
      result.error,
      result.response,
    );
  }
}

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

  const eventId = `purchase_${opts.orderId}`;

  const result = await sendCapiEvent(cfg, {
    eventName: "Purchase",
    eventId,
    actionSource: "business_messaging",
    userData: {
      phone: opts.phone,
      name: opts.name,
      ctwaClid: opts.ctwaClid,
    },
    value: opts.value,
    currency: "BRL",
    orderId: opts.orderId,
  });

  try {
    await supabaseAdmin.from("meta_capi_events").insert({
      event_name: "Purchase",
      event_id: eventId,
      order_id: opts.orderId,
      phone: opts.phone,
      source: "whatsapp",
      payload: {
        phone: opts.phone,
        order_id: opts.orderId,
        value: opts.value,
      },
      response: result.response ?? null,
      success: result.success,
    });
  } catch (err) {
    console.error("[CAPI] Falha ao registrar Purchase:", err);
  }

  if (opts.conversationId && result.success) {
    try {
      await supabaseAdmin
        .from("whatsapp_conversations")
        .update({ capi_purchase_sent_at: new Date().toISOString() })
        .eq("id", opts.conversationId);
    } catch (err) {
      console.error("[CAPI] Falha ao marcar Purchase como enviado:", err);
    }
  }

  if (!result.success) {
    console.error(
      "[CAPI] Falha ao enviar Purchase:",
      result.error,
      result.response,
    );
  }
}

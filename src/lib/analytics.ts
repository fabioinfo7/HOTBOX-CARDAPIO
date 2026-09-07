import { trackAnalyticsEvent, type AnalyticsEventInput } from "@/lib/analytics.functions";

const VISITOR_KEY = "hb_analytics_visitor";
const SESSION_KEY = "hb_analytics_session";
const LAST_KEY = "hb_analytics_last";
const SESSION_TIMEOUT = 30 * 60 * 1000;

function uid(prefix: string) {
  try { return `${prefix}_${crypto.randomUUID()}`; } catch { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
}
function storageGet(storage: Storage, key: string) { try { return storage.getItem(key); } catch { return null; } }
function storageSet(storage: Storage, key: string, value: string) { try { storage.setItem(key, value); } catch { /* ignore */ } }

export function analyticsIdentity() {
  if (typeof window === "undefined") return { visitor_id: "server", session_id: "server" };
  let visitor = storageGet(localStorage, VISITOR_KEY);
  if (!visitor) { visitor = uid("v"); storageSet(localStorage, VISITOR_KEY, visitor); }
  const now = Date.now();
  const last = Number(storageGet(sessionStorage, LAST_KEY) || 0);
  let session = storageGet(sessionStorage, SESSION_KEY);
  if (!session || !last || now - last > SESSION_TIMEOUT) {
    session = uid("s");
    storageSet(sessionStorage, SESSION_KEY, session);
  }
  storageSet(sessionStorage, LAST_KEY, String(now));
  return { visitor_id: visitor, session_id: session };
}

function attribution() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const ref = document.referrer || "";
  const explicitSource = q.get("utm_source") || q.get("source");
  let source = explicitSource || "direct";
  let medium = q.get("utm_medium") || (ref ? "referral" : "none");
  if (!explicitSource && /instagram\.com|l\.instagram\.com/i.test(ref)) { source = "instagram"; medium = "social"; }
  else if (!explicitSource && /facebook\.com|fb\.com/i.test(ref)) { source = "facebook"; medium = "social"; }
  else if (!explicitSource && /google\./i.test(ref)) { source = "google"; medium = "organic"; }
  else if (!explicitSource && /wa\.me|whatsapp/i.test(ref)) { source = "whatsapp"; medium = "social"; }
  return {
    referrer: ref || null,
    source,
    medium,
    campaign: q.get("utm_campaign"),
    term: q.get("utm_term"),
    content: q.get("utm_content"),
    click_id: q.get("fbclid") || q.get("gclid") || q.get("ttclid") || q.get("msclkid"),
  };
}

function deviceInfo() {
  if (typeof window === "undefined") return {};
  const ua = navigator.userAgent || "";
  const device_type = /Mobi|Android|iPhone|iPad/i.test(ua) ? (/iPad|Tablet/i.test(ua) ? "tablet" : "mobile") : "desktop";
  const browser = /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "Other";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Other";
  return {
    device_type, browser, os,
    language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    screen_width: screen.width,
    screen_height: screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
  };
}


type MetaContent = {
  id: string;
  quantity: number;
  item_price?: number;
};

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanMetaContents(input: unknown): MetaContent[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((raw: any) => {
      const id = String(raw?.id ?? raw?.product_id ?? raw?.option_id ?? "").trim();
      const quantity = Math.max(1, Math.round(Number(raw?.quantity ?? raw?.qty ?? 1) || 1));
      const price = finiteNumber(raw?.item_price ?? raw?.unit_price ?? raw?.price);

      if (!id) return null;

      return {
        id,
        quantity,
        ...(price != null ? { item_price: Number(price.toFixed(2)) } : {}),
      } as MetaContent;
    })
    .filter(Boolean) as MetaContent[];
}

function metaEventId(eventName: string, extra: Partial<AnalyticsEventInput>) {
  const explicit = String((extra.properties as any)?.event_id || "").trim();
  if (explicit) return explicit;

  if (eventName === "purchase" && extra.order_id) {
    return `purchase_${String(extra.order_id)}`;
  }

  if (eventName === "checkout_started" && extra.checkout_id) {
    return `checkout_${String(extra.checkout_id)}`;
  }

  try {
    return `hb_${eventName}_${crypto.randomUUID()}`;
  } catch {
    return `hb_${eventName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function trackMetaPixel(event_name: string, extra: Partial<AnalyticsEventInput>) {
  if (typeof window === "undefined") return;

  const fbq = (window as any).fbq;
  if (typeof fbq !== "function") return;

  const map: Record<string, string> = {
    product_view: "ViewContent",
    add_to_cart: "AddToCart",
    order_bump_added: "AddToCart",
    checkout_started: "InitiateCheckout",
    payment_selected: "AddPaymentInfo",
    purchase: "Purchase",
    lead: "Lead",
    contact: "Contact",
  };

  if (event_name === "page_view") {
    const key = `${window.location.pathname}${window.location.search}`;
    (window as any).__hotboxMetaPageViews ??= new Set<string>();
    const pageViews: Set<string> = (window as any).__hotboxMetaPageViews;
    const genericKey = `analytics:${key}`;

    if (!pageViews.has(genericKey)) {
      fbq("track", "PageView");
      pageViews.add(genericKey);
    }
    return;
  }

  const metaEvent = map[event_name];
  if (!metaEvent) return;

  const properties: any =
    extra.properties && typeof extra.properties === "object"
      ? extra.properties
      : {};

  const params: Record<string, any> = {};
  const rawContents =
    properties.contents ||
    properties.items ||
    (extra.product_id
      ? [{
          id: String(extra.product_id),
          quantity: Number(extra.quantity || 1),
          item_price: Number(extra.value || 0),
        }]
      : []);

  const contents = cleanMetaContents(rawContents);

  if (contents.length) {
    params.contents = contents;
    params.content_ids = contents.map((item) => item.id);
    params.content_type = "product";
  } else if (extra.product_id) {
    params.content_ids = [String(extra.product_id)];
    params.content_type = "product";
  }

  if (extra.product_name) params.content_name = extra.product_name;

  const value = finiteNumber(extra.value ?? properties.total ?? properties.subtotal);
  if (value != null) {
    params.value = Number(value.toFixed(2));
    params.currency = "BRL";
  }

  const explicitQty = finiteNumber(extra.quantity ?? properties.num_items ?? properties.items_count);
  const quantity =
    explicitQty != null
      ? Math.max(1, Math.round(explicitQty))
      : contents.reduce((sum, item) => sum + item.quantity, 0);

  if (quantity > 0) params.num_items = quantity;

  // Parâmetros úteis para análise e criação de públicos.
  if (extra.order_id) params.order_id = String(extra.order_id);
  if (extra.checkout_id) params.checkout_id = String(extra.checkout_id);
  if (extra.payment_method) params.payment_method = String(extra.payment_method);

  if (finiteNumber(properties.subtotal) != null) {
    params.subtotal = Number(Number(properties.subtotal).toFixed(2));
  }
  if (finiteNumber(properties.delivery_fee) != null) {
    params.delivery_fee = Number(Number(properties.delivery_fee).toFixed(2));
  }
  if (finiteNumber(properties.discount) != null) {
    params.discount = Number(Number(properties.discount).toFixed(2));
  }
  if (properties.coupon) params.coupon = String(properties.coupon);
  if (properties.delivery_mode) params.delivery_mode = String(properties.delivery_mode);

  if (Array.isArray(properties.addons) && properties.addons.length) {
    params.addons = properties.addons.map((x: any) => String(x)).join(", ");
  }

  const eventID = metaEventId(event_name, extra);

  fbq("track", metaEvent, params, { eventID });
}

export function trackAnalytics(event_name: string, extra: Partial<AnalyticsEventInput> = {}) {
  if (typeof window === "undefined") return;
  if (/^\/(loja|admin|entregador)(\/|$)/.test(window.location.pathname)) return;
  const ids = analyticsIdentity();
  const payload: AnalyticsEventInput = {
    ...ids,
    ...attribution(),
    ...deviceInfo(),
    event_name,
    event_category: extra.event_category || "engagement",
    page_path: extra.page_path || `${window.location.pathname}${window.location.search}`,
    page_title: extra.page_title || document.title,
    ...extra,
  };

  trackMetaPixel(event_name, extra);

  void trackAnalyticsEvent({ data: payload })
    .then((result: any) => {
      if (!result?.ok) {
        console.warn("[analytics] evento não gravado", {
          event_name,
          stage: result?.stage || "unknown",
          error: result?.error || "Falha sem detalhe",
        });
      }
    })
    .catch((error: any) => {
      console.warn("[analytics] falha ao enviar evento", {
        event_name,
        message: error?.message || String(error),
      });
    });
}

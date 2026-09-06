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


function trackMetaPixel(event_name: string, extra: Partial<AnalyticsEventInput>) {
  if (typeof window === "undefined") return;

  const fbq = (window as any).fbq;
  if (typeof fbq !== "function") return;

  const map: Record<string, string> = {
    product_view: "ViewContent",
    add_to_cart: "AddToCart",
    checkout_started: "InitiateCheckout",
    payment_started: "AddPaymentInfo",
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

  const params: Record<string, any> = {};

  if (extra.product_name) params.content_name = extra.product_name;
  if (extra.product_id) {
    params.content_ids = [String(extra.product_id)];
    params.content_type = "product";
  }
  if (extra.value != null && Number.isFinite(Number(extra.value))) {
    params.value = Number(extra.value);
    params.currency = "BRL";
  }
  if (extra.quantity != null && Number.isFinite(Number(extra.quantity))) {
    params.num_items = Number(extra.quantity);
  }

  fbq("track", metaEvent, params);
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

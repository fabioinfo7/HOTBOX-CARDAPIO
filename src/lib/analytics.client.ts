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
  void trackAnalyticsEvent({ data: payload }).catch(() => {});
}

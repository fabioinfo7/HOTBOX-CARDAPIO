import { useEffect } from "react";

export type AnalyticsSurface = "bio" | "menu" | "thankyou" | string;

type TrackOptions = {
  category?: string;
  label?: string;
  value?: number;
  productId?: string | null;
  productName?: string | null;
  checkoutId?: string | null;
  orderId?: string | null;
  metadata?: Record<string, unknown>;
  pagePath?: string;
  pageTitle?: string;
};

const VISITOR_KEY = "hb_analytics_visitor_v1";
const SESSION_KEY = "hb_analytics_session_v1";
const SESSION_META_KEY = "hb_analytics_session_meta_v1";
const SESSION_STARTED_KEY = "hb_analytics_session_started_v1";
const MAX_LABEL = 140;

function uuid() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function safeStorage(storage: Storage | undefined, key: string, fallbackFactory: () => string) {
  if (!storage) return fallbackFactory();
  try {
    let value = storage.getItem(key);
    if (!value) { value = fallbackFactory(); storage.setItem(key, value); }
    return value;
  } catch { return fallbackFactory(); }
}

export function getAnalyticsIds() {
  if (typeof window === "undefined") return { visitorId: "server", sessionId: "server" };
  return {
    visitorId: safeStorage(window.localStorage, VISITOR_KEY, uuid),
    sessionId: safeStorage(window.sessionStorage, SESSION_KEY, uuid),
  };
}

function parseBrowser(ua: string) {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return "Outro";
}
function parseOs(ua: string) {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Outro";
}
function parseDevice(ua: string, width: number) {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua) || width < 768) return "mobile";
  return "desktop";
}

function inferTraffic() {
  if (typeof window === "undefined") return {};
  try {
    const current = new URL(window.location.href);
    const params = current.searchParams;
    const ref = document.referrer || "";
    const refHost = ref ? new URL(ref).hostname.replace(/^www\./, "") : "";
    const utmSource = params.get("utm_source") || "";
    const utmMedium = params.get("utm_medium") || "";
    const utmCampaign = params.get("utm_campaign") || "";
    const utmContent = params.get("utm_content") || "";
    const utmTerm = params.get("utm_term") || "";
    let source = utmSource;
    let medium = utmMedium;
    if (!source) {
      if (!refHost) { source = "Direto"; medium = "direct"; }
      else if (/instagram|facebook|fb\.|l\.facebook|meta/i.test(refHost)) { source = "Meta"; medium = "social"; }
      else if (/google\./i.test(refHost)) { source = "Google"; medium = "organic"; }
      else if (/tiktok/i.test(refHost)) { source = "TikTok"; medium = "social"; }
      else { source = refHost; medium = "referral"; }
    }
    return { source, medium, campaign: utmCampaign, content: utmContent, term: utmTerm, referrer: ref };
  } catch { return {}; }
}

function sessionMeta() {
  if (typeof window === "undefined") return {};
  try {
    const cached = sessionStorage.getItem(SESSION_META_KEY);
    if (cached) return JSON.parse(cached);
    const ua = navigator.userAgent || "";
    const traffic = inferTraffic();
    const meta = {
      ...traffic,
      device_type: parseDevice(ua, window.innerWidth),
      browser: parseBrowser(ua),
      os: parseOs(ua),
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      user_agent: ua.slice(0, 500),
    };
    sessionStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
    return meta;
  } catch { return {}; }
}

function cleanMetadata(input: Record<string, unknown> | undefined) {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 30)) {
    if (/password|senha|token|card|cvv|cpf|email|phone|telefone|name|nome|address|endereco/i.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 250);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => typeof v === "string" ? v.slice(0, 120) : v);
    else if (typeof value === "object") out[key] = value;
  }
  return out;
}

export function trackAnalytics(eventName: string, options: TrackOptions = {}) {
  if (typeof window === "undefined") return;
  const { visitorId, sessionId } = getAnalyticsIds();
  const payload = {
    visitor_id: visitorId,
    session_id: sessionId,
    event_name: String(eventName || "event").slice(0, 80),
    event_category: String(options.category || "behavior").slice(0, 60),
    event_label: options.label ? String(options.label).slice(0, MAX_LABEL) : null,
    page_path: String(options.pagePath || window.location.pathname).slice(0, 300),
    page_title: String(options.pageTitle || document.title || "HotBox").slice(0, 180),
    value: Number.isFinite(Number(options.value)) ? Number(options.value) : null,
    product_id: options.productId || null,
    product_name: options.productName ? String(options.productName).slice(0, 180) : null,
    checkout_id: options.checkoutId || null,
    order_id: options.orderId || null,
    metadata: cleanMetadata(options.metadata),
    client: sessionMeta(),
    occurred_at: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  try {
    fetch("/api/public/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch { /* analytics nunca pode quebrar a compra */ }
}

function sendBeaconEvent(eventName: string, metadata?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const { visitorId, sessionId } = getAnalyticsIds();
  const payload = JSON.stringify({
    visitor_id: visitorId,
    session_id: sessionId,
    event_name: eventName,
    event_category: "engagement",
    page_path: window.location.pathname,
    page_title: document.title || "HotBox",
    metadata: cleanMetadata(metadata),
    client: sessionMeta(),
    occurred_at: new Date().toISOString(),
  });
  try {
    navigator.sendBeacon?.("/api/public/analytics", new Blob([payload], { type: "application/json" }));
  } catch { /* ignore */ }
}

function elementLabel(el: HTMLElement) {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title") || "";
  const text = (aria || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_LABEL);
}
function safeHref(el: HTMLElement) {
  const href = (el.closest("a") as HTMLAnchorElement | null)?.href;
  if (!href) return null;
  try { const u = new URL(href, window.location.href); return `${u.hostname}${u.pathname}`.slice(0, 250); } catch { return null; }
}

export function useBehaviorAnalytics(surface: AnalyticsSurface) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = getAnalyticsIds();
    const alreadyStarted = sessionStorage.getItem(SESSION_STARTED_KEY) === "1";
    if (!alreadyStarted) {
      sessionStorage.setItem(SESSION_STARTED_KEY, "1");
      trackAnalytics("session_start", { category: "session", metadata: { surface } });
    }
    trackAnalytics("page_view", { category: "navigation", metadata: { surface } });

    const startedAt = Date.now();
    let maxScroll = 0;
    const sentDepths = new Set<number>();
    const onScroll = () => {
      const doc = document.documentElement;
      const total = Math.max(1, doc.scrollHeight - window.innerHeight);
      const depth = Math.max(0, Math.min(100, Math.round((window.scrollY / total) * 100)));
      maxScroll = Math.max(maxScroll, depth);
      for (const mark of [25, 50, 75, 90, 100]) {
        if (depth >= mark && !sentDepths.has(mark)) {
          sentDepths.add(mark);
          trackAnalytics("scroll_depth", { category: "engagement", value: mark, metadata: { surface, depth: mark } });
        }
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest("button,a,[role='button']") as HTMLElement | null;
      if (!target) return;
      trackAnalytics("click", {
        category: "interaction",
        label: elementLabel(target),
        metadata: { surface, tag: target.tagName.toLowerCase(), href: safeHref(target) },
      });
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!target || !/INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      const field = target.name || target.id || target.getAttribute("aria-label") || target.type || target.tagName.toLowerCase();
      trackAnalytics("field_focus", { category: "form", label: String(field).slice(0, 100), metadata: { surface, field_type: target.type || target.tagName.toLowerCase() } });
    };
    const onVisibility = () => trackAnalytics(document.hidden ? "page_hidden" : "page_visible", { category: "engagement", metadata: { surface } });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("visibilitychange", onVisibility);
    const heartbeat = window.setInterval(() => {
      if (!document.hidden) trackAnalytics("engagement_heartbeat", { category: "engagement", value: 15, metadata: { surface, seconds: Math.round((Date.now() - startedAt) / 1000), max_scroll: maxScroll } });
    }, 15_000);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
      sendBeaconEvent("page_exit", { surface, engagement_seconds: Math.round((Date.now() - startedAt) / 1000), max_scroll: maxScroll });
      void ids;
    };
  }, [surface]);
}

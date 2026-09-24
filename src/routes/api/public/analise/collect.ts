import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_ORIGINS = ["*"];
const MAX_BODY_BYTES = 48_000;

function corsHeaders(origin: string | null) {
  const allowOrigin = ALLOWED_ORIGINS.includes("*") ? "*" : origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-analise-site-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function safeString(value: unknown, max = 5000) {
  return String(value ?? "").slice(0, max);
}

function safeObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > 24_000) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function trackerScript(siteKey: string, collectorEndpoint: string) {
  const key = JSON.stringify(siteKey);
  const endpoint = JSON.stringify(collectorEndpoint);
  return `(()=>{
  const SITE_KEY=${key};
  const ENDPOINT=${endpoint};
  const STORE_PREFIX="analise_pro_"+SITE_KEY+"_";
  const id=(name)=>{try{let v=localStorage.getItem(STORE_PREFIX+name);if(!v){v=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));localStorage.setItem(STORE_PREFIX+name,v)}return v}catch(_){return Date.now().toString(36)+Math.random().toString(36).slice(2)}};
  const visitorId=id("visitor");
  const sessionKey="session";
  let sessionId;
  try{sessionId=sessionStorage.getItem(STORE_PREFIX+sessionKey);if(!sessionId){sessionId=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));sessionStorage.setItem(STORE_PREFIX+sessionKey,sessionId)}}catch(_){sessionId=visitorId+"_"+Date.now()}
  const qs=new URLSearchParams(location.search);
  const utm={source:qs.get("utm_source")||"",medium:qs.get("utm_medium")||"",campaign:qs.get("utm_campaign")||"",term:qs.get("utm_term")||"",content:qs.get("utm_content")||""};
  const ua=navigator.userAgent||"";
  const deviceType=/Mobi|Android/i.test(ua)?"mobile":"desktop";
  const device={device_type:deviceType,browser:/Edg\\//i.test(ua)?"Edge":/Chrome\\//i.test(ua)?"Chrome":/Firefox\\//i.test(ua)?"Firefox":/Safari\\//i.test(ua)?"Safari":"Other",os:/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/iPhone|iPad|iPod/i.test(ua)?"iOS":/Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":"Other",language:navigator.language||"",timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||""),screen_width:screen.width||0,screen_height:screen.height||0,viewport_width:innerWidth||0,viewport_height:innerHeight||0,network_type:(navigator.connection&&navigator.connection.effectiveType)||""};
  const send=(eventName,data={})=>{const body={site_key:SITE_KEY,session_id:sessionId,visitor_id:visitorId,event_name:eventName,page_url:location.href,page_path:location.pathname,page_title:document.title,event_data:data,utm,device};const qs=new URLSearchParams({site_key:SITE_KEY,session_id:sessionId,visitor_id:visitorId,event_name:eventName,page_url:location.href,page_path:location.pathname,page_title:document.title,event_data:JSON.stringify(data||{}),utm:JSON.stringify(utm),device:JSON.stringify(device)});try{const img=new Image();img.src=ENDPOINT+"?"+qs.toString()}catch(_){};try{fetch(ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(body),keepalive:true,credentials:"omit",mode:"cors"}).catch(()=>{})}catch(_){} };
  window.AnalisePro=window.AnalisePro||{track:(name,data)=>send(String(name||"custom"),data||{})};
  if(!window.__ANALISE_PRO_PAGE_VIEW_SENT__){window.__ANALISE_PRO_PAGE_VIEW_SENT__=true;send("page_view",{referrer:document.referrer||""})}
  document.addEventListener("click",e=>{const el=e.target&&e.target.closest?e.target.closest("a,button,[data-analise-event]"):null;if(!el)return;const name=el.getAttribute("data-analise-event")||"click";send(name,{text:(el.innerText||el.getAttribute("aria-label")||"").slice(0,300),href:el.href||""})},{passive:true});
})();`;
}

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = safeString(url.searchParams.get("site_key"), 160);
        if (!siteKey) {
          return Response.json({ ok: false, error: "invalid_tracker_request" }, { status: 400, headers: corsHeaders(request.headers.get("origin")) });
        }
        if (url.searchParams.get("format") !== "js") {
          const sessionId = safeString(url.searchParams.get("session_id"), 160);
          const visitorId = safeString(url.searchParams.get("visitor_id"), 160);
          const eventName = safeString(url.searchParams.get("event_name"), 80) || "page_view";
          const pageUrl = safeString(url.searchParams.get("page_url"), 4000);
          const pagePath = safeString(url.searchParams.get("page_path"), 2000);
          const pageTitle = safeString(url.searchParams.get("page_title"), 500);
          let eventData = {}; let utm = {}; let device = {};
          try { eventData = safeObject(JSON.parse(url.searchParams.get("event_data") || "{}")); } catch {}
          try { utm = safeObject(JSON.parse(url.searchParams.get("utm") || "{}")); } catch {}
          try { device = safeObject(JSON.parse(url.searchParams.get("device") || "{}")); } catch {}
          if (!sessionId || !visitorId) return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers: corsHeaders(request.headers.get("origin")) });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("analytics_pro_collect", { p_site_key: siteKey, p_session_id: sessionId, p_visitor_id: visitorId, p_event_name: eventName, p_page_url: pageUrl || null, p_page_path: pagePath || null, p_page_title: pageTitle || null, p_event_data: eventData, p_utm: utm, p_device: device, p_at: new Date().toISOString() });
          if (error) { console.error("[analise-pro] pixel collector", error.message); return Response.json({ ok: false, error: "collector_failed" }, { status: 500, headers: corsHeaders(request.headers.get("origin")) }); }
          return new Response("ok", { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
        }
        const collectorEndpoint = new URL("/api/public/analise/collect", url.origin).toString();
        return new Response(trackerScript(siteKey, collectorEndpoint), {
          status: 200,
          headers: { ...corsHeaders(request.headers.get("origin")), "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) }),
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const headers = corsHeaders(origin);
        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
          const body = await request.json();
          const siteKey = safeString(body?.site_key, 160);
          const sessionId = safeString(body?.session_id, 160);
          const visitorId = safeString(body?.visitor_id, 160);
          const eventName = safeString(body?.event_name, 80) || "unknown";
          const pageUrl = safeString(body?.page_url, 4000);
          const pagePath = safeString(body?.page_path, 2000);
          const pageTitle = safeString(body?.page_title, 500);
          const eventData = safeObject(body?.event_data);
          const utm = safeObject(body?.utm);
          const device = safeObject(body?.device);
          if (!siteKey || !sessionId || !visitorId) return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("analytics_pro_collect", {
            p_site_key: siteKey,
            p_session_id: sessionId,
            p_visitor_id: visitorId,
            p_event_name: eventName,
            p_page_url: pageUrl || null,
            p_page_path: pagePath || null,
            p_page_title: pageTitle || null,
            p_event_data: eventData,
            p_utm: utm,
            p_device: device,
            p_at: new Date().toISOString(),
          });
          if (error) {
            console.error("[analise-pro] collector", error.message);
            return Response.json({ ok: false, error: "collector_failed" }, { status: 500, headers });
          }
          return Response.json(data || { ok: true }, { status: 200, headers });
        } catch (error) {
          console.error("[analise-pro] invalid request", error);
          return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 48_000;

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function str(value: unknown, max = 5000) {
  return String(value ?? "").slice(0, max);
}

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.stringify(value).length <= 24_000 ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function jsonObj(value: string | null) {
  try {
    return value ? obj(JSON.parse(value)) : {};
  } catch {
    return {};
  }
}

async function collect(input: {
  siteKey: string;
  sessionId: string;
  visitorId: string;
  eventName: string;
  pageUrl?: string;
  pagePath?: string;
  pageTitle?: string;
  eventData?: Record<string, unknown>;
  utm?: Record<string, unknown>;
  device?: Record<string, unknown>;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("analytics_pro_collect", {
    p_site_key: input.siteKey,
    p_session_id: input.sessionId,
    p_visitor_id: input.visitorId,
    p_event_name: input.eventName,
    p_page_url: input.pageUrl || null,
    p_page_path: input.pagePath || null,
    p_page_title: input.pageTitle || null,
    p_event_data: input.eventData || {},
    p_utm: input.utm || {},
    p_device: input.device || {},
    p_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data || { ok: true };
}

function trackerScript(siteKey: string, endpoint: string, realtimeEndpoint: string) {
  const key = JSON.stringify(siteKey);
  const ep = JSON.stringify(endpoint);
  const rt = JSON.stringify(realtimeEndpoint);

  return `(()=>{try{
const S=${key},E=${ep},R=${rt},P="analise_pro_"+S+"_";
const id=(st,k)=>{try{let v=st.getItem(P+k);if(!v){v=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);st.setItem(P+k,v)}return v}catch{return Date.now().toString(36)+Math.random().toString(36).slice(2)}};
const V=id(localStorage,"visitor"),I=id(sessionStorage,"session");
const q=new URLSearchParams(location.search);
const U={source:q.get("utm_source")||"",medium:q.get("utm_medium")||"",campaign:q.get("utm_campaign")||"",term:q.get("utm_term")||"",content:q.get("utm_content")||"",click_id:q.get("fbclid")||q.get("gclid")||q.get("ttclid")||q.get("msclkid")||""};
const ua=navigator.userAgent||"";
const D={device_type:/Mobi|Android/i.test(ua)?"mobile":"desktop",browser:/Edg\\//i.test(ua)?"Edge":/Chrome\\//i.test(ua)?"Chrome":/Firefox\\//i.test(ua)?"Firefox":/Safari\\//i.test(ua)?"Safari":"Other",os:/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/iPhone|iPad|iPod/i.test(ua)?"iOS":/Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":"Other",language:navigator.language||"",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",screen_width:screen.width||0,screen_height:screen.height||0,viewport_width:innerWidth||0,viewport_height:innerHeight||0,network_type:navigator.connection?.effectiveType||""};
const payload=(n,d={})=>({site_key:S,session_id:I,visitor_id:V,event_name:n,page_url:location.href,page_path:location.pathname,page_title:document.title,event_data:d,utm:U,device:D});
const getUrl=(b)=>{const u=new URL(E);for(const[k,v]of Object.entries(b))u.searchParams.set(k,typeof v==="string"?v:JSON.stringify(v));return u.toString()};
const send=(n,d={},urgent=false)=>{
 const b=payload(n,d);
 try{
  if(navigator.sendBeacon){
   const ok=navigator.sendBeacon(E,new Blob([JSON.stringify(b)],{type:"text/plain;charset=UTF-8"}));
   if(ok)return;
  }
  if(window.fetch){fetch(E,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b),keepalive:true,credentials:"omit"}).catch(()=>{try{new Image().src=getUrl(b)}catch{}});return}
  new Image().src=getUrl(b);
 }catch{try{new Image().src=getUrl(b)}catch{}}
};
const presence=()=>{
 if(document.visibilityState!=="visible")return;
 const b={site_key:S,session_id:I,visitor_id:V,page_path:location.pathname,page_title:document.title};
 try{
  if(window.fetch){fetch(R,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b),keepalive:true,credentials:"omit"}).catch(()=>{});return}
 }catch{}
};
window.AnalisePro=window.AnalisePro||{};
window.AnalisePro.track=(n,d)=>send(String(n||"custom"),d||{},false);
window.AnalisePro.siteKey=S;
window.__ANALISE_PRO_PUBLIC__=true;

if(!window.__AP_PAGEVIEW__){window.__AP_PAGEVIEW__=1;send("page_view",{referrer:document.referrer||""});presence()}

let max=0,activeMs=0,visibleSince=document.visibilityState==="visible"?Date.now():0,performanceSent=false;
const sectionSeen=new Set(),scrollMarks=new Set();
const activeNow=()=>{if(document.visibilityState==="visible"&&visibleSince)activeMs+=Date.now()-visibleSince;visibleSince=document.visibilityState==="visible"?Date.now():0};
document.addEventListener("visibilitychange",()=>{activeNow();if(document.visibilityState==="visible")presence();else send("page_exit",{active_seconds:Math.round(activeMs/1000),scroll_percent:max},true)});
const beat=()=>{activeNow();send("engagement",{engaged_seconds:Math.round(activeMs/1000),scroll_percent:max});presence()};
const timer=setInterval(()=>{if(document.visibilityState==="visible")beat()},15000);

const scrollHandler=()=>{try{const h=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)-innerHeight,p=h>0?Math.round(scrollY/h*100):100;if(p>max){max=Math.min(100,p);[25,50,75,90,100].forEach(mark=>{if(max>=mark&&!scrollMarks.has(mark)){scrollMarks.add(mark);send("scroll",{scroll_percent:mark})}})}}catch{}};
addEventListener("scroll",scrollHandler,{passive:true});

const observeSections=()=>{if(!("IntersectionObserver" in window))return;const ids=["headline","problem","solution","pricing","faq"];const io=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting&&!sectionSeen.has(entry.target.id)){sectionSeen.add(entry.target.id);send("section_view",{section_id:entry.target.id})}}),{threshold:0.35});ids.forEach(id=>{const el=document.getElementById(id);if(el)io.observe(el)});window.__AP_SECTION_OBSERVER__=io};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",observeSections,{once:true});else observeSections();

const reportPerformance=()=>{if(performanceSent)return;performanceSent=true;try{const n=performance.getEntriesByType("navigation")[0],p=performance.getEntriesByName("first-contentful-paint")[0];if(n)send("performance",{ttfb_ms:Math.round(n.responseStart),dom_interactive_ms:Math.round(n.domInteractive),load_ms:Math.round(n.loadEventEnd||performance.now()),fcp_ms:p?Math.round(p.startTime):null,transfer_kb:n.transferSize?Math.round(n.transferSize/1024):null})}catch{}};
if(document.readyState==="complete")setTimeout(reportPerformance,100);else addEventListener("load",()=>setTimeout(reportPerformance,100),{once:true});

document.addEventListener("click",e=>{try{const el=e.target?.closest?.("a,button,[role='button'],[data-analise-event]");if(!el)return;const cta=el.getAttribute("data-cta");const loc=el.getAttribute("data-cta-loc");const text=(el.innerText||el.getAttribute("aria-label")||el.getAttribute("title")||"").trim().slice(0,200);if(cta){send("cta_click",{cta:String(cta).slice(0,160),cta_loc:String(loc||"unknown").slice(0,160),text,element:el.tagName.toLowerCase(),href:el.href||""});return}const custom=el.getAttribute("data-analise-event");send(custom||"click",{text,element:el.tagName.toLowerCase(),href:el.href||"",id:el.id||""})}catch{}},{passive:true});

addEventListener("pagehide",()=>{clearInterval(timer);activeNow();send("page_exit",{active_seconds:Math.round(activeMs/1000),scroll_percent:max},true);presence()});
}catch(e){try{console.warn("[AnalisePro]",e)}catch{}}})();`;
}

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = str(url.searchParams.get("site_key"), 160);
        const responseHeaders = headers();

        if (!siteKey) return new Response(null, { status: 204, headers: responseHeaders });

        if (url.searchParams.get("format") === "js") {
          const endpoint = new URL("/api/public/analise/collect", url.origin).toString();
          const realtimeEndpoint = new URL("/api/public/analise/realtime", url.origin).toString();
          return new Response(trackerScript(siteKey, endpoint, realtimeEndpoint), {
            status: 200,
            headers: {
              ...responseHeaders,
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "public,max-age=60,stale-while-revalidate=300",
            },
          });
        }

        const sessionId = str(url.searchParams.get("session_id"), 160);
        const visitorId = str(url.searchParams.get("visitor_id"), 160);
        if (!sessionId || !visitorId) return new Response(null, { status: 204, headers: responseHeaders });

        try {
          await collect({
            siteKey,
            sessionId,
            visitorId,
            eventName: str(url.searchParams.get("event_name"), 80) || "unknown",
            pageUrl: str(url.searchParams.get("page_url"), 4000),
            pagePath: str(url.searchParams.get("page_path"), 2000),
            pageTitle: str(url.searchParams.get("page_title"), 500),
            eventData: jsonObj(url.searchParams.get("event_data")),
            utm: jsonObj(url.searchParams.get("utm")),
            device: jsonObj(url.searchParams.get("device")),
          });
        } catch (error) {
          console.error("[AnalisePro] GET", error);
        }

        return new Response(null, { status: 204, headers: responseHeaders });
      },

      OPTIONS: async () => new Response(null, { status: 204, headers: headers() }),

      POST: async ({ request }) => {
        const responseHeaders = headers();
        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > MAX_BODY_BYTES) {
            return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers: responseHeaders });
          }

          const body = await request.json();
          const siteKey = str(body?.site_key, 160);
          const sessionId = str(body?.session_id, 160);
          const visitorId = str(body?.visitor_id, 160);

          if (!siteKey || !sessionId || !visitorId) {
            return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers: responseHeaders });
          }

          const data = await collect({
            siteKey,
            sessionId,
            visitorId,
            eventName: str(body?.event_name, 80) || "unknown",
            pageUrl: str(body?.page_url, 4000),
            pagePath: str(body?.page_path, 2000),
            pageTitle: str(body?.page_title, 500),
            eventData: obj(body?.event_data),
            utm: obj(body?.utm),
            device: obj(body?.device),
          });

          return Response.json(data, { status: 200, headers: responseHeaders });
        } catch (error) {
          console.error("[AnalisePro] POST", error);
          return Response.json({ ok: false, error: "collector_failed" }, { status: 500, headers: responseHeaders });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 48_000;
const COLLECTOR_ORIGIN = "https://hotbox.up.railway.app";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": "*",
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
    return JSON.stringify(value).length <= 24_000 ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseObject(value: string | null) {
  try { return safeObject(JSON.parse(value || "{}")); } catch { return {}; }
}

function trackerScript(siteKey: string) {
  const key = JSON.stringify(siteKey);
  const endpoint = JSON.stringify(`${COLLECTOR_ORIGIN}/api/public/analise/collect`);
  return `(()=>{
const SITE_KEY=${key};
const ENDPOINT=${endpoint};
const PREFIX="analise_pro_"+SITE_KEY+"_";
const makeId=(store,name)=>{try{let v=store.getItem(PREFIX+name);if(!v){v=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);store.setItem(PREFIX+name,v)}return v}catch(_){return Date.now().toString(36)+Math.random().toString(36).slice(2)}};
const visitorId=makeId(localStorage,"visitor");
let sessionId;try{sessionId=sessionStorage.getItem(PREFIX+"session");if(!sessionId){sessionId=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);sessionStorage.setItem(PREFIX+"session",sessionId)}}catch(_){sessionId=visitorId+"_"+Date.now()}
const q=new URLSearchParams(location.search);
const utm={source:q.get("utm_source")||"",medium:q.get("utm_medium")||"",campaign:q.get("utm_campaign")||"",term:q.get("utm_term")||"",content:q.get("utm_content")||"",click_id:q.get("fbclid")||q.get("gclid")||q.get("ttclid")||""};
const ua=navigator.userAgent||"";
const device={device_type:/Mobi|Android/i.test(ua)?"mobile":"desktop",browser:/Edg\\//i.test(ua)?"Edge":/Chrome\\//i.test(ua)?"Chrome":/Firefox\\//i.test(ua)?"Firefox":/Safari\\//i.test(ua)?"Safari":"Other",os:/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/iPhone|iPad|iPod/i.test(ua)?"iOS":/Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":"Other",language:navigator.language||"",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",screen_width:screen.width||0,screen_height:screen.height||0,viewport_width:innerWidth||0,viewport_height:innerHeight||0};
const send=(eventName,data={})=>{const params=new URLSearchParams({site_key:SITE_KEY,session_id:sessionId,visitor_id:visitorId,event_name:eventName,page_url:location.href,page_path:location.pathname,page_title:document.title,event_data:JSON.stringify(data||{}),utm:JSON.stringify(utm),device:JSON.stringify(device)});try{new Image().src=ENDPOINT+"?"+params.toString()}catch(_){} };
window.AnalisePro=window.AnalisePro||{};window.AnalisePro.track=(name,data)=>send(String(name||"custom"),data||{});
if(!window.__ANALISE_PRO_PAGE_VIEW_SENT__){window.__ANALISE_PRO_PAGE_VIEW_SENT__=true;send("page_view",{referrer:document.referrer||""})}
let maxScroll=0;
addEventListener("scroll",()=>{const h=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)-innerHeight;const p=h>0?Math.round(scrollY/h*100):100;if(p>maxScroll){maxScroll=Math.min(100,p);if([25,50,75,90,100].includes(maxScroll))send("scroll",{scroll_percent:maxScroll})}},{passive:true});
const started=Date.now();const beat=()=>send("engagement",{engaged_seconds:Math.round((Date.now()-started)/1000),scroll_percent:maxScroll});const timer=setInterval(()=>{if(document.visibilityState==="visible")beat()},15000);addEventListener("beforeunload",()=>{clearInterval(timer);beat()});
document.addEventListener("click",e=>{const el=e.target?.closest?.("a,button,[data-analise-event]");if(el)send(el.getAttribute("data-analise-event")||"click",{text:(el.innerText||el.getAttribute("aria-label")||"").slice(0,300),href:el.href||""})},{passive:true});
})();`;
}

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = safeString(url.searchParams.get("site_key"), 160);
        if (!siteKey) return Response.json({ ok: false, error: "invalid_tracker_request" }, { status: 400, headers: corsHeaders(request.headers.get("origin")) });
        if (url.searchParams.get("format") === "js") {
          return new Response(trackerScript(siteKey), { status: 200, headers: { ...corsHeaders(request.headers.get("origin")), "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } });
        }
        const sessionId=safeString(url.searchParams.get("session_id"),160), visitorId=safeString(url.searchParams.get("visitor_id"),160);
        if(!sessionId||!visitorId) return new Response(null,{status:204,headers:corsHeaders(request.headers.get("origin"))});
        const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
        const {data,error}=await supabaseAdmin.rpc("analytics_pro_collect",{p_site_key:siteKey,p_session_id:sessionId,p_visitor_id:visitorId,p_event_name:safeString(url.searchParams.get("event_name"),80)||"unknown",p_page_url:safeString(url.searchParams.get("page_url"),4000)||null,p_page_path:safeString(url.searchParams.get("page_path"),2000)||null,p_page_title:safeString(url.searchParams.get("page_title"),500)||null,p_event_data:parseObject(url.searchParams.get("event_data")),p_utm:parseObject(url.searchParams.get("utm")),p_device:parseObject(url.searchParams.get("device")),p_at:new Date().toISOString()});
        if(error){console.error("[analise-pro] pixel collector",error.message);return new Response(null,{status:204,headers:corsHeaders(request.headers.get("origin"))})}
        return new Response(null,{status:204,headers:corsHeaders(request.headers.get("origin"))});
      },
      OPTIONS: async ({ request }) => new Response(null,{status:204,headers:corsHeaders(request.headers.get("origin"))}),
      POST: async ({ request }) => {
        const headers=corsHeaders(request.headers.get("origin"));
        try{
          const length=Number(request.headers.get("content-length")||0);if(length>MAX_BODY_BYTES)return Response.json({ok:false,error:"payload_too_large"},{status:413,headers});
          const body=await request.json();const siteKey=safeString(body?.site_key,160),sessionId=safeString(body?.session_id,160),visitorId=safeString(body?.visitor_id,160);if(!siteKey||!sessionId||!visitorId)return Response.json({ok:false,error:"missing_identity"},{status:400,headers});
          const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
          const {data,error}=await supabaseAdmin.rpc("analytics_pro_collect",{p_site_key:siteKey,p_session_id:sessionId,p_visitor_id:visitorId,p_event_name:safeString(body?.event_name,80)||"unknown",p_page_url:safeString(body?.page_url,4000)||null,p_page_path:safeString(body?.page_path,2000)||null,p_page_title:safeString(body?.page_title,500)||null,p_event_data:safeObject(body?.event_data),p_utm:safeObject(body?.utm),p_device:safeObject(body?.device),p_at:new Date().toISOString()});
          if(error)return Response.json({ok:false,error:"collector_failed"},{status:500,headers});return Response.json(data||{ok:true},{status:200,headers});
        }catch(error){console.error("[analise-pro] POST",error);return Response.json({ok:false,error:"invalid_request"},{status:400,headers});}
      },
    },
  },
});

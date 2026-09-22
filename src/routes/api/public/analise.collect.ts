import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 48_000;
const MAX_EVENT_NAME = 80;
const ALLOWED_EVENTS = new Set(["page_view","scroll_depth","click","outbound_click","form_start","heartbeat","page_exit","purchase","conversion","lead"]);

function trackerScript(siteKey: string, endpoint: string) {
  const S = JSON.stringify(siteKey);
  const E = JSON.stringify(endpoint);
  return `(function(w,d){
var S=${S},E=${E},K="analise_pro_"+S;
var V=localStorage.getItem(K+"_v")||("v_"+crypto.randomUUID());
localStorage.setItem(K+"_v",V);
var SESSION_TTL=30*60*1000,now=Date.now(),stored=Number(sessionStorage.getItem(K+"_t")||0);
var Q=sessionStorage.getItem(K+"_s");
if(!Q||!stored||(now-stored)>SESSION_TTL){Q="s_"+crypto.randomUUID();sessionStorage.setItem(K+"_s",Q);}
sessionStorage.setItem(K+"_t",String(now));
var started=Date.now(),maxScroll=0,sent={},lastUrl=location.href;
function qs(){
 var q=new URLSearchParams(location.search);
 return {source:q.get("utm_source")||"direct",medium:q.get("utm_medium")||"none",campaign:q.get("utm_campaign")||null,term:q.get("utm_term")||null,content:q.get("utm_content")||null,click_id:q.get("fbclid")||q.get("gclid")||q.get("ttclid")||null};
}
function device(){
 var n=navigator,u=n.userAgent||"";
 return {device_type:/Mobi|Android|iPhone|iPad/i.test(u)?"mobile":"desktop",browser:/Edg\\//i.test(u)?"Edge":/Chrome\\//i.test(u)?"Chrome":/Firefox\\//i.test(u)?"Firefox":/Safari\\//i.test(u)?"Safari":"Other",os:/Android/i.test(u)?"Android":/iPhone|iPad/i.test(u)?"iOS":/Windows/i.test(u)?"Windows":/Mac OS/i.test(u)?"macOS":"Other",language:n.language,timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||null),screen_width:screen.width,screen_height:screen.height,viewport_width:innerWidth,viewport_height:innerHeight,network_type:n.connection&&n.connection.effectiveType||null};
}
function send(name,data){
 data=data||{};
 var payload={site_key:S,session_id:Q,visitor_id:V,event_name:name,page_url:location.href,page_path:location.pathname,page_title:d.title,event_data:data,utm:qs(),device:device()};
 var body=JSON.stringify(payload);
 try{
  if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([body],{type:"application/json"})))return;
 }catch(_){}
 fetch(E,{method:"POST",headers:{"content-type":"application/json"},body:body,keepalive:true}).catch(function(){});
}
function once(k,n,data){if(sent[k])return;sent[k]=1;send(n,data);}
function pageView(){
 var ref=d.referrer||null;
 send("page_view",{referrer:ref});
}
function scroll(){
 var max=Math.max(1,d.documentElement.scrollHeight-innerHeight);
 var p=Math.min(100,Math.max(0,Math.round(scrollY/max*100)));
 if(p>maxScroll)maxScroll=p;
 [25,50,75,90,100].forEach(function(m){if(p>=m)once("scroll_"+m,"scroll_depth",{scroll_percent:m});});
}
function click(e){
 var el=e.target&&e.target.closest&&e.target.closest("a,button,[role='button'],input[type='submit']");
 if(!el)return;
 var label=(el.innerText||el.getAttribute("aria-label")||el.getAttribute("data-analytics")||"").trim().slice(0,180);
 send("click",{label:label,element:el.tagName.toLowerCase(),id:el.id||null,cta:el.getAttribute("data-analytics")||null});
 if(el.tagName==="A"&&el.href){try{if(new URL(el.href,location.href).origin!==location.origin)send("outbound_click",{href:el.href,label:label});}catch(_){}}
}
function form(e){
 var el=e.target;
 if(el&&el.matches&&el.matches("input,textarea,select"))once("form_"+(el.name||el.id||"field"),"form_start",{field:el.name||el.id||"field"});
}
function routeChange(){
 if(location.href===lastUrl)return;
 lastUrl=location.href;maxScroll=0;started=Date.now();sent={};sessionStorage.setItem(K+"_t",String(Date.now()));pageView();
}
["pushState","replaceState"].forEach(function(method){
 var original=history[method];
 history[method]=function(){var r=original.apply(this,arguments);setTimeout(routeChange,0);return r;};
});
addEventListener("popstate",routeChange);
addEventListener("scroll",scroll,{passive:true});
addEventListener("click",click,true);
addEventListener("input",form,true);
var tick=setInterval(function(){
 if(document.visibilityState==="visible"){sessionStorage.setItem(K+"_t",String(Date.now()));send("heartbeat",{engaged_seconds:Math.round((Date.now()-started)/1000),scroll_percent:maxScroll});}
},15000);
addEventListener("pagehide",function(){clearInterval(tick);send("page_exit",{engaged_seconds:Math.round((Date.now()-started)/1000),scroll_percent:maxScroll});});
w.AnalisePro={track:function(name,data){send(name,data||{});},identify:function(data){send("lead",data||{});}};
pageView();
})(window,document);`;
}

function corsHeaders(origin: string | null) {
  const allowOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
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

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = safeString(url.searchParams.get("site_key"), 160);
        if (url.searchParams.get("format") !== "js") return Response.json({ ok: true, service: "analise-pro-collector" });
        if (!siteKey) return new Response("// Análise Pro: missing site_key", { status: 400, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
        const endpoint = new URL("/api/public/analise/collect", url.origin).toString();
        return new Response(trackerScript(siteKey, endpoint), { status: 200, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300", "x-content-type-options": "nosniff" } });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const headers = corsHeaders(origin);

        try {
          const declaredLength = Number(request.headers.get("content-length") || 0);
          if (declaredLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
          const raw = await request.text();
          if (raw.length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
          const body = JSON.parse(raw);
          const siteKey = safeString(body?.site_key, 160);
          const sessionId = safeString(body?.session_id, 160);
          const visitorId = safeString(body?.visitor_id, 160);
          const eventName = safeString(body?.event_name, MAX_EVENT_NAME) || "unknown";
          if (!ALLOWED_EVENTS.has(eventName)) return Response.json({ ok: false, error: "event_not_allowed" }, { status: 422, headers });
          const pageUrl = safeString(body?.page_url, 4000);
          const pagePath = safeString(body?.page_path, 2000);
          const pageTitle = safeString(body?.page_title, 500);
          const eventData = safeObject(body?.event_data);
          const utm = safeObject(body?.utm);
          const device = safeObject(body?.device);

          if (!siteKey || !sessionId || !visitorId) {
            return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: site, error: siteError } = await supabaseAdmin.from("analytics_pro_sites").select("id,domain,active").eq("site_key", siteKey).maybeSingle();
          if (siteError || !site?.active) return Response.json({ ok: false, error: "invalid_site" }, { status: 404, headers });
          if (site.domain && origin) {
            const configured = site.domain.replace(/^https?:\\/\\//i, "").split("/")[0].replace(/\\/$/, "").toLowerCase();
            let requestHost = "";
            try { requestHost = new URL(origin).host.toLowerCase(); } catch { return Response.json({ ok: false, error: "invalid_origin" }, { status: 403, headers }); }
            if (configured && configured !== requestHost && !configured.startsWith("*.") ) return Response.json({ ok: false, error: "origin_not_allowed" }, { status: 403, headers });
            if (configured.startsWith("*.") && !requestHost.endsWith(configured.slice(1))) return Response.json({ ok: false, error: "origin_not_allowed" }, { status: 403, headers });
          }
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

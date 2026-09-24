import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 48_000;
const COLLECTOR_ENDPOINT = "https://hotbox.up.railway.app/api/public/analise/collect";

function corsHeaders() {
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
  try {
    return safeObject(JSON.parse(value || "{}"));
  } catch {
    return {};
  }
}

function trackerScript(siteKey: string) {
  const key = JSON.stringify(siteKey);
  const endpoint = JSON.stringify(COLLECTOR_ENDPOINT);
  return [
    "(function(){",
    "try{",
    "var SITE_KEY=" + key + ";",
    "var ENDPOINT=" + endpoint + ";",
    "var PREFIX='analise_pro_'+SITE_KEY+'_';",
    "function id(store,name){try{var v=store.getItem(PREFIX+name);if(!v){v=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+String(Math.random()).slice(2);store.setItem(PREFIX+name,v)}return v}catch(e){return String(Date.now())+String(Math.random()).slice(2)}}",
    "var visitorId=id(window.localStorage,'visitor');",
    "var sessionId=id(window.sessionStorage,'session');",
    "var q=new URLSearchParams(window.location.search);",
    "var utm={source:q.get('utm_source')||'',medium:q.get('utm_medium')||'',campaign:q.get('utm_campaign')||'',term:q.get('utm_term')||'',content:q.get('utm_content')||'',click_id:q.get('fbclid')||q.get('gclid')||q.get('ttclid')||''};",
    "var ua=navigator.userAgent||'';",
    "var mobile=/Mobi|Android/i.test(ua);",
    "var browser=ua.indexOf('Edg/')>=0?'Edge':ua.indexOf('Chrome/')>=0?'Chrome':ua.indexOf('Firefox/')>=0?'Firefox':ua.indexOf('Safari/')>=0?'Safari':'Other';",
    "var os=ua.indexOf('Windows')>=0?'Windows':ua.indexOf('Android')>=0?'Android':/iPhone|iPad|iPod/i.test(ua)?'iOS':ua.indexOf('Mac OS')>=0?'macOS':ua.indexOf('Linux')>=0?'Linux':'Other';",
    "var device={device_type:mobile?'mobile':'desktop',browser:browser,os:os,language:navigator.language||'',timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),screen_width:screen.width||0,screen_height:screen.height||0,viewport_width:window.innerWidth||0,viewport_height:window.innerHeight||0};",
    "function send(name,data){try{var p=new URLSearchParams();p.set('site_key',SITE_KEY);p.set('session_id',sessionId);p.set('visitor_id',visitorId);p.set('event_name',name);p.set('page_url',window.location.href);p.set('page_path',window.location.pathname);p.set('page_title',document.title);p.set('event_data',JSON.stringify(data||{}));p.set('utm',JSON.stringify(utm));p.set('device',JSON.stringify(device));var img=new Image();img.src=ENDPOINT+'?'+p.toString()}catch(e){}}",
    "window.AnalisePro=window.AnalisePro||{};window.AnalisePro.track=function(name,data){send(String(name||'custom'),data||{})};",
    "if(!window.__ANALISE_PRO_PAGE_VIEW_SENT__){window.__ANALISE_PRO_PAGE_VIEW_SENT__=true;send('page_view',{referrer:document.referrer||''})}",
    "var maxScroll=0;",
    "window.addEventListener('scroll',function(){try{var h=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)-window.innerHeight;var p=h>0?Math.round(window.scrollY/h*100):100;if(p>maxScroll){maxScroll=Math.min(100,p);if(p===25||p===50||p===75||p===90||p===100)send('scroll',{scroll_percent:maxScroll})}}catch(e){}},{passive:true});",
    "var started=Date.now();",
    "window.setInterval(function(){if(document.visibilityState==='visible')send('engagement',{engaged_seconds:Math.round((Date.now()-started)/1000),scroll_percent:maxScroll})},15000);",
    "document.addEventListener('click',function(e){try{var el=e.target&&e.target.closest?e.target.closest('a,button,[data-analise-event]'):null;if(el)send(el.getAttribute('data-analise-event')||'click',{text:(el.innerText||el.getAttribute('aria-label')||'').slice(0,300),href:el.href||''})}catch(err){}},{passive:true});",
    "}catch(e){if(window.console)console.warn('[AnalisePro] tracker error',e)}})();"
  ].join("\n");
}

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = safeString(url.searchParams.get("site_key"), 160);
        const headers = corsHeaders();
        if (!siteKey) return Response.json({ ok: false, error: "invalid_tracker_request" }, { status: 400, headers });

        if (url.searchParams.get("format") === "js") {
          return new Response(trackerScript(siteKey), {
            status: 200,
            headers: { ...headers, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
          });
        }

        const sessionId = safeString(url.searchParams.get("session_id"), 160);
        const visitorId = safeString(url.searchParams.get("visitor_id"), 160);
        if (!sessionId || !visitorId) return new Response(null, { status: 204, headers });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("analytics_pro_collect", {
          p_site_key: siteKey,
          p_session_id: sessionId,
          p_visitor_id: visitorId,
          p_event_name: safeString(url.searchParams.get("event_name"), 80) || "unknown",
          p_page_url: safeString(url.searchParams.get("page_url"), 4000) || null,
          p_page_path: safeString(url.searchParams.get("page_path"), 2000) || null,
          p_page_title: safeString(url.searchParams.get("page_title"), 500) || null,
          p_event_data: parseObject(url.searchParams.get("event_data")),
          p_utm: parseObject(url.searchParams.get("utm")),
          p_device: parseObject(url.searchParams.get("device")),
          p_at: new Date().toISOString(),
        });
        if (error) console.error("[analise-pro] collector", error.message);
        return new Response(null, { status: 204, headers });
      },

      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),

      POST: async ({ request }) => {
        const headers = corsHeaders();
        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
          const body = await request.json();
          const siteKey = safeString(body?.site_key, 160);
          const sessionId = safeString(body?.session_id, 160);
          const visitorId = safeString(body?.visitor_id, 160);
          if (!siteKey || !sessionId || !visitorId) return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("analytics_pro_collect", {
            p_site_key: siteKey,
            p_session_id: sessionId,
            p_visitor_id: visitorId,
            p_event_name: safeString(body?.event_name, 80) || "unknown",
            p_page_url: safeString(body?.page_url, 4000) || null,
            p_page_path: safeString(body?.page_path, 2000) || null,
            p_page_title: safeString(body?.page_title, 500) || null,
            p_event_data: safeObject(body?.event_data),
            p_utm: safeObject(body?.utm),
            p_device: safeObject(body?.device),
            p_at: new Date().toISOString(),
          });
          if (error) return Response.json({ ok: false, error: "collector_failed" }, { status: 500, headers });
          return Response.json(data || { ok: true }, { status: 200, headers });
        } catch (error) {
          console.error("[analise-pro] POST", error);
          return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
        }
      },
    },
  },
});
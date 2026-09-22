import { createFileRoute } from "@tanstack/react-router";

const MAX_SITE_KEY = 160;

function safeSiteKey(value: string | null) {
  return String(value || "").slice(0, MAX_SITE_KEY);
}

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
  if(navigator.sendBeacon){navigator.sendBeacon(E,new Blob([body],{type:"application/json"}));return;}
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

export const Route = createFileRoute("/api/public/analise/tracker")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const siteKey = safeSiteKey(url.searchParams.get("site_key"));
        if (!siteKey) return new Response("// Análise Pro: missing site_key", { status: 400, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
        const endpoint = new URL("/api/public/analise/collect", url.origin).toString();
        const script = trackerScript(siteKey, endpoint);
        return new Response(script, {
          status: 200,
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=300",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});

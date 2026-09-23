import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 48000;

function headers(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"content-type","Cache-Control":"no-store"}}
function str(v:unknown,n=5000){return String(v??"").slice(0,n)}
function obj(v:unknown){if(!v||typeof v!=="object"||Array.isArray(v))return {};try{return JSON.stringify(v).length<=24000?v as Record<string,unknown>:{} }catch{return {}}}
function jsonObj(v:string|null){try{return v?obj(JSON.parse(v)):{} }catch{return {}}}

async function collect(x:{siteKey:string;sessionId:string;visitorId:string;eventName:string;pageUrl?:string;pagePath?:string;pageTitle?:string;eventData?:Record<string,unknown>;utm?:Record<string,unknown>;device?:Record<string,unknown>}) {
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const {data,error}=await supabaseAdmin.rpc("analytics_pro_collect",{p_site_key:x.siteKey,p_session_id:x.sessionId,p_visitor_id:x.visitorId,p_event_name:x.eventName,p_page_url:x.pageUrl||null,p_page_path:x.pagePath||null,p_page_title:x.pageTitle||null,p_event_data:x.eventData||{},p_utm:x.utm||{},p_device:x.device||{},p_at:new Date().toISOString()});
  if(error)throw error;
  return data||{ok:true};
}

function trackerScript(siteKey:string,endpoint:string){
 const key=JSON.stringify(siteKey),ep=JSON.stringify(endpoint);
 return `(()=>{try{
const S=${key},E=${ep},P="analise_pro_"+S+"_";
const id=(st,k)=>{try{let v=st.getItem(P+k);if(!v){v=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);st.setItem(P+k,v)}return v}catch{return Date.now().toString(36)+Math.random().toString(36).slice(2)}};
const V=id(localStorage,"visitor"),I=id(sessionStorage,"session");
const q=new URLSearchParams(location.search),U={source:q.get("utm_source")||"",medium:q.get("utm_medium")||"",campaign:q.get("utm_campaign")||"",term:q.get("utm_term")||"",content:q.get("utm_content")||"",click_id:q.get("fbclid")||q.get("gclid")||q.get("ttclid")||""};
const ua=navigator.userAgent||"",D={device_type:/Mobi|Android/i.test(ua)?"mobile":"desktop",browser:/Edg\\//i.test(ua)?"Edge":/Chrome\\//i.test(ua)?"Chrome":/Firefox\\//i.test(ua)?"Firefox":/Safari\\//i.test(ua)?"Safari":"Other",os:/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/iPhone|iPad|iPod/i.test(ua)?"iOS":/Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":"Other",language:navigator.language||"",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",screen_width:screen.width||0,screen_height:screen.height||0,viewport_width:innerWidth||0,viewport_height:innerHeight||0};
const send=(n,d={})=>{const b={site_key:S,session_id:I,visitor_id:V,event_name:n,page_url:location.href,page_path:location.pathname,page_title:document.title,event_data:d,utm:U,device:D};const u=new URL(E);for(const[k,v]of Object.entries(b))u.searchParams.set(k,typeof v==="string"?v:JSON.stringify(v));try{const x=new Image();x.src=u.toString()}catch{}};
window.AnalisePro=window.AnalisePro||{};window.AnalisePro.track=(n,d)=>send(String(n||"custom"),d||{});
if(!window.__AP_PAGEVIEW__) {window.__AP_PAGEVIEW__=1;send("page_view",{referrer:document.referrer||""})}
let max=0,start=Date.now();
addEventListener("scroll",()=>{const h=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)-innerHeight,p=h>0?Math.round(scrollY/h*100):100;if(p>max){max=Math.min(100,p);if([25,50,75,90,100].includes(max))send("scroll",{scroll_percent:max})}},{passive:true});
const beat=()=>send("engagement",{engaged_seconds:Math.round((Date.now()-start)/1000),scroll_percent:max});
const timer=setInterval(()=>{if(document.visibilityState==="visible")beat()},15000);
addEventListener("beforeunload",()=>{clearInterval(timer);beat()});
document.addEventListener("click",e=>{const el=e.target?.closest?.("a,button,[data-analise-event]");if(el)send(el.getAttribute("data-analise-event")||"click",{text:(el.innerText||el.getAttribute("aria-label")||"").slice(0,200),href:el.href||""})},{passive:true});
}catch(e){console.warn("[AnalisePro]",e)}})();`;
}

export const Route=createFileRoute("/api/public/analise/collect")({server:{handlers:{
GET:async({request})=>{
 const u=new URL(request.url),siteKey=str(u.searchParams.get("site_key"),160);
 if(!siteKey)return new Response(null,{status:204,headers:headers()});
 if(u.searchParams.get("format")==="js"){
  const endpoint=new URL("/api/public/analise/collect",u.origin).toString();
  return new Response(trackerScript(siteKey,endpoint),{status:200,headers:{...headers(),"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"public,max-age=60,stale-while-revalidate=300"}});
 }
 const sessionId=str(u.searchParams.get("session_id"),160),visitorId=str(u.searchParams.get("visitor_id"),160);
 if(!sessionId||!visitorId)return new Response(null,{status:204,headers:headers()});
 try{await collect({siteKey,sessionId,visitorId,eventName:str(u.searchParams.get("event_name"),80)||"unknown",pageUrl:str(u.searchParams.get("page_url"),4000),pagePath:str(u.searchParams.get("page_path"),2000),pageTitle:str(u.searchParams.get("page_title"),500),eventData:jsonObj(u.searchParams.get("event_data")),utm:jsonObj(u.searchParams.get("utm")),device:jsonObj(u.searchParams.get("device"))})}catch(e){console.error("[AnalisePro] GET",e)}
 return new Response(null,{status:204,headers:headers()});
},
OPTIONS:async()=>new Response(null,{status:204,headers:headers()}),
POST:async({request})=>{
 try{const len=Number(request.headers.get("content-length")||0);if(len>MAX_BODY_BYTES)return Response.json({ok:false,error:"payload_too_large"},{status:413,headers:headers()});const b=await request.json(),siteKey=str(b?.site_key,160),sessionId=str(b?.session_id,160),visitorId=str(b?.visitor_id,160);if(!siteKey||!sessionId||!visitorId)return Response.json({ok:false,error:"missing_identity"},{status:400,headers:headers()});const data=await collect({siteKey,sessionId,visitorId,eventName:str(b?.event_name,80)||"unknown",pageUrl:str(b?.page_url,4000),pagePath:str(b?.page_path,2000),pageTitle:str(b?.page_title,500),eventData:obj(b?.event_data),utm:obj(b?.utm),device:obj(b?.device)});return Response.json(data,{status:200,headers:headers()})}catch(e){console.error("[AnalisePro] POST",e);return Response.json({ok:false,error:"collector_failed"},{status:500,headers:headers()})}
}
}}});
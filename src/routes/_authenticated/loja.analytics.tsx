import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyticsHealthFn } from "@/lib/analytics-health.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Users, Eye, ShoppingCart, CreditCard, CheckCircle2, Ban, Clock, Printer, RefreshCw, TrendingUp, MousePointerClick, Smartphone, Monitor, Tablet, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/analytics")({ component: AnalyticsPage });

type SessionRow = any;
type EventRow = any;
const brl = (v:number) => new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(v || 0);
const pct = (a:number,b:number) => b ? `${((a/b)*100).toFixed(1)}%` : "0,0%";
const dt = (v:string) => new Date(v).toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo" });

function AnalyticsPage() {
  const [days,setDays] = useState(30);
  const [loading,setLoading] = useState(true);
  const [sessions,setSessions] = useState<SessionRow[]>([]);
  const [events,setEvents] = useState<EventRow[]>([]);
  const [search,setSearch] = useState("");
  const [health,setHealth] = useState<any>(null);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - days*86400000).toISOString();
    const [s,e,h] = await Promise.all([
      (supabase as any).from("analytics_sessions").select("*").gte("first_seen_at",since).order("first_seen_at",{ascending:false}).limit(10000),
      (supabase as any).from("analytics_events").select("*").gte("created_at",since).order("created_at",{ascending:false}).limit(30000),
      analyticsHealthFn().catch((error:any)=>({ok:false,exception:error?.message||String(error)})),
    ]);
    setSessions(s.data || []);
    setEvents(e.data || []);
    setHealth({
      ...h,
      client_sessions_error: s.error?.message || null,
      client_events_error: e.error?.message || null,
    });
    setLoading(false);
  }
  useEffect(()=>{ void load(); },[days]);

  const eventSet = useMemo(() => {
    const by = new Map<string,Set<string>>();
    events.forEach(e => { if(!by.has(e.session_id)) by.set(e.session_id,new Set()); by.get(e.session_id)!.add(e.event_name); });
    return by;
  },[events]);
  const countStep = (names:string[]) => sessions.filter(s => names.some(n => eventSet.get(s.id)?.has(n))).length;
  const visitors = new Set(sessions.map(s=>s.visitor_id)).size;
  const converted = sessions.filter(s=>s.converted).length;
  const revenue = sessions.reduce((a,s)=>a+Number(s.revenue||0),0);
  const pageViews = events.filter(e=>e.event_name==="page_view").length;
  const productViews = countStep(["product_view"]);
  const addCart = countStep(["add_to_cart","order_bump_added"]);
  const checkout = countStep(["checkout_started","checkout_created"]);
  const payment = countStep(["payment_selected","payment_redirect","payment_started"]);
  const now = Date.now();
  const abandoned = sessions.filter(s=>!s.converted && now-new Date(s.last_seen_at).getTime()>15*60000 && (eventSet.get(s.id)?.has("add_to_cart") || eventSet.get(s.id)?.has("checkout_started"))).length;

  function groupSessions(field:string) {
    const m = new Map<string,{count:number,conv:number,revenue:number}>();
    sessions.forEach(s=>{ const k=String(s[field]||"Não identificado"); const x=m.get(k)||{count:0,conv:0,revenue:0}; x.count++; if(s.converted)x.conv++; x.revenue+=Number(s.revenue||0); m.set(k,x); });
    return [...m.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,12);
  }
  function groupEvents(name:string, field:string) {
    const m = new Map<string,{count:number,value:number}>();
    events.filter(e=>e.event_name===name).forEach(e=>{ const k=String(e[field]||e.properties?.[field]||"Não identificado"); const x=m.get(k)||{count:0,value:0}; x.count+=Number(e.quantity||1); x.value+=Number(e.value||0); m.set(k,x); });
    return [...m.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,12);
  }
  const journey = sessions.filter(s => {
    const q=search.trim().toLowerCase(); if(!q)return true;
    return [s.customer_name,s.customer_phone,s.source,s.campaign,s.order_id,s.checkout_id,s.visitor_id].some(v=>String(v||"").toLowerCase().includes(q));
  }).slice(0,120);
  const funnel = [
    ["Sessões",sessions.length],["Visualizou produto",productViews],["Adicionou ao carrinho",addCart],["Chegou ao checkout",checkout],["Iniciou pagamento",payment],["Comprou",converted]
  ] as const;

  return <div className="space-y-6 p-4 md:p-6 print:p-0">
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <div><h1 className="text-2xl font-black">Analytics 360</h1><p className="text-sm text-muted-foreground">Jornada completa do cliente: origem → comportamento → compra ou abandono.</p></div>
      <div className="ml-auto flex flex-wrap gap-2">
        {[1,7,15,30,90].map(d=><Button key={d} size="sm" variant={days===d?"default":"outline"} onClick={()=>setDays(d)}>{d===1?"Hoje":`${d} dias`}</Button>)}
        <Button size="sm" variant="outline" onClick={()=>void load()}><RefreshCw className="mr-2 size-4"/>Atualizar</Button>
        <Button size="sm" onClick={()=>window.print()}><Printer className="mr-2 size-4"/>Imprimir relatório</Button>
      </div>
    </div>
    <div className="hidden print:block"><h1 className="text-2xl font-black">HotBox — Relatório Analytics 360</h1><p>Período: últimos {days} dias • Impresso em {new Date().toLocaleString("pt-BR")}</p></div>

    {!loading && health && (
      <Card className={`p-4 ${health.ok && !health.client_sessions_error && !health.client_events_error ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-black">
              {health.ok && !health.client_sessions_error && !health.client_events_error
                ? "Analytics conectado"
                : "Analytics com problema de conexão/gravação"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Banco: {Number(health.sessions_count || 0)} sessões • {Number(health.events_count || 0)} eventos
            </p>
            {(health.sessions_error || health.events_error || health.exception || health.client_sessions_error || health.client_events_error) && (
              <div className="mt-2 rounded-lg border bg-background p-2 text-xs">
                <b>Diagnóstico:</b>{" "}
                {health.sessions_error?.message ||
                  health.events_error?.message ||
                  health.exception ||
                  health.client_sessions_error ||
                  health.client_events_error}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={()=>void load()}>
            <RefreshCw className="mr-2 size-4"/>Testar conexão
          </Button>
        </div>
      </Card>
    )}

    {loading ? <Card className="p-10 text-center">Carregando dados...</Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Visitantes",visitors,Users],["Sessões",sessions.length,Eye],["Conversões",`${converted} (${pct(converted,sessions.length)})`,CheckCircle2],["Receita atribuída",brl(revenue),TrendingUp],
          ["Pageviews",pageViews,MousePointerClick],["Carrinho",addCart,ShoppingCart],["Checkout",checkout,CreditCard],["Abandonos",abandoned,Ban],
        ].map(([l,v,I]:any)=><Card key={l} className="p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-muted"><I className="size-5"/></span><div><p className="text-xs font-bold uppercase text-muted-foreground">{l}</p><p className="text-2xl font-black">{v}</p></div></div></Card>)}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5"><h2 className="font-black">Funil de conversão</h2><p className="mb-4 text-xs text-muted-foreground">Mostra exatamente onde os clientes estão desistindo.</p><div className="space-y-3">{funnel.map(([label,value],i)=>{const max=Math.max(1,sessions.length); return <div key={label}><div className="mb-1 flex justify-between text-sm"><b>{label}</b><span>{value} • {pct(value,max)}</span></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground" style={{width:`${Math.max(1,(value/max)*100)}%`}}/></div>{i>0&&<p className="mt-1 text-[11px] text-muted-foreground">Perda desde etapa anterior: {funnel[i-1][1]-value} ({pct(funnel[i-1][1]-value,Math.max(1,funnel[i-1][1]))})</p>}</div>})}</div></Card>
        <Card className="p-5"><h2 className="font-black">Origem / canal</h2><p className="mb-3 text-xs text-muted-foreground">Sessões, conversões e receita por origem.</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Origem</th><th>Sessões</th><th>Conv.</th><th>Taxa</th><th>Receita</th></tr></thead><tbody>{groupSessions("source").map(([k,x])=><tr key={k} className="border-b"><td className="py-2 font-bold">{k}</td><td>{x.count}</td><td>{x.conv}</td><td>{pct(x.conv,x.count)}</td><td>{brl(x.revenue)}</td></tr>)}</tbody></table></div></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-5"><h2 className="font-black">Páginas mais visitadas</h2><div className="mt-3 space-y-2">{groupEvents("page_view","page_path").map(([k,x],i)=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span className="max-w-[68%] truncate"><b>{i+1}. {k}</b></span><span>{x.count} views</span></div>)}</div></Card>
        <Card className="p-5"><h2 className="font-black">Cliques / ações</h2><div className="mt-3 space-y-2">{groupEvents("click","analytics_label").map(([k,x],i)=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span className="max-w-[68%] truncate"><b>{i+1}. {k}</b></span><span>{x.count} cliques</span></div>)}</div></Card>
        <Card className="p-5"><h2 className="font-black">Localização aproximada</h2><div className="mt-3 space-y-2">{groupSessions("city").map(([k,x])=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span className="font-bold">{k}</span><span>{x.count} sessões • {pct(x.conv,x.count)}</span></div>)}</div></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-5"><h2 className="font-black">Campanhas</h2><div className="mt-3 space-y-2">{groupSessions("campaign").map(([k,x])=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span className="max-w-[60%] truncate font-bold">{k}</span><span>{x.count} sessões • {pct(x.conv,x.count)}</span></div>)}</div></Card>
        <Card className="p-5"><h2 className="font-black">Dispositivos</h2><div className="mt-3 space-y-2">{groupSessions("device_type").map(([k,x])=>{const I=k==="mobile"?Smartphone:k==="tablet"?Tablet:Monitor;return <div key={k} className="flex items-center justify-between border-b pb-2 text-sm"><span className="flex items-center gap-2 font-bold"><I className="size-4"/>{k}</span><span>{x.count} • {pct(x.conv,x.count)}</span></div>})}</div></Card>
        <Card className="p-5"><h2 className="font-black">Formas de pagamento</h2><div className="mt-3 space-y-2">{groupSessions("payment_method").map(([k,x])=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span className="font-bold">{k}</span><span>{x.count} • {x.conv} compras</span></div>)}</div></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5"><h2 className="font-black">Produtos mais visualizados</h2><div className="mt-3 space-y-2">{groupEvents("product_view","product_name").map(([k,x],i)=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span><b>{i+1}. {k}</b></span><span>{x.count} visualizações</span></div>)}</div></Card>
        <Card className="p-5"><h2 className="font-black">Produtos adicionados ao carrinho</h2><div className="mt-3 space-y-2">{groupEvents("add_to_cart","product_name").map(([k,x],i)=><div key={k} className="flex justify-between border-b pb-2 text-sm"><span><b>{i+1}. {k}</b></span><span>{x.count} un.</span></div>)}</div></Card>
      </div>

      <Card className="p-5"><div className="flex flex-wrap gap-3"><div><h2 className="font-black">Jornadas individuais</h2><p className="text-xs text-muted-foreground">Cada sessão com origem, tempo, cliente, checkout, pedido e status de conversão.</p></div><div className="ml-auto flex items-center gap-2 print:hidden"><Search className="size-4"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome, telefone, pedido, campanha..." className="w-72"/></div></div><div className="mt-4 overflow-auto"><table className="w-full min-w-[1100px] text-xs"><thead><tr className="border-b text-left"><th className="py-2">Início</th><th>Cliente</th><th>Origem</th><th>Campanha</th><th>Dispositivo</th><th>Duração</th><th>Eventos</th><th>Pagamento</th><th>Pedido</th><th>Status</th></tr></thead><tbody>{journey.map(s=>{const ev=events.filter(e=>e.session_id===s.id);const duration=Math.max(0,Math.round((new Date(s.last_seen_at).getTime()-new Date(s.first_seen_at).getTime())/1000));return <tr key={s.id} className="border-b align-top"><td className="py-2">{dt(s.first_seen_at)}</td><td><b>{s.customer_name||"Anônimo"}</b><br/><span className="text-muted-foreground">{s.customer_phone||s.visitor_id?.slice(0,16)}</span></td><td><b>{s.source||"direct"}</b><br/>{s.medium||""}</td><td>{s.campaign||"—"}</td><td>{s.device_type||"—"}<br/>{s.browser||""}</td><td>{Math.floor(duration/60)}m {duration%60}s</td><td><details className="max-w-[360px]"><summary className="cursor-pointer font-bold">{ev.length} eventos</summary><div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-xl border bg-muted/30 p-2">{[...ev].reverse().map((e:any)=><div key={e.id} className="rounded-lg bg-background p-2"><div className="flex justify-between gap-2"><b>{e.event_name}</b><span className="text-[10px] text-muted-foreground">{new Date(e.created_at).toLocaleTimeString("pt-BR")}</span></div><div className="mt-1 text-[10px] text-muted-foreground">{e.page_path||""}{e.product_name?` • ${e.product_name}`:""}{e.payment_method?` • ${e.payment_method}`:""}{e.value!=null?` • ${brl(Number(e.value))}`:""}</div>{e.properties && Object.keys(e.properties).length>0 && <pre className="mt-1 whitespace-pre-wrap break-words text-[9px] text-muted-foreground">{JSON.stringify(e.properties,null,1).slice(0,900)}</pre>}</div>)}</div></details></td><td>{s.payment_method||"—"}</td><td>{s.order_id||"—"}</td><td>{s.converted?<Badge>CONVERTEU</Badge>:<Badge variant="outline">{now-new Date(s.last_seen_at).getTime()>15*60000?"ABANDONOU":"ATIVO"}</Badge>}</td></tr>})}</tbody></table></div></Card>

      <Card className="p-5 text-xs leading-relaxed text-muted-foreground"><b className="text-foreground">Privacidade e qualidade dos dados:</b> o Analytics registra comportamento e dados operacionais úteis, mas não grava senha, CVV, número completo de cartão ou conteúdo secreto de campos. IP/localização por cabeçalho dependem do proxy/CDN disponível no deploy. Sessões sem atividade por mais de 15 minutos após carrinho/checkout são classificadas como abandono no painel.</Card>
    </>}
  </div>;
}

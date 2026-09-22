import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Activity, BarChart3, Check, Clipboard, Code2, Copy, Eye, Gauge, Globe2, Link2,
  MousePointer2, Plus, RefreshCw, Sparkles, Target, Timer, Users, Zap,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type Site = { id: string; name: string; domain: string | null; site_key: string; active: boolean };
type Session = {
  id: string; visitor_id: string; first_seen_at: string; last_seen_at: string;
  entry_url: string | null; entry_path: string | null; landing_referrer: string | null;
  source: string | null; medium: string | null; campaign: string | null; term: string | null;
  content: string | null; click_id: string | null; device_type: string | null; browser: string | null;
  os: string | null; pageviews: number; max_scroll: number; engaged_seconds: number;
  converted: boolean; conversion_value: number;
};
type EventRow = {
  id: number; session_id: string; visitor_id: string; event_name: string;
  page_url: string | null; page_path: string | null; page_title: string | null;
  event_data: Record<string, any>; created_at: string;
};

const RANGE_OPTIONS = [
  { label: "Hoje", days: 1 }, { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 }, { label: "90 dias", days: 90 },
];

function fmtTime(seconds: number) {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60); const s = Math.round(seconds % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}
function pct(n: number) { return `${n.toFixed(1)}%`; }
function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function makeKey() {
  return `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
function buildUtm(url: string, fields: Record<string, string>) {
  try {
    const u = new URL(url);
    Object.entries(fields).forEach(([k, v]) => v && u.searchParams.set(k, v));
    return u.toString();
  } catch { return ""; }
}

export const Route = createFileRoute("/_authenticated/analise")({ component: AnalisePro });

function AnalisePro() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(7);
  const [pageFilter, setPageFilter] = useState("all");
  const [tab, setTab] = useState<"overview" | "campaigns" | "links" | "tracker" | "pages">("overview");
  const [newSiteOpen, setNewSiteOpen] = useState(false);
  const [utmOpen, setUtmOpen] = useState(false);
  const [trackerCopied, setTrackerCopied] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [newSite, setNewSite] = useState({ name: "", domain: "" });
  const [utm, setUtm] = useState({ name: "", destination_url: "", source: "facebook", medium: "paid_social", campaign: "", term: "", content: "" });
  const [links, setLinks] = useState<any[]>([]);

  const selectedSite = sites.find((s) => s.id === siteId) || null;
  const start = useMemo(() => new Date(Date.now() - range * 86400000).toISOString(), [range]);
  const end = useMemo(() => new Date().toISOString(), [range]);

  async function loadSites() {
    const { data, error } = await (supabase as any).from("analytics_pro_sites").select("id,name,domain,site_key,active").order("created_at", { ascending: true });
    if (error) { toast.error(`Não foi possível carregar páginas: ${error.message}`); return; }
    const rows = (data || []) as Site[];
    setSites(rows);
    if (!siteId && rows[0]) setSiteId(rows[0].id);
    if (siteId && !rows.some((s) => s.id === siteId)) setSiteId(rows[0]?.id || "");
  }

  async function loadData() {
    if (!siteId) { setSessions([]); setEvents([]); setLinks([]); setLoading(false); return; }
    setLoading(true);
    const [sessionRes, eventRes, linkRes] = await Promise.all([
      (supabase as any).from("analytics_pro_sessions").select("*").eq("site_id", siteId).gte("first_seen_at", start).lt("first_seen_at", end).order("first_seen_at", { ascending: false }).limit(20000),
      (supabase as any).from("analytics_pro_events").select("*").eq("site_id", siteId).gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(30000),
      (supabase as any).from("analytics_pro_utm_links").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(500),
    ]);
    if (sessionRes.error) toast.error(`Erro nas sessões: ${sessionRes.error.message}`);
    setSessions((sessionRes.data || []) as Session[]); setEvents((eventRes.data || []) as EventRow[]); setLinks(linkRes.data || []); setLoading(false);
  }

  async function pollLive() {
    if (!siteId) return;
    const cutoff = new Date(Date.now() - 60000).toISOString();
    const { data } = await (supabase as any).from("analytics_pro_sessions").select("visitor_id").eq("site_id", siteId).gte("last_seen_at", cutoff).limit(1000);
    setLiveCount(new Set((data || []).map((x: any) => x.visitor_id)).size);
  }

  useEffect(() => { void loadSites(); }, []);
  useEffect(() => { void loadData(); }, [siteId, start, end]);
  useEffect(() => { void pollLive(); const timer = window.setInterval(() => void pollLive(), 10000); return () => window.clearInterval(timer); }, [siteId]);

  const pages = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => { const p = s.entry_path || "/"; map.set(p, (map.get(p) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const filtered = useMemo(() => pageFilter === "all" ? sessions : sessions.filter((s) => (s.entry_path || "/") === pageFilter), [sessions, pageFilter]);
  const metrics = useMemo(() => {
    const unique = new Set(filtered.map((s) => s.visitor_id)).size;
    const views = filtered.reduce((a, s) => a + Number(s.pageviews || 0), 0);
    const engaged = filtered.filter((s) => Number(s.engaged_seconds || 0) >= 10).length;
    const conversions = filtered.filter((s) => s.converted).length;
    const value = filtered.reduce((a, s) => a + Number(s.conversion_value || 0), 0);
    const avg = filtered.length ? filtered.reduce((a, s) => a + Number(s.engaged_seconds || 0), 0) / filtered.length : 0;
    const scroll50 = filtered.length ? filtered.filter((s) => s.max_scroll >= 50).length / filtered.length * 100 : 0;
    const scroll75 = filtered.length ? filtered.filter((s) => s.max_scroll >= 75).length / filtered.length * 100 : 0;
    const scroll90 = filtered.length ? filtered.filter((s) => s.max_scroll >= 90).length / filtered.length * 100 : 0;
    return { visits: filtered.length, unique, views, engaged, conversions, value, avg, engagementRate: filtered.length ? engaged / filtered.length * 100 : 0, scroll50, scroll75, scroll90, conversionRate: filtered.length ? conversions / filtered.length * 100 : 0 };
  }, [filtered]);

  const chart = useMemo(() => {
    const days = new Map<string, { day: string; visits: number; conversions: number }>();
    filtered.forEach((s) => { const day = new Date(s.first_seen_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); const row = days.get(day) || { day, visits: 0, conversions: 0 }; row.visits++; if (s.converted) row.conversions++; days.set(day, row); });
    return [...days.values()].reverse();
  }, [filtered]);

  const campaigns = useMemo(() => {
    const map = new Map<string, { campaign: string; source: string; medium: string; visits: number; engaged: number; conversions: number; seconds: number }>();
    filtered.forEach((s) => { const key = `${s.source || "direct"}|${s.medium || "none"}|${s.campaign || "sem campanha"}`; const row = map.get(key) || { campaign: s.campaign || "sem campanha", source: s.source || "direct", medium: s.medium || "none", visits: 0, engaged: 0, conversions: 0, seconds: 0 }; row.visits++; row.engaged += s.engaged_seconds >= 10 ? 1 : 0; row.conversions += s.converted ? 1 : 0; row.seconds += Number(s.engaged_seconds || 0); map.set(key, row); });
    return [...map.values()].sort((a, b) => b.visits - a.visits);
  }, [filtered]);

  const tracker = useMemo(() => {
    if (!selectedSite) return "";
    const base = window.location.origin;
    const src = base + "/api/public/analise/tracker?site_key=" + encodeURIComponent(selectedSite.site_key);
    return '<script async src="' + src + '"></script>';
  }, [selectedSite]);

  async function createSite() {
    if (!newSite.name.trim()) return toast.error("Informe o nome da página");
    const { data: user } = await supabase.auth.getUser(); if (!user.user) return toast.error("Sessão expirada");
    const { data, error } = await (supabase as any).from("analytics_pro_sites").insert({ owner_id: user.user.id, name: newSite.name.trim(), domain: newSite.domain.trim() || null, site_key: makeKey() }).select("id,name,domain,site_key,active").single();
    if (error) return toast.error(error.message);
    setSites((old) => [...old, data as Site]); setSiteId(data.id); setNewSite({ name: "", domain: "" }); setNewSiteOpen(false); toast.success("Página criada. Agora instale o tracker.");
  }

  async function saveUtm() {
    if (!selectedSite || !utm.destination_url || !utm.campaign) return toast.error("Destino e campanha são obrigatórios");
    const generated = buildUtm(utm.destination_url, { utm_source: slugify(utm.source), utm_medium: slugify(utm.medium), utm_campaign: slugify(utm.campaign), utm_term: slugify(utm.term), utm_content: slugify(utm.content) });
    const { data, error } = await (supabase as any).from("analytics_pro_utm_links").insert({ site_id: selectedSite.id, name: utm.name || utm.campaign, destination_url: utm.destination_url, source: utm.source, medium: utm.medium, campaign: utm.campaign, term: utm.term || null, content: utm.content || null, generated_url: generated }).select("*").single();
    if (error) return toast.error(error.message);
    setLinks((old) => [data, ...old]); setUtm({ name: "", destination_url: "", source: "facebook", medium: "paid_social", campaign: "", term: "", content: "" }); setUtmOpen(false); toast.success("Link UTM criado");
  }
  async function copy(text: string) { await navigator.clipboard.writeText(text); toast.success("Copiado"); }

  const navTabs = [
    { id: "overview", label: "Visão geral", icon: BarChart3 }, { id: "campaigns", label: "Campanhas", icon: Target },
    { id: "pages", label: "Páginas", icon: Globe2 }, { id: "links", label: "Links UTM", icon: Link2 }, { id: "tracker", label: "Tracker", icon: Code2 },
  ] as const;

  return (
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07111f]/95 backdrop-blur-xl"><div className="flex min-h-16 items-center gap-4 px-5 lg:px-7">
        <div className="mr-auto flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20"><Sparkles className="size-5 text-white" /></div><div><div className="text-lg font-black tracking-tight">Análise <span className="text-cyan-400">Pro</span></div><div className="text-[10px] uppercase tracking-[.22em] text-slate-500">Performance intelligence</div></div></div>
        <div className="hidden items-center gap-2 md:flex"><Activity className="size-4 text-emerald-400" /><span className="text-xs text-slate-400">{liveCount} online agora</span></div>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-10 max-w-56 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none">{sites.length ? sites.map((s) => <option key={s.id} value={s.id} className="bg-[#0b1728]">{s.name}</option>) : <option value="">Nenhuma página</option>}</select>
        <button onClick={() => setNewSiteOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-slate-900"><Plus className="size-4" /> Página</button>
        <button onClick={() => void loadData()} className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10" title="Atualizar"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div></header>

      <div className="flex min-h-[calc(100vh-64px)]"><aside className="hidden w-56 shrink-0 border-r border-white/10 p-4 lg:block"><div className="space-y-1">
        {navTabs.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${tab === item.id ? "bg-cyan-400/10 text-cyan-300" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon className="size-4" />{item.label}</button>; })}
      </div><div className="mt-8 rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4"><div className="flex items-center gap-2 text-xs font-bold text-cyan-300"><Zap className="size-4" /> Em tempo real</div><p className="mt-2 text-xs leading-5 text-slate-500">Eventos chegam do tracker instalado nas suas páginas de venda.</p></div></aside>

      <main className="min-w-0 flex-1 p-4 lg:p-7"><div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-400">Centro de comando</p><h1 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">{selectedSite?.name || "Crie sua primeira página"}</h1><p className="mt-1 text-sm text-slate-500">{selectedSite?.domain || "Monitore comportamento, aquisição e conversão em um só lugar."}</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-xl border border-white/10 bg-white/5 p-1">{RANGE_OPTIONS.map((o) => <button key={o.days} onClick={() => setRange(o.days)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${range === o.days ? "bg-white text-slate-900" : "text-slate-400"}`}>{o.label}</button>)}</div><select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300"><option value="all">Todas as páginas</option>{pages.map(([p]) => <option key={p} value={p}>{p}</option>)}</select></div></div>

        {tab === "overview" && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi icon={Users} label="Visitas" value={metrics.visits.toLocaleString("pt-BR")} sub={`${metrics.unique.toLocaleString("pt-BR")} visitantes únicos`} /><Kpi icon={Eye} label="Pageviews" value={metrics.views.toLocaleString("pt-BR")} sub={`${(metrics.views / Math.max(1, metrics.visits)).toFixed(1)} por visita`} /><Kpi icon={Timer} label="Tempo engajado" value={fmtTime(metrics.avg)} sub={`${pct(metrics.engagementRate)} com 10s+`} /><Kpi icon={Gauge} label="Scroll 75%" value={pct(metrics.scroll75)} sub={`50% ${pct(metrics.scroll50)} • 90% ${pct(metrics.scroll90)}`} /></div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_.8fr]"><Panel title="Tráfego e conversões" icon={Activity}><div className="h-[310px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><defs><linearGradient id="apVisits" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35}/><stop offset="100%" stopColor="#22d3ee" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#ffffff12" vertical={false}/><XAxis dataKey="day" stroke="#64748b" tickLine={false} axisLine={false}/><YAxis stroke="#64748b" tickLine={false} axisLine={false}/><Tooltip contentStyle={{background:"#0b1728",border:"1px solid #ffffff18",borderRadius:12,color:"#fff"}}/><Area type="monotone" dataKey="visits" stroke="#22d3ee" fill="url(#apVisits)" strokeWidth={2.5}/><Area type="monotone" dataKey="conversions" stroke="#34d399" fill="none" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></Panel><Panel title="Conversão" icon={Target}><div className="flex items-end justify-between"><div><div className="text-4xl font-black">{pct(metrics.conversionRate)}</div><div className="mt-1 text-xs text-slate-500">{metrics.conversions} conversões</div></div><div className="text-right"><div className="text-lg font-bold text-emerald-400">R$ {metrics.value.toFixed(2).replace(".", ",")}</div><div className="text-xs text-slate-500">valor atribuído</div></div></div><div className="mt-8 space-y-4"><Progress label="25% da página" value={filtered.length ? filtered.filter(s => s.max_scroll >= 25).length / filtered.length * 100 : 0}/><Progress label="50% da página" value={metrics.scroll50}/><Progress label="75% da página" value={metrics.scroll75}/><Progress label="90% da página" value={metrics.scroll90}/></div></Panel></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2"><Panel title="Origem do tráfego" icon={MousePointer2}><SimpleTable headers={["Origem", "Visitas", "Conversão"]} rows={campaigns.slice(0,8).map((c) => [`${c.source}/${c.medium}`, c.visits, `${c.visits ? (c.conversions/c.visits*100).toFixed(1) : "0.0"}%`])} /></Panel><Panel title="Páginas de entrada" icon={Globe2}><SimpleTable headers={["Página", "Visitas", "Scroll 75%"]} rows={pages.slice(0,8).map(([p,count]) => { const rows=sessions.filter(s=>(s.entry_path||"/")===p); const s75=rows.length?rows.filter(s=>s.max_scroll>=75).length/rows.length*100:0; return [p,count,`${s75.toFixed(1)}%`]; })} /></Panel></div></>}
        {tab === "campaigns" && <Campaigns campaigns={campaigns} />}
        {tab === "pages" && <PagesReport sessions={sessions} events={events} />}
        {tab === "links" && <LinksPanel links={links} onNew={() => setUtmOpen(true)} onCopy={copy} />}
        {tab === "tracker" && <TrackerPanel tracker={tracker} copied={trackerCopied} onCopy={async()=>{await copy(tracker);setTrackerCopied(true);setTimeout(()=>setTrackerCopied(false),1800)}} />}

        {utmOpen && <Modal title="Gerar link UTM" onClose={() => setUtmOpen(false)}><div className="grid gap-3 md:grid-cols-2">{Object.entries(utm).map(([key,value]) => <label key={key} className="text-xs font-bold capitalize text-slate-400">{key === "destination_url" ? "URL de destino" : key === "name" ? "Nome do link" : key.replace("utm_","UTM ").replace("_"," ")}<input value={value} onChange={(e)=>setUtm({...utm,[key]:e.target.value})} placeholder={key==="destination_url"?"https://seusite.com/pagina":key==="campaign"?"campanha_maio":""} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-cyan-400/50"/></label>)}</div><div className="mt-4 rounded-xl border border-cyan-400/10 bg-cyan-400/5 p-3 text-xs text-slate-400 break-all">{buildUtm(utm.destination_url,{utm_source:slugify(utm.source),utm_medium:slugify(utm.medium),utm_campaign:slugify(utm.campaign),utm_term:slugify(utm.term),utm_content:slugify(utm.content)}) || "A URL aparecerá aqui."}</div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setUtmOpen(false)} className="rounded-xl px-4 py-2 text-sm text-slate-400">Cancelar</button><button onClick={()=>void saveUtm()} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950">Gerar e salvar</button></div></Modal>}
        {newSiteOpen && <Modal title="Nova página de vendas" onClose={()=>setNewSiteOpen(false)}><div className="space-y-3"><label className="text-xs font-bold text-slate-400">Nome<input value={newSite.name} onChange={e=>setNewSite({...newSite,name:e.target.value})} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white"/></label><label className="text-xs font-bold text-slate-400">Domínio / URL<input value={newSite.domain} onChange={e=>setNewSite({...newSite,domain:e.target.value})} placeholder="https://..." className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white"/></label><button onClick={()=>void createSite()} className="mt-3 w-full rounded-xl bg-cyan-400 py-3 text-sm font-black text-slate-950">Criar página</button></div></Modal>}
      </div></main></div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: any) { return <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><Icon className="size-4 text-cyan-400"/>{label}</div><div className="mt-3 text-3xl font-black tracking-tight">{value}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></div>; }
function Panel({ title, icon: Icon, children }: any) { return <section className="rounded-2xl border border-white/10 bg-white/[.035] p-5"><div className="mb-4 flex items-center gap-2"><Icon className="size-4 text-cyan-400"/><h2 className="text-sm font-black">{title}</h2></div>{children}</section>; }
function Progress({ label, value }: {label:string;value:number}) { return <div><div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">{label}</span><span className="font-bold text-slate-300">{value.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{width:`${Math.min(100,value)}%`}}/></div></div>; }
function SimpleTable({ headers, rows }: {headers:string[];rows:any[][]}) { return <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-white/10">{headers.map(h=><th key={h} className="px-2 py-3 font-bold uppercase tracking-wider text-slate-600">{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i} className="border-b border-white/5 last:border-0"><td className="max-w-[300px] truncate px-2 py-3 font-semibold text-slate-300">{r[0]}</td>{r.slice(1).map((x,j)=><td key={j} className="px-2 py-3 text-slate-400">{x}</td>)}</tr>):<tr><td colSpan={headers.length} className="py-8 text-center text-slate-600">Sem dados no período.</td></tr>}</tbody></table></div>; }
function Campaigns({ campaigns }: { campaigns:any[] }) { return <Panel title="Campanhas e UTMs" icon={Target}><div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="border-b border-white/10">{["Campanha","Origem","Visitas","Engajadas","Conversões","Taxa","Tempo médio"].map(h=><th key={h} className="px-3 py-3 font-bold uppercase tracking-wider text-slate-600">{h}</th>)}</tr></thead><tbody>{campaigns.map((c,i)=><tr key={i} className="border-b border-white/5"><td className="px-3 py-3 font-bold text-white">{c.campaign}</td><td className="px-3 py-3 text-slate-400">{c.source}/{c.medium}</td><td className="px-3 py-3">{c.visits}</td><td className="px-3 py-3">{c.engaged}</td><td className="px-3 py-3 text-emerald-400">{c.conversions}</td><td className="px-3 py-3">{c.visits?(c.conversions/c.visits*100).toFixed(1):"0.0"}%</td><td className="px-3 py-3">{fmtTime(c.visits?c.seconds/c.visits:0)}</td></tr>)}{!campaigns.length&&<tr><td colSpan={7} className="py-12 text-center text-slate-600">Nenhuma campanha rastreada ainda.</td></tr>}</tbody></table></div></Panel>; }
function PagesReport({ sessions, events }: {sessions:Session[];events:EventRow[]}) { const rows=Object.entries(sessions.reduce((m,s)=>{const p=s.entry_path||"/";m[p]??={v:0,u:new Set(),s:0,c:0};m[p].v++;m[p].u.add(s.visitor_id);m[p].s+=s.max_scroll;m[p].c+=s.converted?1:0;return m;},{} as Record<string,{v:number;u:Set<string>;s:number;c:number}>)).sort((a,b)=>b[1].v-a[1].v); return <div className="space-y-4"><Panel title="Desempenho por página" icon={Globe2}><SimpleTable headers={["Página","Visitas","Únicos","Scroll médio","Conversões"]} rows={rows.map(([p,x])=>[p,x.v,x.u.size,`${(x.s/x.v).toFixed(0)}%`,x.c])}/></Panel><Panel title="Eventos recentes" icon={Activity}><SimpleTable headers={["Evento","Página","Quando"]} rows={events.slice(0,25).map(e=>[e.event_name,e.page_path||"/",new Date(e.created_at).toLocaleString("pt-BR")])}/></Panel></div>; }
function LinksPanel({ links, onNew, onCopy }: any) { return <Panel title="Construtor de links UTM" icon={Link2}><div className="mb-4 flex justify-end"><button onClick={onNew} className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950"><Plus className="size-4"/> Novo link</button></div><div className="space-y-2">{links.length?links.map((l:any)=><div key={l.id} className="rounded-xl border border-white/10 bg-black/10 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-bold">{l.name}</div><div className="mt-1 break-all text-xs text-slate-500">{l.generated_url}</div></div><button onClick={()=>onCopy(l.generated_url)} className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5"><Copy className="size-4"/></button></div></div>):<div className="py-12 text-center text-slate-600">Crie o primeiro link UTM para começar.</div>}</div></Panel>; }
function TrackerPanel({ tracker, copied, onCopy }: any) { return <div className="space-y-4"><Panel title="Tracker da página" icon={Code2}><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Check className="size-4 text-emerald-400"/> Pageview <Check className="size-4 text-emerald-400"/> Scroll 25/50/75/90/100 <Check className="size-4 text-emerald-400"/> Cliques <Check className="size-4 text-emerald-400"/> Tempo engajado <Check className="size-4 text-emerald-400"/> UTM/fbclid/gclid <Check className="size-4 text-emerald-400"/> Conversões</div><div className="relative mt-4"><pre className="max-h-[480px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-[11px] leading-5 text-slate-400">{tracker || "Crie uma página para gerar o tracker."}</pre><button onClick={onCopy} disabled={!tracker} className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950">{copied?<Check className="size-4"/>:<Clipboard className="size-4"/>}{copied?"Copiado":"Copiar tracker"}</button></div><p className="mt-3 text-xs leading-5 text-slate-500">Cole este código na página de vendas, de preferência antes de &lt;/head&gt;. O tracker é carregado do Análise Pro e funciona mesmo em domínio externo. Para registrar uma conversão, use <code className="text-cyan-300">AnalisePro.track("purchase", &#123;value: 97&#125;)</code> após a confirmação.</p></Panel></div>; }
function Modal({ title, onClose, children }: any) { return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0b1728] p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-black">{title}</h3><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5">×</button></div>{children}</div></div>; }

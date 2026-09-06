import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity, BarChart3, ChevronRight, Clock3, Download, Eye, Filter, Gauge, Globe2,
  MousePointerClick, RefreshCw, ShoppingCart, Smartphone, Target, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAnalyticsDashboardFn, getAnalyticsSessionJourneyFn } from "@/lib/analytics.functions";

export const Route = createFileRoute("/_authenticated/loja/analytics")({ component: AnalyticsPage });

type Dashboard = any;
const brl = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: unknown) => Number(v || 0).toLocaleString("pt-BR");
const dt = (v: string | null | undefined) => v ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const daysAgo = (d: number) => {
  const x = new Date(Date.now() - d * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(x);
};

function Kpi({ icon: Icon, label, value, helper }: any) {
  return <Card className="border-0 p-5 shadow-sm ring-1 ring-black/5">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-[11px] font-black uppercase tracking-[.15em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{helper}</p></div>
      <div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-5" /></div>
    </div>
  </Card>;
}

function Section({ title, subtitle, children }: any) {
  return <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-black/5">
    <div className="border-b px-5 py-4"><h2 className="font-black">{title}</h2>{subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}</div>
    <div className="p-5">{children}</div>
  </Card>;
}

function AnalyticsPage() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [surface, setSurface] = useState("all");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [journey, setJourney] = useState<any>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r: any = await getAnalyticsDashboardFn({ data: { from, to, surface, maxEvents: 7000 } });
      if (!r?.ok) throw new Error(r?.error || "Falha ao carregar analytics.");
      setData(r);
    } catch (e: any) { toast.error(String(e?.message || "Falha ao carregar analytics.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, surface]);

  async function openJourney(sessionId: string) {
    setJourneyLoading(true); setJourney({ session: { session_id: sessionId }, events: [] });
    try {
      const r: any = await getAnalyticsSessionJourneyFn({ data: { sessionId } });
      if (!r?.ok) throw new Error(r?.error || "Falha ao abrir jornada.");
      setJourney(r);
    } catch (e: any) { toast.error(String(e?.message || "Falha ao abrir jornada.")); setJourney(null); }
    finally { setJourneyLoading(false); }
  }

  const summary = data?.summary || {};
  const topDrop = useMemo(() => {
    const f = data?.funnel || [];
    let best: any = null;
    for (let i = 1; i < f.length; i++) {
      const prev = Number(f[i - 1].count || 0); const curr = Number(f[i].count || 0);
      if (!prev) continue; const loss = ((prev - curr) / prev) * 100;
      if (!best || loss > best.loss) best = { from: f[i - 1].name, to: f[i].name, loss };
    }
    return best;
  }, [data]);

  async function downloadPdf() {
    if (!data) return;
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const left = 14; const right = 196; let y = 15;
      const page = () => { if (y > 278) { doc.addPage(); y = 15; } };
      const line = (text: string, size = 9, bold = false, gap = 5) => {
        page(); doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
        const parts = doc.splitTextToSize(text, right - left); doc.text(parts, left, y); y += parts.length * (size * 0.42) + gap;
      };
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("HotBox - Analytics de Comportamento", left, y); y += 8;
      line(`Período: ${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")} | Área: ${surface === "all" ? "Bio + Cardápio" : surface}`, 9, false, 3);
      line(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 8, false, 7);
      line("Resumo executivo", 13, true, 4);
      line(`Sessões: ${num(summary.sessions)} | Visitantes: ${num(summary.visitors)} | Visualizações: ${num(summary.pageviews)} | Conversões: ${num(summary.conversions)} (${summary.conversionRate || 0}%) | Receita atribuída: ${brl(summary.revenue)} | Ticket médio: ${brl(summary.averageOrderValue)} | Abandono: ${summary.abandonmentRate || 0}% | Engajamento médio: ${summary.averageEngagementSeconds || 0}s`, 9, false, 7);
      if (topDrop) line(`Maior gargalo observado: ${topDrop.from} -> ${topDrop.to}, perda aproximada de ${topDrop.loss.toFixed(1)}% das sessões que chegaram à etapa anterior.`, 9, true, 7);
      line("Funil de conversão", 13, true, 4);
      for (const r of data.funnel || []) line(`${r.name}: ${num(r.count)} sessões`, 9, false, 2);
      y += 3; line("Origem do tráfego", 13, true, 4);
      for (const r of (data.sources || []).slice(0, 15)) line(`${r.source}${r.medium ? ` / ${r.medium}` : ""}: ${r.sessions} sessões | ${r.conversions} vendas | ${r.conversionRate}% conv. | ${brl(r.revenue)}`, 8.5, false, 2);
      y += 3; line("Campanhas UTM", 13, true, 4);
      if (!(data.campaigns || []).length) line("Nenhuma campanha UTM identificada no período.", 8.5, false, 2);
      for (const r of (data.campaigns || []).slice(0, 15)) line(`${r.campaign}: ${r.sessions} sessões | ${r.conversions} vendas | ${r.conversionRate}% conv. | ${brl(r.revenue)}`, 8.5, false, 2);
      y += 3; line("Páginas e navegação", 13, true, 4);
      for (const r of (data.pages || []).slice(0, 20)) line(`${r.path}: ${r.views} visualizações | ${r.sessions} sessões`, 8.5, false, 2);
      y += 3; line("Principais pontos de abandono", 13, true, 4);
      for (const r of (data.abandonments || []).slice(0, 15)) line(`${r.name}: ${r.count} abandonos`, 8.5, false, 2);
      y += 3; line("Dispositivos", 13, true, 4);
      line(`Dispositivos: ${(data.devices || []).map((r: any) => `${r.name} ${r.count}`).join(" | ") || "—"}`, 8.5, false, 3);
      line(`Navegadores: ${(data.browsers || []).slice(0, 8).map((r: any) => `${r.name} ${r.count}`).join(" | ") || "—"}`, 8.5, false, 3);
      line(`Sistemas: ${(data.oses || []).slice(0, 8).map((r: any) => `${r.name} ${r.count}`).join(" | ") || "—"}`, 8.5, false, 7);
      line("Últimas jornadas", 13, true, 4);
      for (const s of (data.sessions || []).slice(0, 35)) line(`${dt(s.started_at)} | ${s.source || "Direto"} | ${s.device_type || "?"}/${s.browser || "?"} | ${s.pageviews || 0} pág. | ${s.converted_at ? `VENDA ${brl(s.revenue)}` : "sem compra"} | saída ${s.last_path || "—"}`, 8, false, 2);
      doc.save(`hotbox-analytics-${from}-a-${to}.pdf`);
    } catch (e: any) { toast.error(`Não foi possível gerar o PDF: ${String(e?.message || e)}`); }
  }

  return <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 lg:px-8">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><BarChart3 className="size-6" /></div><div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Analytics de Comportamento</h1><p className="mt-1 text-sm text-muted-foreground">Jornada completa da Bio ao pedido, origem, gargalos, abandono e conversão.</p></div></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button><Button onClick={downloadPdf} disabled={!data}><Download className="mr-2 size-4" />Baixar relatório em PDF</Button></div>
    </div>

    <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
      <div><Label>De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div><Label>Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <div><Label>Origem da jornada</Label><Select value={surface} onValueChange={setSurface}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Bio + Cardápio</SelectItem><SelectItem value="bio">Somente Bio</SelectItem><SelectItem value="menu">Somente Cardápio</SelectItem><SelectItem value="thankyou">Somente Pós-compra</SelectItem></SelectContent></Select></div>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => { setFrom(today()); setTo(today()); }}>Hoje</Button><Button variant="secondary" onClick={() => { setFrom(daysAgo(6)); setTo(today()); }}>7 dias</Button><Button variant="secondary" onClick={() => { setFrom(daysAgo(29)); setTo(today()); }}>30 dias</Button></div>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={Users} label="Sessões" value={num(summary.sessions)} helper={`${num(summary.visitors)} visitantes únicos`} />
      <Kpi icon={Target} label="Conversão" value={`${summary.conversionRate || 0}%`} helper={`${num(summary.conversions)} vendas atribuídas`} />
      <Kpi icon={TrendingUp} label="Receita atribuída" value={brl(summary.revenue)} helper={`Ticket médio ${brl(summary.averageOrderValue)}`} />
      <Kpi icon={TrendingDown} label="Abandono" value={`${summary.abandonmentRate || 0}%`} helper={`${num(summary.abandoned)} sessões sem compra`} />
      <Kpi icon={Eye} label="Visualizações" value={num(summary.pageviews)} helper={`${num(summary.events)} eventos capturados`} />
      <Kpi icon={Clock3} label="Engajamento médio" value={`${num(summary.averageEngagementSeconds)}s`} helper="Tempo ativo aproximado por sessão" />
      <Kpi icon={MousePointerClick} label="Maior gargalo" value={topDrop ? `${topDrop.loss.toFixed(1)}%` : "—"} helper={topDrop ? `${topDrop.from} → ${topDrop.to}` : "Sem volume suficiente"} />
      <Kpi icon={Gauge} label="Cobertura" value={data?.truncated ? "Parcial" : "Completa"} helper={data?.truncated ? "Aumente o período em blocos para auditoria total" : "Todos os eventos do período consultado"} />
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Section title="Funil completo" subtitle="Quantas sessões chegaram a cada etapa. A queda entre etapas revela o gargalo.">
        <div className="h-[330px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data?.funnel || []} layout="vertical" margin={{ left: 25, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" width={150} dataKey="name" tick={{ fontSize: 11 }} /><Tooltip formatter={(v: any) => [num(v), "Sessões"]} /><Bar dataKey="count" radius={[0, 8, 8, 0]} /></BarChart></ResponsiveContainer></div>
      </Section>
      <Section title="Sessões e vendas ao longo do tempo" subtitle="Permite separar mudança real de comportamento de um pico isolado de tráfego.">
        <div className="h-[330px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data?.days || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="sessions" name="Sessões" fillOpacity={.2} /><Area type="monotone" dataKey="conversions" name="Vendas" fillOpacity={.15} /></AreaChart></ResponsiveContainer></div>
      </Section>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Section title="Origem do acesso" subtitle="UTM quando existir; caso contrário, referência do navegador (Meta, Google, direto ou outro site).">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Origem</th><th className="pb-2 text-right">Sessões</th><th className="pb-2 text-right">Vendas</th><th className="pb-2 text-right">Conv.</th><th className="pb-2 text-right">Receita</th></tr></thead><tbody>{(data?.sources || []).slice(0, 25).map((r: any) => <tr key={`${r.source}-${r.medium}`} className="border-b last:border-0"><td className="py-2 font-semibold">{r.source}<span className="block text-[11px] font-normal text-muted-foreground">{r.medium || "—"}</span></td><td className="py-2 text-right">{r.sessions}</td><td className="py-2 text-right">{r.conversions}</td><td className="py-2 text-right">{r.conversionRate}%</td><td className="py-2 text-right font-bold">{brl(r.revenue)}</td></tr>)}</tbody></table></div>
      </Section>
      <Section title="Campanhas UTM" subtitle="Ideal para comparar Meta Ads, stories, influenciadores, QR codes e campanhas específicas.">
        {(data?.campaigns || []).length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Campanha</th><th className="pb-2 text-right">Sessões</th><th className="pb-2 text-right">Vendas</th><th className="pb-2 text-right">Conv.</th><th className="pb-2 text-right">Receita</th></tr></thead><tbody>{data.campaigns.slice(0, 25).map((r: any) => <tr key={r.campaign} className="border-b last:border-0"><td className="py-2 font-semibold">{r.campaign}</td><td className="py-2 text-right">{r.sessions}</td><td className="py-2 text-right">{r.conversions}</td><td className="py-2 text-right">{r.conversionRate}%</td><td className="py-2 text-right font-bold">{brl(r.revenue)}</td></tr>)}</tbody></table></div> : <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Ainda não há campanha com <b>utm_campaign</b> identificada neste período.</div>}
      </Section>
    </div>

    <div className="grid gap-6 xl:grid-cols-3">
      <Section title="Páginas mais vistas" subtitle="Onde o cliente realmente passou."><div className="space-y-2">{(data?.pages || []).slice(0, 15).map((r: any) => <div key={r.path} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-bold">{r.path}</p><p className="text-[11px] text-muted-foreground">{r.sessions} sessões</p></div><span className="font-black">{r.views}</span></div>)}</div></Section>
      <Section title="Pontos de abandono" subtitle="Última ação observada em sessões sem compra há mais de 30 minutos."><div className="space-y-2">{(data?.abandonments || []).slice(0, 15).map((r: any) => <div key={r.name} className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2"><p className="text-xs font-semibold leading-snug">{r.name}</p><span className="rounded-lg bg-background px-2 py-1 text-xs font-black">{r.count}</span></div>)}</div></Section>
      <Section title="Tecnologia do cliente" subtitle="Ajuda a detectar problemas concentrados em celular, navegador ou sistema."><div className="space-y-5"><div><p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">Dispositivos</p>{(data?.devices || []).map((r: any) => <div key={r.name} className="mb-1 flex justify-between text-sm"><span>{r.name}</span><b>{r.count}</b></div>)}</div><div><p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">Navegadores</p>{(data?.browsers || []).slice(0, 8).map((r: any) => <div key={r.name} className="mb-1 flex justify-between text-sm"><span>{r.name}</span><b>{r.count}</b></div>)}</div><div><p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">Sistemas</p>{(data?.oses || []).slice(0, 8).map((r: any) => <div key={r.name} className="mb-1 flex justify-between text-sm"><span>{r.name}</span><b>{r.count}</b></div>)}</div></div></Section>
    </div>

    <Section title="Jornadas individuais" subtitle="Abra uma sessão para ver, em ordem cronológica, cada passo registrado até compra ou abandono. Não gravamos senha, dados de cartão nem o conteúdo digitado nos campos.">
      <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="pb-2">Início</th><th className="pb-2">Origem</th><th className="pb-2">Dispositivo</th><th className="pb-2">Landing</th><th className="pb-2">Última página</th><th className="pb-2 text-right">Pág.</th><th className="pb-2 text-right">Tempo</th><th className="pb-2">Resultado</th><th /></tr></thead><tbody>{(data?.sessions || []).map((s: any) => <tr key={s.session_id} className="border-b last:border-0"><td className="py-2">{dt(s.started_at)}</td><td className="py-2"><b>{s.source || "Direto"}</b><span className="block text-[11px] text-muted-foreground">{s.campaign || s.medium || "—"}</span></td><td className="py-2">{s.device_type || "—"}<span className="block text-[11px] text-muted-foreground">{s.browser || "—"} · {s.os || "—"}</span></td><td className="max-w-[180px] truncate py-2">{s.landing_path || "—"}</td><td className="max-w-[180px] truncate py-2">{s.last_path || "—"}</td><td className="py-2 text-right">{s.pageviews || 0}</td><td className="py-2 text-right">{s.engagement_seconds || 0}s</td><td className="py-2">{s.converted_at ? <span className="font-black text-emerald-700">VENDA {brl(s.revenue)}</span> : <span className="text-muted-foreground">Sem compra</span>}</td><td className="py-2 text-right"><Button size="sm" variant="ghost" onClick={() => openJourney(s.session_id)}>Ver jornada <ChevronRight className="ml-1 size-4" /></Button></td></tr>)}</tbody></table></div>
    </Section>

    <Section title="Eventos mais frequentes" subtitle="Leitura bruta do comportamento capturado no período."><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(data?.eventTypes || []).slice(0, 24).map((r: any) => <div key={r.name} className="rounded-xl bg-muted/40 p-3"><p className="text-xs font-bold">{r.name}</p><p className="mt-1 text-xl font-black">{num(r.count)}</p></div>)}</div></Section>

    <Dialog open={!!journey} onOpenChange={(open) => !open && setJourney(null)}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Jornada detalhada da sessão</DialogTitle></DialogHeader>{journeyLoading ? <div className="grid min-h-44 place-items-center"><RefreshCw className="size-6 animate-spin" /></div> : journey?.session && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] text-muted-foreground">Origem</p><p className="font-black">{journey.session.source || "Direto"}</p><p className="text-xs">{journey.session.medium || "—"} {journey.session.campaign ? `· ${journey.session.campaign}` : ""}</p></div><div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] text-muted-foreground">Dispositivo</p><p className="font-black">{journey.session.device_type || "—"}</p><p className="text-xs">{journey.session.browser || "—"} · {journey.session.os || "—"}</p></div><div className="rounded-xl bg-muted/40 p-3"><p className="text-[11px] text-muted-foreground">Resultado</p><p className={`font-black ${journey.session.converted_at ? "text-emerald-700" : ""}`}>{journey.session.converted_at ? `VENDA ${brl(journey.session.revenue)}` : "Sem compra"}</p><p className="text-xs">{journey.session.engagement_seconds || 0}s ativos</p></div></div><div className="relative space-y-0 border-l-2 pl-5">{(journey.events || []).map((e: any) => <div key={e.id} className="relative border-b py-3 last:border-0"><span className="absolute -left-[25px] top-4 size-2.5 rounded-full bg-primary" /><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">{e.event_name}</p><p className="text-xs text-muted-foreground">{e.page_path || "—"}{e.event_label ? ` · ${e.event_label}` : ""}</p>{e.product_name && <p className="mt-1 text-xs font-semibold">Produto: {e.product_name}</p>}</div><span className="text-[11px] text-muted-foreground">{dt(e.occurred_at)}</span></div>{e.metadata && Object.keys(e.metadata).length > 0 && <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-muted/60 p-2 text-[10px]">{JSON.stringify(e.metadata, null, 2)}</pre>}</div>)}</div></div>}</DialogContent></Dialog>
  </div>;
}

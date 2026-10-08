import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getSalesRecoveryAdminData,
  saveSalesRecoverySettings,
  sendSalesRecoveryNow,
  type SalesRecoverySettings,
} from "@/lib/sales-recovery.functions";
import { formatPhone, formatDateTime } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  History,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShoppingCart,
  Sparkles,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/reengajamento")({
  component: SalesRecoveryPage,
});

const DEFAULT_SETTINGS: SalesRecoverySettings = {
  enabled: false,
  mode: "manual",
  abandoned_checkout_enabled: true,
  rejected_payment_enabled: true,
  abandoned_delay_minutes: 20,
  rejected_delay_minutes: 5,
  cooldown_hours: 24,
  max_messages_per_phone_24h: 1,
  abandoned_message:
    "Olá! 👋 Aqui é da HotBox Delivery. Vi que você iniciou um pedido no nosso cardápio e não conseguiu finalizar. Posso te ajudar a concluir seu pedido? 😊",
  rejected_message:
    "Olá! 👋 Aqui é da HotBox Delivery. Seu pagamento não foi aprovado no cardápio. Se quiser, posso te ajudar a finalizar por outra forma de pagamento 😊",
};

type Opportunity = any;
type RecoveryLog = any;

function recoveryTypeLabel(value: string) {
  return value === "rejected_payment" ? "Cartão não aprovado" : "Abandono de checkout";
}

function recoverySourceLabel(value: unknown) {
  const source = String(value || "").toLowerCase();
  if (source === "instagram") return "Instagram";
  if (source === "facebook") return "Facebook";
  if (["meta", "meta_ads"].includes(source)) return "Meta Ads";
  if (source === "google") return "Google";
  if (source === "whatsapp") return "WhatsApp";
  if (!source || source === "direct") return "Acesso direto";
  return String(value || "Origem não identificada");
}

export default function SalesRecoveryPage() {
  const [tab, setTab] = useState<"opportunities" | "automation" | "history">("opportunities");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState("");
  const [settings, setSettings] = useState<SalesRecoverySettings>(DEFAULT_SETTINGS);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [logs, setLogs] = useState<RecoveryLog[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [historyModeFilter, setHistoryModeFilter] = useState("all");

  async function resolveToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  async function load() {
    setLoading(true);
    try {
      const token = accessToken || (await resolveToken());
      if (!accessToken) setAccessToken(token);
      const result: any = await getSalesRecoveryAdminData({ data: { accessToken: token, days: 30 } });
      if (!result?.ok) throw new Error(result?.error || "Não foi possível carregar a recuperação de vendas.");
      setSettings({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
      setOpportunities(result.opportunities || []);
      setLogs(result.logs || []);
    } catch (error: any) {
      toast.error(error?.message || "Erro ao carregar recuperação de vendas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSettings() {
    setSaving(true);
    try {
      const token = accessToken || (await resolveToken());
      const result: any = await saveSalesRecoverySettings({ data: { accessToken: token, settings } });
      if (!result?.ok) throw new Error(result?.error || "Não foi possível salvar.");
      toast.success(settings.mode === "automatic" && settings.enabled ? "Recuperação automática ativada" : "Configurações salvas");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow(row: Opportunity) {
    setSendingId(String(row.session_id));
    try {
      const token = accessToken || (await resolveToken());
      const message = row.recovery_type === "rejected_payment" ? settings.rejected_message : settings.abandoned_message;
      const result: any = await sendSalesRecoveryNow({
        data: {
          accessToken: token,
          sessionId: String(row.session_id),
          recoveryType: row.recovery_type,
          message,
        },
      });
      if (!result?.ok) throw new Error(result?.error || "Não foi possível enviar.");
      toast.success("Mensagem de recuperação enviada pelo WhatsApp");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao enviar recuperação.");
    } finally {
      setSendingId("");
    }
  }

  const sourceOptions = useMemo(
    () => Array.from(new Set(opportunities.map((row) => recoverySourceLabel(row.source)))).sort(),
    [opportunities],
  );
  const campaignOptions = useMemo(
    () => Array.from(new Set(opportunities.map((row) => String(row.campaign || "").trim()).filter(Boolean))).sort(),
    [opportunities],
  );

  const filteredOpportunities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((row) => {
      const matchesSearch = !q || [row.customer_name, row.customer_phone, row.campaign, row.checkout_id]
        .some((value) => String(value || "").toLowerCase().includes(q));
      const matchesType = typeFilter === "all" || row.recovery_type === typeFilter;
      const matchesSource = sourceFilter === "all" || recoverySourceLabel(row.source) === sourceFilter;
      const matchesCampaign = campaignFilter === "all" || String(row.campaign || "") === campaignFilter;
      return matchesSearch && matchesType && matchesSource && matchesCampaign;
    });
  }, [opportunities, search, typeFilter, sourceFilter, campaignFilter]);

  const filteredLogs = useMemo(() => logs.filter((row) => {
    const matchesStatus = historyStatusFilter === "all" || row.status === historyStatusFilter;
    const matchesMode = historyModeFilter === "all" || row.mode === historyModeFilter;
    return matchesStatus && matchesMode;
  }), [logs, historyStatusFilter, historyModeFilter]);

  const pending = opportunities.filter((row) => !row.already_handled).length;
  const abandoned = opportunities.filter((row) => row.recovery_type === "abandoned_checkout" && !row.already_handled).length;
  const rejected = opportunities.filter((row) => row.recovery_type === "rejected_payment" && !row.already_handled).length;
  const recoveredSent = logs.filter((row) => row.status === "sent").length;

  return (
    <div className="hotbox-admin-page space-y-5">
      <div className="hotbox-admin-header">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#ffcf00]"><Zap className="size-3.5" /> Recuperação de vendas</div>
          <h1 className="hotbox-admin-title">Recupere pedidos que quase viraram venda</h1>
          <p className="hotbox-admin-subtitle">Centraliza abandonos de checkout e pagamentos não aprovados. Você pode trabalhar 100% manual ou ativar a recuperação automática.</p>
        </div>
        <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Atualizar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Oportunidades agora</p><p className="mt-2 text-3xl font-black">{pending}</p><p className="text-xs text-zinc-500">com telefone e sem compra</p></Card>
        <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Abandono de checkout</p><p className="mt-2 text-3xl font-black">{abandoned}</p><p className="text-xs text-zinc-500">podem receber lembrete</p></Card>
        <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Cartão não aprovado</p><p className="mt-2 text-3xl font-black">{rejected}</p><p className="text-xs text-zinc-500">alta intenção de compra</p></Card>
        <Card className="hotbox-admin-kpi p-4"><p className="text-xs font-black uppercase text-zinc-500">Mensagens enviadas</p><p className="mt-2 text-3xl font-black">{recoveredSent}</p><p className="text-xs text-zinc-500">no período carregado</p></Card>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
        <button onClick={() => setTab("opportunities")} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab === "opportunities" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}><ShoppingCart className="mr-2 inline size-4" />Oportunidades</button>
        <button onClick={() => setTab("automation")} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab === "automation" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}><Settings2 className="mr-2 inline size-4" />Automação</button>
        <button onClick={() => setTab("history")} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab === "history" ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}><History className="mr-2 inline size-4" />Histórico</button>
      </div>

      {loading ? <Card className="p-8 text-center text-sm text-zinc-500">Carregando oportunidades...</Card> : null}

      {!loading && tab === "opportunities" && (
        <Card className="hotbox-admin-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-black">Clientes com chance real de recuperação</h2><p className="mt-1 text-sm text-zinc-500">Só aparecem sessões com telefone informado, intenção de compra e sem compra confirmada.</p></div>
            <Badge variant="secondary">{settings.mode === "automatic" && settings.enabled ? "Automático ativo" : "Modo manual"}</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, telefone, campanha..." /></div>
            <select className="h-10 rounded-xl border bg-white px-3 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">Todos os motivos</option><option value="abandoned_checkout">Abandono de checkout</option><option value="rejected_payment">Cartão não aprovado</option></select>
            <select className="h-10 rounded-xl border bg-white px-3 text-sm" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="all">Todas as origens</option>{sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select>
            <select className="h-10 rounded-xl border bg-white px-3 text-sm" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}><option value="all">Todas as campanhas</option>{campaignOptions.map((campaign) => <option key={campaign} value={campaign}>{campaign}</option>)}</select>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Cliente</th><th className="p-3">Motivo</th><th className="p-3">Origem</th><th className="p-3">Campanha</th><th className="p-3">Há quanto tempo</th><th className="p-3 text-right">Ação</th></tr></thead>
              <tbody>
                {filteredOpportunities.length ? filteredOpportunities.map((row) => (
                  <tr key={`${row.session_id}-${row.recovery_type}`} className="border-t">
                    <td className="p-3"><div className="font-bold">{row.customer_name || "Cliente sem nome"}</div><div className="text-xs text-zinc-500">{formatPhone(row.customer_phone)}</div></td>
                    <td className="p-3">{row.recovery_type === "rejected_payment" ? <Badge className="bg-red-600">Cartão não aprovado</Badge> : <Badge className="bg-amber-500 text-zinc-950">Abandonou checkout</Badge>}</td>
                    <td className="p-3">{recoverySourceLabel(row.source)}</td>
                    <td className="p-3">{row.campaign || "—"}</td>
                    <td className="p-3">{row.minutes_ago < 60 ? `${row.minutes_ago} min` : `${Math.floor(row.minutes_ago / 60)}h`}</td>
                    <td className="p-3 text-right">
                      {row.already_handled ? <Badge variant="secondary">Já trabalhado</Badge> : (
                        <Button size="sm" onClick={() => void sendNow(row)} disabled={sendingId === String(row.session_id)} className="bg-emerald-600 font-black text-white hover:bg-emerald-700"><MessageCircle className="mr-2 size-4" />{sendingId === String(row.session_id) ? "Enviando..." : "Recuperar agora"}</Button>
                      )}
                    </td>
                  </tr>
                )) : <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Nenhuma oportunidade encontrada com esses filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && tab === "automation" && (
        <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
          <Card className="hotbox-admin-card p-5">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-black">Modo de recuperação</h2><p className="mt-1 text-sm text-zinc-500">Você decide se o sistema apenas organiza as oportunidades ou se envia automaticamente.</p></div><Sparkles className="size-6 text-amber-500" /></div>
            <div className="mt-5 grid gap-3">
              <button onClick={() => setSettings((s) => ({ ...s, mode: "manual", enabled: false }))} className={`rounded-2xl border p-4 text-left ${settings.mode === "manual" ? "border-zinc-950 bg-zinc-50 ring-2 ring-zinc-950/10" : "bg-white"}`}><div className="font-black">Manual</div><p className="mt-1 text-sm text-zinc-500">O sistema identifica as oportunidades, mas você decide quando enviar cada mensagem.</p></button>
              <button onClick={() => setSettings((s) => ({ ...s, mode: "automatic", enabled: true }))} className={`rounded-2xl border p-4 text-left ${settings.mode === "automatic" ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/10" : "bg-white"}`}><div className="flex items-center gap-2 font-black"><Zap className="size-4" />Automático</div><p className="mt-1 text-sm text-zinc-500">O sistema verifica a cada poucos minutos e envia quando a regra estiver pronta.</p></button>
            </div>
            <div className="mt-5 rounded-2xl bg-zinc-950 p-4 text-sm text-white"><b>Proteções automáticas</b><ul className="mt-2 space-y-1 text-white/70"><li>• só envia para quem informou telefone;</li><li>• cancela se já existir pedido;</li><li>• evita repetição pelo período de segurança;</li><li>• registra todos os envios no histórico.</li></ul></div>
          </Card>

          <Card className="hotbox-admin-card p-5">
            <h2 className="text-lg font-black">Regras da automação</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span className="font-black">Abandono de checkout</span><input type="checkbox" checked={settings.abandoned_checkout_enabled} onChange={(e) => setSettings((s) => ({ ...s, abandoned_checkout_enabled: e.target.checked }))} /></div><p className="mt-1 text-xs text-zinc-500">Mensagem após o cliente parar no checkout.</p><div className="mt-3"><span className="text-xs font-bold">Esperar quantos minutos</span><Input type="number" min={5} value={settings.abandoned_delay_minutes} onChange={(e) => setSettings((s) => ({ ...s, abandoned_delay_minutes: Number(e.target.value) }))} /></div></label>
              <label className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span className="font-black">Pagamento não aprovado</span><input type="checkbox" checked={settings.rejected_payment_enabled} onChange={(e) => setSettings((s) => ({ ...s, rejected_payment_enabled: e.target.checked }))} /></div><p className="mt-1 text-xs text-zinc-500">Recupera uma pessoa com intenção muito alta.</p><div className="mt-3"><span className="text-xs font-bold">Esperar quantos minutos</span><Input type="number" min={0} value={settings.rejected_delay_minutes} onChange={(e) => setSettings((s) => ({ ...s, rejected_delay_minutes: Number(e.target.value) }))} /></div></label>
              <div><label className="text-xs font-black uppercase text-zinc-500">Intervalo de segurança (horas)</label><Input type="number" min={1} value={settings.cooldown_hours} onChange={(e) => setSettings((s) => ({ ...s, cooldown_hours: Number(e.target.value) }))} /></div>
              <div><label className="text-xs font-black uppercase text-zinc-500">Máximo por telefone em 24h</label><Input type="number" min={1} max={10} value={settings.max_messages_per_phone_24h} onChange={(e) => setSettings((s) => ({ ...s, max_messages_per_phone_24h: Number(e.target.value) }))} /></div>
            </div>
            <div className="mt-5 space-y-4">
              <div><label className="mb-1 block text-sm font-black">Mensagem para abandono de checkout</label><Textarea rows={4} value={settings.abandoned_message} onChange={(e) => setSettings((s) => ({ ...s, abandoned_message: e.target.value }))} /></div>
              <div><label className="mb-1 block text-sm font-black">Mensagem para cartão não aprovado</label><Textarea rows={4} value={settings.rejected_message} onChange={(e) => setSettings((s) => ({ ...s, rejected_message: e.target.value }))} /></div>
            </div>
            {settings.mode === "automatic" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mr-2 inline size-4" />Ao salvar no modo automático, o sistema poderá enviar WhatsApp sozinho conforme essas regras.</div>}
            <Button className="mt-5 w-full bg-zinc-950 font-black text-white" onClick={() => void saveSettings()} disabled={saving}><Save className="mr-2 size-4" />{saving ? "Salvando..." : "Salvar configuração"}</Button>
          </Card>
        </div>
      )}

      {!loading && tab === "history" && (
        <Card className="hotbox-admin-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">Histórico de recuperação</h2><p className="mt-1 text-sm text-zinc-500">Auditoria completa de mensagens manuais e automáticas.</p></div><History className="size-5 text-zinc-400" /></div>
          <div className="mt-4 flex flex-wrap gap-2"><select className="h-10 rounded-xl border bg-white px-3 text-sm" value={historyModeFilter} onChange={(e) => setHistoryModeFilter(e.target.value)}><option value="all">Manual e automático</option><option value="manual">Manual</option><option value="automatic">Automático</option></select><select className="h-10 rounded-xl border bg-white px-3 text-sm" value={historyStatusFilter} onChange={(e) => setHistoryStatusFilter(e.target.value)}><option value="all">Todos os status</option><option value="sent">Enviado</option><option value="failed">Falhou</option><option value="cancelled">Cancelado</option><option value="skipped">Ignorado</option></select></div>
          <div className="mt-4 overflow-x-auto rounded-2xl border"><table className="w-full text-sm"><thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><tr><th className="p-3">Quando</th><th className="p-3">Cliente</th><th className="p-3">Motivo</th><th className="p-3">Modo</th><th className="p-3">Status</th><th className="p-3">Origem/campanha</th></tr></thead><tbody>{filteredLogs.length ? filteredLogs.map((row) => <tr key={row.id} className="border-t"><td className="p-3 whitespace-nowrap">{formatDateTime(row.sent_at || row.created_at)}</td><td className="p-3"><div className="font-bold">{row.customer_name || "Cliente"}</div><div className="text-xs text-zinc-500">{formatPhone(row.customer_phone)}</div></td><td className="p-3">{recoveryTypeLabel(row.recovery_type)}</td><td className="p-3">{row.mode === "automatic" ? <Badge className="bg-zinc-950">Automático</Badge> : <Badge variant="secondary">Manual</Badge>}</td><td className="p-3">{row.status === "sent" ? <Badge className="bg-emerald-600">Enviado</Badge> : row.status === "failed" ? <Badge className="bg-red-600">Falhou</Badge> : <Badge variant="secondary">{row.status}</Badge>}</td><td className="p-3"><div>{recoverySourceLabel(row.source)}</div><div className="text-xs text-zinc-500">{row.campaign || "—"}</div></td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Nenhum envio de recuperação registrado ainda.</td></tr>}</tbody></table></div>
        </Card>
      )}
    </div>
  );
}

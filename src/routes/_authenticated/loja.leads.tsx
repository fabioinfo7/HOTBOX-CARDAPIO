import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatPhone, formatDateTime, ORDER_STATUS_LABEL, orderDisplayRef } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users, MessageCircle, Search, MapPin, Phone,
  Trash2, Tag, X, Plus, Filter, ThumbsUp, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { sendSatisfactionRequestFn } from "@/lib/satisfaction.functions";

export const Route = createFileRoute("/_authenticated/loja/leads")({
  component: LeadsPage,
});

// ── Configuração de tags ─────────────────────────────────────────────────
const TAG_PRESETS = ["VIP", "Interessado", "Frio", "Recorrente", "Bloqueado", "Problemático"];

const TAG_STYLE: Record<string, string> = {
  VIP:          "bg-yellow-100  text-yellow-800  border border-yellow-400",
  Interessado:  "bg-green-100   text-green-800   border border-green-400",
  Frio:         "bg-sky-100     text-sky-800     border border-sky-300",
  Recorrente:   "bg-purple-100  text-purple-800  border border-purple-400",
  Bloqueado:    "bg-red-100     text-red-700     border border-red-400",
  Problemático: "bg-orange-100  text-orange-800  border border-orange-400",
};

function tagStyle(tag: string) {
  return TAG_STYLE[tag] ?? "bg-gray-100 text-gray-700 border border-gray-300";
}

function leadDisplayName(lead: Pick<Lead, "name" | "phone" | "order_count">) {
  const name = (lead.name ?? "").trim();
  const digits = name.replace(/\D/g, "");
  const phoneDigits = lead.phone.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 10 && (digits === phoneDigits || name === lead.phone);
  if (name && !looksLikePhone) return name;
  return (lead.order_count ?? 0) > 0 ? "Cliente" : "Sem nome";
}

// ── Types ────────────────────────────────────────────────────────────────
type Lead = {
  id: string;
  name: string | null;
  phone: string;
  last_order_at: string | null;
  order_count: number;
  total_spent: number;
  source: string | null;
  tags: string[];
};

type LeadOrder = {
  id: string; order_number: number | null; external_id: string | null;
  external_display_id: string | null; source: string | null; status: string;
  total: number; created_at: string;
  address_street: string | null; address_number: string | null;
  address_complement: string | null; address_neighborhood: string | null;
  address_city: string | null;
};

type SatisfactionStatus = {
  eligibleOrderId: string | null;
  eligibleOrderRef: string | null;
  latestState: "none" | "sent" | "opened" | "submitted";
};

// ── Inline tag editor ────────────────────────────────────────────────────
function TagEditor({ lead, onUpdate }: { lead: Lead; onUpdate: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function toggleTag(tag: string) {
    const next = lead.tags.includes(tag)
      ? lead.tags.filter((t) => t !== tag)
      : [...lead.tags, tag];
    await saveTag(next);
  }

  async function addCustom() {
    const t = custom.trim();
    if (!t || lead.tags.includes(t)) return;
    await saveTag([...lead.tags, t]);
    setCustom("");
  }

  async function saveTag(next: string[]) {
    const { error } = await supabase.from("leads").update({ tags: next }).eq("id", lead.id);
    if (error) { toast.error("Erro ao salvar tag"); return; }
    onUpdate(next);
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      {/* Tags atuais + botão de abrir editor */}
      <div className="flex flex-wrap items-center gap-1">
        {lead.tags.map((t) => (
          <span key={t} className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${tagStyle(t)}`}>
            {t}
            <button
              onClick={(e) => { e.stopPropagation(); toggleTag(t); }}
              className="ml-0.5 rounded-full hover:text-red-600"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex size-5 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-primary hover:text-primary"
          title="Categorizar lead"
        >
          <Plus className="size-3" />
        </button>
      </div>

      {/* Dropdown editor */}
      {open && (
        <div className="absolute left-0 top-7 z-50 w-60 rounded-xl border bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Categorias
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TAG_PRESETS.map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  lead.tags.includes(t)
                    ? tagStyle(t) + " ring-2 ring-offset-1 ring-primary/40"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {lead.tags.includes(t) ? "✓ " : ""}{t}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-1.5 border-t pt-3">
            <Input
              className="h-7 text-xs"
              placeholder="Tag personalizada…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
            />
            <Button size="sm" className="h-7 px-2" onClick={addCustom}>
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────
export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "buyers" | "contacts">("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [history, setHistory] = useState<LeadOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [toDelete, setToDelete] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sendingFeedbackLeadId, setSendingFeedbackLeadId] = useState<string | null>(null);
  const [satisfactionByLead, setSatisfactionByLead] = useState<Record<string, SatisfactionStatus>>({});

  async function loadSatisfactionStatuses(rows: Lead[]) {
    const buyers = rows.filter((l) => (l.order_count ?? 0) > 0);
    if (!buyers.length) { setSatisfactionByLead({}); return; }

    const phones = buyers.map((l) => l.phone);
    const { data: orders } = await supabase
      .from("orders")
      .select("id,customer_phone,order_number,external_display_id,created_at")
      .in("customer_phone", phones)
      .eq("status", "delivered")
      .order("created_at", { ascending: false });
    const orderIds = (orders ?? []).map((o: any) => o.id);
    const { data: feedback } = orderIds.length
      ? await supabase.from("customer_feedback").select("order_id,sent_at,opened_at,submitted_at").in("order_id", orderIds)
      : { data: [] as any[] };

    const feedbackByOrder = new Map<string, any>();
    for (const f of feedback ?? []) if (f.order_id) feedbackByOrder.set(f.order_id, f);
    const next: Record<string, SatisfactionStatus> = {};
    for (const lead of buyers) {
      const ownOrders = (orders ?? []).filter((o: any) => o.customer_phone === lead.phone);
      const latest = ownOrders[0];
      const latestFeedback = latest ? feedbackByOrder.get(latest.id) : null;
      const eligible = latest && !latestFeedback ? latest : null;
      next[lead.id] = {
        eligibleOrderId: eligible?.id ?? null,
        eligibleOrderRef: eligible ? String(eligible.external_display_id || eligible.order_number || "") : null,
        latestState: latestFeedback?.submitted_at ? "submitted" : latestFeedback?.opened_at ? "opened" : latestFeedback?.sent_at ? "sent" : "none",
      };
    }
    setSatisfactionByLead(next);
  }

  async function loadLeads() {
    const { data } = await supabase
      .from("leads")
      .select("id,name,phone,last_order_at,order_count,total_spent,source,tags")
      .order("created_at", { ascending: false });
    const rows = (data as Lead[]) ?? [];
    setLeads(rows);
    await loadSatisfactionStatuses(rows);
  }

  useEffect(() => {
    loadLeads();
    const feedbackCh = supabase.channel("leads-satisfaction-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_feedback" }, loadLeads)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadLeads)
      .subscribe();
    return () => { supabase.removeChannel(feedbackCh); };
  }, []);

  function updateLeadTags(id: string, tags: string[]) {
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, tags } : l));
    if (selected?.id === id) setSelected((s) => s ? { ...s, tags } : s);
  }

  async function openLead(l: Lead) {
    setSelected(l);
    setHistoryLoading(true);
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.from("orders")
      .select("id,order_number,external_id,external_display_id,source,status,total,created_at,address_street,address_number,address_complement,address_neighborhood,address_city")
      .eq("customer_phone", l.phone)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    setHistory((data as LeadOrder[]) ?? []);
    setHistoryLoading(false);
  }

  async function sendFeedbackRequest(lead: Lead) {
    if ((lead.order_count ?? 0) < 1) return;
    setSendingFeedbackLeadId(lead.id);
    try {
      const status = satisfactionByLead[lead.id];
      const result = await sendSatisfactionRequestFn({ data: { leadId: lead.id, orderId: status?.eligibleOrderId ?? undefined } });
      if (!result.ok) {
        toast.error(result.error || "Não foi possível enviar a avaliação.");
        return;
      }
      toast.success("Pedido de avaliação enviado pelo WhatsApp!");
      await loadLeads();
    } catch (error: any) {
      toast.error(String(error?.message ?? "Falha ao enviar pedido de avaliação."));
    } finally {
      setSendingFeedbackLeadId(null);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("leads").delete().eq("id", toDelete.id);
    if (error) {
      toast.error("Erro ao deletar lead");
    } else {
      setLeads((prev) => prev.filter((l) => l.id !== toDelete.id));
      if (selected?.id === toDelete.id) setSelected(null);
      toast.success("Lead removido");
    }
    setToDelete(null);
    setDeleting(false);
  }

  // Filtragem
  const allTags = [...new Set(leads.flatMap((l) => l.tags ?? []))].sort();

  const filtered = leads.filter((l) => {
    if (typeFilter === "buyers" && (l.order_count ?? 0) === 0) return false;
    if (typeFilter === "contacts" && (l.order_count ?? 0) > 0) return false;
    if (tagFilter && !(l.tags ?? []).includes(tagFilter)) return false;
    if (q) {
      const s = q.toLowerCase();
      const matchName = (l.name ?? "").toLowerCase().includes(s);
      const matchPhone = l.phone.includes(q.replace(/\D/g, ""));
      const matchTag = (l.tags ?? []).some((t) => t.toLowerCase().includes(s));
      if (!matchName && !matchPhone && !matchTag) return false;
    }
    return true;
  });

  const PAGE = 20;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, typeFilter, tagFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const paginated = filtered.slice(page * PAGE, (page + 1) * PAGE);

  const buyers   = leads.filter((l) => (l.order_count ?? 0) > 0);
  const contacts = leads.filter((l) => (l.order_count ?? 0) === 0);
  const totalLTV = buyers.reduce((s, l) => s + Number(l.total_spent ?? 0), 0);
  const lastAddr = history[0];

  return (
    <div className="space-y-5 p-1">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Users className="size-6" /> Leads
          </h1>
          <p className="text-sm text-muted-foreground">
            Todo contato via WhatsApp vira lead automaticamente.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 w-64" placeholder="Nome, telefone ou tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total de leads</p>
          <p className="text-2xl font-bold">{leads.length}</p>
        </Card>
        <Card className="cursor-pointer p-4 hover:ring-2 hover:ring-primary/30 transition" onClick={() => setTypeFilter("buyers")}>
          <p className="text-xs text-muted-foreground">Clientes (compraram)</p>
          <p className="text-2xl font-bold text-green-600">{buyers.length}</p>
        </Card>
        <Card className="cursor-pointer p-4 hover:ring-2 hover:ring-primary/30 transition" onClick={() => setTypeFilter("contacts")}>
          <p className="text-xs text-muted-foreground">Só mensageiros</p>
          <p className="text-2xl font-bold text-yellow-600">{contacts.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Faturamento total</p>
          <p className="text-2xl font-bold text-primary">{brl(totalLTV)}</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tipo */}
        {(["all", "buyers", "contacts"] as const).map((f) => (
          <button key={f} onClick={() => setTypeFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              typeFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}>
            {f === "all" ? "Todos" : f === "buyers" ? "Clientes" : "Só mensageiros"}
          </button>
        ))}

        {/* Separador */}
        {allTags.length > 0 && <span className="text-muted-foreground">|</span>}

        {/* Filtro por tag */}
        {allTags.map((t) => (
          <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              tagFilter === t ? tagStyle(t) + " ring-2 ring-offset-1 ring-primary/40" : tagStyle(t) + " opacity-60 hover:opacity-100"
            }`}>
            <Filter className="size-2.5" /> {t}
          </button>
        ))}

        {(typeFilter !== "all" || tagFilter) && (
          <button onClick={() => { setTypeFilter("all"); setTagFilter(null); }}
            className="text-xs text-muted-foreground underline">
            Limpar filtros
          </button>
        )}
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nenhum lead encontrado.</Card>
      ) : (
        <Card className="divide-y">
          {paginated.map((l) => {
            const isBuyer = (l.order_count ?? 0) > 0;
            return (
              <div key={l.id}
                className="group flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40"
                onClick={() => openLead(l)}
              >
                {/* Info */}
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isBuyer ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {isBuyer ? "Cliente" : "Contato"}
                    </span>
                    <p className="font-semibold">{leadDisplayName(l)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(l.phone)}
                    {l.last_order_at
                      ? ` • Último pedido: ${formatDateTime(l.last_order_at)}`
                      : " • Nunca comprou"}
                  </p>
                  {/* Tags */}
                  <TagEditor
                    lead={{ ...l, tags: l.tags ?? [] }}
                    onUpdate={(tags) => updateLeadTags(l.id, tags)}
                  />
                </div>

                {/* Ações */}
                <div className="flex shrink-0 items-center gap-2 text-sm">
                  {isBuyer && (
                    <>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground">Pedidos</p>
                        <p className="font-semibold">{l.order_count}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground">Total</p>
                        <p className="font-semibold text-primary">{brl(Number(l.total_spent ?? 0))}</p>
                      </div>
                    </>
                  )}
                  {isBuyer && (() => {
                    const sat = satisfactionByLead[l.id];
                    const canSend = !!sat?.eligibleOrderId;
                    const title = canSend
                      ? "Avaliação ainda não enviada — clique para enviar agora"
                      : sat?.latestState === "submitted"
                        ? "Cliente avaliou a última compra"
                        : sat?.latestState === "opened"
                          ? "Cliente abriu o link de avaliação"
                          : "Avaliação enviada ao cliente";
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        title={title}
                        disabled={sendingFeedbackLeadId === l.id || !canSend}
                        onClick={(e) => { e.stopPropagation(); sendFeedbackRequest(l); }}
                        className={canSend
                          ? "gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                          : sat?.latestState === "submitted"
                            ? "gap-1.5 border-emerald-300 bg-emerald-50 text-emerald-700"
                            : sat?.latestState === "opened"
                              ? "gap-1.5 border-sky-300 bg-sky-50 text-sky-700"
                              : "gap-1.5 border-slate-200 text-slate-500"}
                      >
                        {sendingFeedbackLeadId === l.id ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />}
                        <span className="hidden lg:inline">{canSend ? "Enviar agora" : sat?.latestState === "submitted" ? "Avaliado" : sat?.latestState === "opened" ? "Abriu" : "Enviado"}</span>
                      </Button>
                    );
                  })()}
                  <Link to="/loja/chat" search={{ phone: l.phone, name: leadDisplayName(l) !== "Cliente" && leadDisplayName(l) !== "Sem nome" ? leadDisplayName(l) : undefined }}
                    onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline">
                      <MessageCircle className="size-3" />
                    </Button>
                  </Link>
                  <button
                    onClick={(e) => { e.stopPropagation(); setToDelete(l); }}
                    className="rounded-full p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Deletar lead"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Paginação */}
      {filtered.length > PAGE && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {filtered.length} lead(s) — página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}

      {/* Dialog detalhes */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {leadDisplayName(selected)}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    (selected.order_count ?? 0) > 0 ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                  }`}>
                    {(selected.order_count ?? 0) > 0 ? "Cliente" : "Contato"}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <Card className="p-4 text-sm space-y-2">
                  <p className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" /> {formatPhone(selected.phone)}
                  </p>
                  {lastAddr?.address_street ? (
                    <p className="flex items-start gap-2">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>
                        {lastAddr.address_street}, {lastAddr.address_number}
                        {lastAddr.address_complement ? ` — ${lastAddr.address_complement}` : ""}
                        <br />{lastAddr.address_neighborhood}{lastAddr.address_city ? ` • ${lastAddr.address_city}` : ""}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sem endereço registrado.</p>
                  )}
                  <div className="flex gap-4 border-t pt-2 text-xs text-muted-foreground">
                    <span>Pedidos: <b className="text-foreground">{selected.order_count}</b></span>
                    <span>Total: <b className="text-primary">{brl(Number(selected.total_spent ?? 0))}</b></span>
                  </div>
                </Card>

                {/* Tags no dialog */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <Tag className="size-3.5" /> Categorias
                  </p>
                  <TagEditor
                    lead={{ ...selected, tags: selected.tags ?? [] }}
                    onUpdate={(tags) => updateLeadTags(selected.id, tags)}
                  />
                </div>

                {/* Histórico de pedidos */}
                {(selected.order_count ?? 0) > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Histórico (últimos 60 dias)
                    </h3>
                    {historyLoading ? (
                      <p className="text-sm text-muted-foreground">Carregando…</p>
                    ) : !history.length ? (
                      <p className="text-sm text-muted-foreground">Nenhum pedido nos últimos 60 dias.</p>
                    ) : (
                      <div className="space-y-2">
                        {history.map((o) => (
                          <Card key={o.id} className="p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold">{orderDisplayRef(o)}</p>
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {ORDER_STATUS_LABEL[o.status] ?? o.status}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{formatDateTime(o.created_at)} • {brl(o.total)}</p>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Link to="/loja/chat" search={{ phone: selected.phone, name: leadDisplayName(selected) !== "Cliente" && leadDisplayName(selected) !== "Sem nome" ? leadDisplayName(selected) : undefined }} className="flex-1">
                    <Button className="w-full"><MessageCircle className="size-4" /> Conversar</Button>
                  </Link>
                  <Button variant="destructive" onClick={() => { setToDelete(selected); setSelected(null); }}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação de delete */}
      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar lead?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <b>{toDelete?.name || formatPhone(toDelete?.phone ?? "")}</b> será removido
              permanentemente. O histórico de conversa no WhatsApp não é afetado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deletando…" : "Deletar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

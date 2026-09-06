import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { brasiliaDateDaysAgo, brasiliaDateISO, brasiliaMonthStart } from "@/lib/brasilia-date";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard,
  Edit3, ExternalLink, Loader2, QrCode, RefreshCw, Trash2, WalletCards,
} from "lucide-react";
import {
  hideDigitalMenuFinanceRecordFn,
  listDigitalMenuFinanceFn,
  updateDigitalMenuFinanceMetaFn,
} from "@/lib/digital-menu-finance.functions";

export const Route = createFileRoute("/_authenticated/loja/financeiro-cardapio")({ component: DigitalMenuFinancePage });

type PaymentFilter = "all" | "pix" | "card";
type ProviderFilter = "all" | "mercadopago" | "infinitepay";
type Summary = { transactions?: number; sales_total?: number; pix_total?: number; pix_count?: number; card_total?: number; card_count?: number };
type Tx = {
  id: string; status: string; payment_provider: string | null; payment_kind: string;
  customer_name: string; customer_phone: string; subtotal: number; delivery_fee: number;
  coupon_code: string | null; coupon_discount: number; total: number; order_id: string | null;
  paid_at: string | null; created_at: string; updated_at: string;
  infinitepay_receipt_url: string | null; infinitepay_amount_cents: number | null;
  infinitepay_paid_amount_cents: number | null; infinitepay_installments: number | null;
  mercadopago_status: string | null; mercadopago_status_detail: string | null;
  mercadopago_payment_method_id: string | null; mercadopago_payment_type_id: string | null;
  mercadopago_installments: number | null; mercadopago_transaction_amount: number | null;
  mercadopago_net_received_amount: number | null; mercadopago_fee_amount: number | null;
  finance_reference: string | null; finance_note: string | null; order: any | null;
};

const PAGE_SIZE = 15;
const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dtFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDate = (iso?: string | null) => iso ? dtFmt.format(new Date(iso)) : "—";

function providerOf(tx: Tx): "mercadopago" | "infinitepay" {
  return tx.payment_provider === "mercadopago" || tx.payment_kind.startsWith("mercadopago") ? "mercadopago" : "infinitepay";
}
function providerLabel(tx: Tx) { return providerOf(tx) === "mercadopago" ? "Mercado Pago" : "InfinitePay"; }
function paymentLabel(tx: Tx) { return tx.payment_kind.endsWith("_pix") || tx.mercadopago_payment_method_id === "pix" ? "Pix" : "Cartão"; }
function installments(tx: Tx) { return providerOf(tx) === "mercadopago" ? Number(tx.mercadopago_installments || 1) : Number(tx.infinitepay_installments || 1); }
function grossAmount(tx: Tx) { return providerOf(tx) === "mercadopago" ? Number(tx.mercadopago_transaction_amount ?? tx.total) : Number(tx.infinitepay_amount_cents == null ? tx.total : tx.infinitepay_amount_cents / 100); }
function customerPaid(tx: Tx) { return providerOf(tx) === "mercadopago" ? grossAmount(tx) : Number(tx.infinitepay_paid_amount_cents == null ? tx.total : tx.infinitepay_paid_amount_cents / 100); }
function orderRef(tx: Tx) { const v = tx.order?.external_display_id || tx.order?.order_number; return v ? `#${String(v).replace(/^#/, "")}` : "Sem nº"; }

function SummaryCard({ icon: Icon, label, value, helper }: { icon: any; label: string; value: string; helper: string }) {
  return <Card className="overflow-hidden border-0 bg-card p-5 shadow-sm ring-1 ring-black/5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{helper}</p></div><div className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-5" /></div></div></Card>;
}

function DigitalMenuFinancePage() {
  const [from, setFrom] = useState(brasiliaMonthStart());
  const [to, setTo] = useState(brasiliaDateISO());
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Tx[]>([]);
  const [count, setCount] = useState(0);
  const [periodSummary, setPeriodSummary] = useState<Summary>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tx | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const rangeStart = count ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(page * PAGE_SIZE, count);

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const res = await listDigitalMenuFinanceFn({ data: { from, to, payment, provider, page: nextPage, pageSize: PAGE_SIZE } });
      if (!res?.ok) throw new Error(res?.error || "Não foi possível carregar os recebimentos.");
      setRows((res.rows || []) as Tx[]); setCount(Number(res.count || 0)); setPeriodSummary((res.periodSummary || {}) as Summary); setPage(Number(res.page || nextPage));
    } catch (e: any) { toast.error(String(e?.message || "Não foi possível carregar os recebimentos.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, payment, provider]);
  useEffect(() => { if (page > totalPages) void load(totalPages); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [totalPages]);

  function openTx(tx: Tx) { setSelected(tx); setEditing(false); setReference(tx.finance_reference || ""); setNote(tx.finance_note || ""); }
  async function saveMeta() {
    if (!selected) return; setSaving(true);
    try { const r = await updateDigitalMenuFinanceMetaFn({ data: { checkoutId: selected.id, reference, note } }); if (!r?.ok) throw new Error(r?.error || "Falha ao salvar."); toast.success("Informações internas atualizadas."); setEditing(false); await load(page); setSelected(cur => cur ? { ...cur, finance_reference: reference.trim() || null, finance_note: note.trim() || null } : cur); }
    catch (e: any) { toast.error(String(e?.message || "Não foi possível salvar.")); } finally { setSaving(false); }
  }
  async function hideRecord() {
    if (!selected || !window.confirm("Remover este registro somente desta tela?\n\nO pagamento, o pedido e o lançamento do Financeiro Geral NÃO serão apagados.")) return;
    setSaving(true); try { const r = await hideDigitalMenuFinanceRecordFn({ data: { checkoutId: selected.id } }); if (!r?.ok) throw new Error(r?.error || "Falha ao remover."); setSelected(null); await load(page); toast.success("Registro removido desta lista."); } catch (e: any) { toast.error(String(e?.message || "Não foi possível remover.")); } finally { setSaving(false); }
  }
  function quickRange(k: "today" | "7" | "30" | "month") { if (k === "today") { setFrom(brasiliaDateISO()); setTo(brasiliaDateISO()); } else if (k === "7") { setFrom(brasiliaDateDaysAgo(6)); setTo(brasiliaDateISO()); } else if (k === "30") { setFrom(brasiliaDateDaysAgo(29)); setTo(brasiliaDateISO()); } else { setFrom(brasiliaMonthStart()); setTo(brasiliaDateISO()); } }
  const periodCaption = useMemo(() => from === to ? `Movimentações de ${from.split("-").reverse().join("/")}` : `${from.split("-").reverse().join("/")} até ${to.split("-").reverse().join("/")}`, [from, to]);

  return <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-5 sm:px-6 lg:px-8">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><Link to="/loja/financeiro" className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Financeiro geral</Link><div className="flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><WalletCards className="size-6" /></div><div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Recebimentos do Cardápio Digital</h1><p className="mt-1 text-sm text-muted-foreground">Mercado Pago e InfinitePay em uma única conciliação, sem duplicar o Financeiro Geral.</p></div></div></div><Button variant="outline" className="gap-2 rounded-xl" onClick={() => load(page)} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</Button></div>

    <div className="grid gap-3 sm:grid-cols-3"><SummaryCard icon={CircleDollarSign} label="Total confirmado" value={brl(periodSummary.sales_total)} helper={`${Number(periodSummary.transactions || 0)} transações no período`} /><SummaryCard icon={QrCode} label="Pix" value={brl(periodSummary.pix_total)} helper={`${Number(periodSummary.pix_count || 0)} pagamentos`} /><SummaryCard icon={CreditCard} label="Cartão" value={brl(periodSummary.card_total)} helper={`${Number(periodSummary.card_count || 0)} pagamentos`} /></div>

    <Card className="border-0 p-4 shadow-sm ring-1 ring-black/5 sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" /><p className="text-sm font-black">Período e filtros</p></div><p className="mt-1 text-xs text-muted-foreground">{periodCaption} · Horário de Brasília</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div><Label className="text-xs">De</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div><div><Label className="text-xs">Até</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div><div><Label className="text-xs">Pagamento</Label><Select value={payment} onValueChange={v => setPayment(v as PaymentFilter)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Pix + cartão</SelectItem><SelectItem value="pix">Somente Pix</SelectItem><SelectItem value="card">Somente cartão</SelectItem></SelectContent></Select></div><div><Label className="text-xs">Provedor</Label><Select value={provider} onValueChange={v => setProvider(v as ProviderFilter)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="mercadopago">Mercado Pago</SelectItem><SelectItem value="infinitepay">InfinitePay</SelectItem></SelectContent></Select></div></div></div><div className="mt-4 flex flex-wrap gap-2">{[["today","Hoje"],["7","7 dias"],["30","30 dias"],["month","Este mês"]].map(([k,l]) => <Button key={k} variant="outline" size="sm" className="rounded-xl" onClick={() => quickRange(k as any)}>{l}</Button>)}</div></Card>

    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-black/5">
      {loading ? <div className="grid min-h-64 place-items-center"><div className="text-center"><Loader2 className="mx-auto size-7 animate-spin text-primary" /><p className="mt-2 text-sm text-muted-foreground">Carregando recebimentos...</p></div></div> : !rows.length ? <div className="grid min-h-64 place-items-center p-8 text-center"><div><CircleDollarSign className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-black">Nenhum recebimento neste filtro</p><p className="mt-1 text-sm text-muted-foreground">Altere o período, a forma ou o provedor.</p></div></div> : <><div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Data</th><th className="px-5 py-3">Pedido / Cliente</th><th className="px-5 py-3">Pagamento</th><th className="px-5 py-3 text-right">Valor</th></tr></thead><tbody className="divide-y">{rows.map(tx => <tr key={tx.id} onClick={() => openTx(tx)} className="cursor-pointer hover:bg-muted/25"><td className="px-5 py-4 text-sm font-semibold">{formatDate(tx.paid_at)}</td><td className="px-5 py-4"><p className="font-black">{orderRef(tx)} · {tx.customer_name}</p><p className="text-xs text-muted-foreground">{tx.customer_phone}</p></td><td className="px-5 py-4"><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold">{paymentLabel(tx) === "Pix" ? <QrCode className="size-3.5" /> : <CreditCard className="size-3.5" />}{paymentLabel(tx)}</span><span className="text-xs font-bold text-muted-foreground">{providerLabel(tx)}</span></div></td><td className="px-5 py-4 text-right"><p className="text-base font-black">{brl(grossAmount(tx))}</p>{installments(tx) > 1 && <p className="text-[11px] text-muted-foreground">{installments(tx)}x</p>}</td></tr>)}</tbody></table></div><div className="divide-y md:hidden">{rows.map(tx => <button key={tx.id} type="button" onClick={() => openTx(tx)} className="w-full p-4 text-left"><div className="flex justify-between gap-3"><div><p className="text-xs font-bold text-muted-foreground">{formatDate(tx.paid_at)}</p><p className="mt-1 font-black">{orderRef(tx)} · {tx.customer_name}</p></div><p className="font-black">{brl(grossAmount(tx))}</p></div><div className="mt-3 flex items-center justify-between"><span className="text-xs font-bold">{paymentLabel(tx)} · {providerLabel(tx)}</span><ChevronRight className="size-4 text-muted-foreground" /></div></button>)}</div></>}
      <div className="flex flex-col gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><p className="text-xs text-muted-foreground">Mostrando <b>{rangeStart}</b>–<b>{rangeEnd}</b> de <b>{count}</b></p><div className="flex items-center gap-2"><Button variant="outline" size="sm" className="rounded-xl" disabled={page <= 1 || loading} onClick={() => load(page - 1)}><ChevronLeft className="mr-1 size-4" /> Anterior</Button><span className="min-w-20 text-center text-xs font-black">{page} / {totalPages}</span><Button variant="outline" size="sm" className="rounded-xl" disabled={page >= totalPages || loading} onClick={() => load(page + 1)}>Próxima <ChevronRight className="ml-1 size-4" /></Button></div></div>
    </Card>

    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-2xl">{selected && <><div className="border-b bg-muted/20 px-6 pb-5 pt-6 sm:px-8"><DialogHeader className="text-left"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">{orderRef(selected)} · {providerLabel(selected)}</p><DialogTitle className="mt-1 truncate text-2xl font-black sm:text-3xl">{selected.customer_name || "Cliente"}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{selected.customer_phone || "Telefone não informado"}</p></div><div className="shrink-0 sm:text-right"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">Data da transação</p><p className="mt-1 text-sm font-bold">{formatDate(selected.paid_at)}</p></div></div></DialogHeader></div>
      <div className="space-y-7 px-6 py-6 sm:px-8"><section><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Pagamento</h3><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Confirmado</span></div><div className="divide-y border-y"><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Provedor</span><span className="text-sm font-bold">{providerLabel(selected)}</span></div><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Forma de pagamento</span><span className="text-sm font-bold">{paymentLabel(selected)}{installments(selected) > 1 ? ` · ${installments(selected)}x` : ""}</span></div><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Valor da venda</span><span className="text-lg font-black">{brl(grossAmount(selected))}</span></div><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Pago pelo cliente</span><span className="text-sm font-bold">{brl(customerPaid(selected))}</span></div>{providerOf(selected) === "mercadopago" && Number(selected.mercadopago_fee_amount || 0) > 0 && <><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Taxa do provedor</span><span className="text-sm font-bold">{brl(selected.mercadopago_fee_amount)}</span></div><div className="flex justify-between gap-5 py-3.5"><span className="text-sm text-muted-foreground">Líquido informado pelo provedor</span><span className="text-sm font-black">{brl(selected.mercadopago_net_received_amount ?? grossAmount(selected) - Number(selected.mercadopago_fee_amount || 0))}</span></div></>}</div></section>
      <section><h3 className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Composição do pedido</h3><div className="divide-y border-y"><div className="flex justify-between py-3"><span className="text-sm text-muted-foreground">Subtotal</span><span className="text-sm font-bold">{brl(selected.subtotal)}</span></div><div className="flex justify-between py-3"><span className="text-sm text-muted-foreground">Taxa de entrega</span><span className="text-sm font-bold">{brl(selected.delivery_fee)}</span></div><div className="flex justify-between py-3"><span className="text-sm text-muted-foreground">Desconto</span><span className="text-sm font-bold">{brl(selected.coupon_discount)}</span></div>{selected.coupon_code && <div className="flex justify-between py-3"><span className="text-sm text-muted-foreground">Cupom</span><span className="text-sm font-bold">{selected.coupon_code}</span></div>}</div></section>
      {selected.infinitepay_receipt_url && <a href={selected.infinitepay_receipt_url} target="_blank" rel="noreferrer" className="flex items-center justify-between border-y py-4 text-sm font-black text-emerald-700">Abrir comprovante da InfinitePay <ExternalLink className="size-4" /></a>}
      <section><div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Informações internas</h3><p className="mt-1 text-xs text-muted-foreground">Anotações administrativas. Não alteram o pagamento.</p></div><Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={() => setEditing(v => !v)}><Edit3 className="size-4" /> {editing ? "Cancelar" : "Editar"}</Button></div>{editing ? <div className="mt-4 space-y-3 border-t pt-4"><div><Label>Referência interna</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div><div><Label>Observação</Label><textarea className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm" value={note} onChange={e => setNote(e.target.value)} /></div><Button onClick={saveMeta} disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Salvar alterações</Button></div> : <div className="mt-4 divide-y border-y"><div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]"><span className="text-sm text-muted-foreground">Referência</span><span className="text-sm font-semibold">{selected.finance_reference || "—"}</span></div><div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]"><span className="text-sm text-muted-foreground">Observação</span><span className="whitespace-pre-wrap text-sm font-semibold">{selected.finance_note || "—"}</span></div></div>}</section></div>
      <DialogFooter className="border-t px-6 py-4 sm:justify-between sm:px-8"><Button variant="ghost" className="gap-2 text-destructive" onClick={hideRecord} disabled={saving}><Trash2 className="size-4" /> Excluir da lista</Button><Button variant="outline" onClick={() => setSelected(null)}>Fechar</Button></DialogFooter></>}</DialogContent></Dialog>
  </div>;
}

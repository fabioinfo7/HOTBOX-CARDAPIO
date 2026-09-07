import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Bike,
  ChevronRight,
  MapPin,
  Trash2,
  Wallet,
  ClipboardList,
  CheckCircle2,
  XCircle,
  ArrowLeft,
} from "lucide-react";
import { brl, formatDateTime, formatPhone, VEHICLE_LABEL } from "@/lib/formatters";
import { brasiliaDateISO, brasiliaDayRange, brasiliaPeriodStartISO } from "@/lib/brasilia-date";

export const Route = createFileRoute("/_authenticated/loja/entregadores")({
  component: DeliverersPage,
});

type Row = {
  id: string;
  full_name: string;
  phone: string;
  vehicle: string;
  active: boolean;
  created_at: string;
  has_role: boolean;
  selfie_url: string | null;
  payment_status: string;
  payment_note: string | null;
  payment_updated_at: string | null;
};

type DeliveryOrder = {
  id: string;
  order_number: number;
  customer_name: string;
  total: number;
  delivery_fee: number;
  status: string;
  source: string | null;
  created_at: string;
  delivered_at: string | null;
  deliverer_paid_at: string | null;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  partial: "Parcialmente pago",
  paid: "Pago",
};
const PAYMENT_STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  partial: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-700",
};

const PERIOD_OPTIONS = [
  { value: "1", label: "Hoje" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "15", label: "Últimos 15 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "custom", label: "Período personalizado" },
];

function todayISO() {
  return brasiliaDateISO();
}

function periodStartISO(days: number) {
  return brasiliaPeriodStartISO(days);
}

function DeliverersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    const { data: ds } = await supabase.from("deliverers").select("*").order("created_at", { ascending: false });
    const ids = (ds ?? []).map((d: any) => d.id);
    const { data: roles } = ids.length
      ? await supabase.from("user_roles").select("user_id").eq("role", "deliverer").in("user_id", ids)
      : { data: [] as any[] };
    const roleSet = new Set((roles ?? []).map((r: any) => r.user_id));
    const list = ((ds ?? []) as any[]).map((d) => ({ ...d, has_role: roleSet.has(d.id) }));
    setRows(list);
    // mantém o painel de detalhe sincronizado, se estiver aberto
    setSelected((prev) => (prev ? (list.find((r) => r.id === prev.id) ?? prev) : prev));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(r: Row, active: boolean) {
    const { error } = await supabase.from("deliverers").update({ active }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(active ? "Entregador ativado" : "Entregador desativado");
    load();
  }

  async function toggleRole(r: Row, grant: boolean) {
    const { error } = await supabase.rpc("admin_set_deliverer_role", { _user_id: r.id, _grant: grant });
    if (error) return toast.error(error.message);
    toast.success(grant ? "Acesso concedido" : "Acesso revogado");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Entregadores</h1>
        <Button variant="outline" size="sm" onClick={load}>
          Atualizar
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nenhum entregador cadastrado. Compartilhe o link{" "}
          <code className="rounded bg-muted px-1">/entregador/login</code> para que eles se cadastrem.
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card
              key={r.id}
              onClick={() => setSelected(r)}
              className="flex cursor-pointer flex-wrap items-center gap-4 rounded-2xl p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
            >
              {r.selfie_url ? (
                <img src={r.selfie_url} alt={r.full_name} className="size-11 rounded-full object-cover" />
              ) : (
                <div className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                  <Bike className="size-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPhone(r.phone)} • {VEHICLE_LABEL[r.vehicle] ?? r.vehicle}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {!r.active && (
                    <span className="inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                      Novo cadastro — aguardando ativação
                    </span>
                  )}
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${PAYMENT_STATUS_COLOR[r.payment_status] ?? PAYMENT_STATUS_COLOR.pending}`}
                  >
                    {PAYMENT_STATUS_LABEL[r.payment_status] ?? "Pendente"}
                  </span>
                </div>
              </div>
              {/* onClick nos switches não deve abrir o painel de detalhe */}
              <label className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                <Switch checked={r.has_role} onCheckedChange={(v) => toggleRole(r, v)} /> Acesso
              </label>
              <label className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                <Switch checked={r.active} onCheckedChange={(v) => toggleActive(r, v)} /> Ativo
              </label>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Card>
          ))}
        </div>
      )}

      {selected && <DelivererDetailDialog deliverer={selected} onClose={() => setSelected(null)} onSaved={load} />}
    </div>
  );
}

// ============ PAINEL DE DETALHE: entregas do período + valor a receber + observação da loja ============
function DelivererDetailDialog({
  deliverer,
  onClose,
  onSaved,
}: {
  deliverer: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState("7");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [paymentStatus, setPaymentStatus] = useState(deliverer.payment_status || "pending");
  const [paymentNote, setPaymentNote] = useState(deliverer.payment_note || "");
  const [savingNote, setSavingNote] = useState(false);

  async function loadDeliveries() {
    setLoading(true);
    let sinceISO: string, untilISO: string;
    if (period === "custom") {
      const range = brasiliaDayRange(from, to);
      sinceISO = range.since;
      untilISO = range.until;
    } else {
      sinceISO = periodStartISO(Number(period));
      untilISO = new Date().toISOString();
    }

    const fields =
      "id,order_number,customer_name,total,delivery_fee,status,source,created_at,delivered_at,deliverer_paid_at,address_street,address_number,address_neighborhood,address_city";

    const [unpaidRes, paidRes, failedRes] = await Promise.all([
      supabase
        .from("orders")
        .select(fields)
        .eq("deliverer_id", deliverer.id)
        .eq("status", "delivered")
        .is("deliverer_paid_at", null)
        .gte("delivered_at", sinceISO)
        .lte("delivered_at", untilISO),
      supabase
        .from("orders")
        .select(fields)
        .eq("deliverer_id", deliverer.id)
        .eq("status", "delivered")
        .not("deliverer_paid_at", "is", null)
        .gte("deliverer_paid_at", sinceISO)
        .lte("deliverer_paid_at", untilISO),
      supabase
        .from("orders")
        .select(fields)
        .eq("deliverer_id", deliverer.id)
        .eq("status", "failed")
        .gte("created_at", sinceISO)
        .lte("created_at", untilISO),
    ]);

    const combined = [...(unpaidRes.data ?? []), ...(paidRes.data ?? []), ...(failedRes.data ?? [])] as DeliveryOrder[];
    combined.sort((a, b) => {
      const da = a.deliverer_paid_at ?? a.delivered_at ?? a.created_at;
      const db = b.deliverer_paid_at ?? b.delivered_at ?? b.created_at;
      return new Date(db).getTime() - new Date(da).getTime();
    });
    setOrders(combined);
    setLoading(false);
  }

  useEffect(() => {
    loadDeliveries();
  }, [period, from, to, deliverer.id]);

  const summary = useMemo(() => {
    const delivered = orders.filter((o) => o.status === "delivered");
    const failed = orders.filter((o) => o.status === "failed");
    const unpaid = delivered.filter((o) => !o.deliverer_paid_at);
    const paid = delivered.filter((o) => !!o.deliverer_paid_at);
    const toReceive = unpaid.reduce((s, o) => s + Number(o.delivery_fee || 0), 0);
    const paidTotal = paid.reduce((s, o) => s + Number(o.delivery_fee || 0), 0);
    return { delivered: delivered.length, failed: failed.length, unpaid: unpaid.length, toReceive, paidTotal };
  }, [orders]);

  const unpaidOrders = useMemo(
    () => orders.filter((o) => o.status === "delivered" && !o.deliverer_paid_at),
    [orders],
  );
  const paidOrders = useMemo(
    () => orders.filter((o) => o.status === "delivered" && !!o.deliverer_paid_at),
    [orders],
  );

  async function savePaymentNote() {
    setSavingNote(true);
    try {
      if (paymentStatus === "paid") {
        const unpaidIds = orders
          .filter((o) => o.status === "delivered" && !o.deliverer_paid_at)
          .map((o) => o.id);

        if (unpaidIds.length) {
          const paidAt = new Date().toISOString();
          const { error: payError } = await supabase
            .from("orders")
            .update({ deliverer_paid_at: paidAt } as any)
            .in("id", unpaidIds)
            .eq("deliverer_id", deliverer.id)
            .eq("status", "delivered")
            .is("deliverer_paid_at", null);
          if (payError) throw payError;
        }
      }

      const { error } = await supabase
        .from("deliverers")
        .update({
          payment_status: paymentStatus,
          payment_note: paymentNote || null,
          payment_updated_at: new Date().toISOString(),
        })
        .eq("id", deliverer.id);
      if (error) throw error;

      toast.success(paymentStatus === "paid" ? "Repasse marcado como pago" : "Observação salva");
      await loadDeliveries();
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao atualizar pagamento");
    } finally {
      setSavingNote(false);
    }
  }

  async function undoSale(o: DeliveryOrder) {
    if (
      !window.confirm(
        `Desfazer a venda do pedido #${o.order_number}?\n\nIsso vai APAGAR o pedido definitivamente — ele deixa de contar no financeiro e some do histórico. Essa ação não pode ser desfeita.`,
      )
    )
      return;
    try {
      await supabase.from("order_items").delete().eq("order_id", o.id);
      const { error } = await supabase.from("orders").delete().eq("id", o.id);
      if (error) throw error;
      toast.success(`Pedido #${o.order_number} removido — não conta mais no financeiro`);
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao desfazer a venda");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl p-0">
        <div className="flex items-center gap-3 border-b bg-neutral-900 px-5 py-4 text-white">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {deliverer.selfie_url ? (
              <img
                src={deliverer.selfie_url}
                alt={deliverer.full_name}
                className="size-10 rounded-full object-cover ring-2 ring-white/15"
              />
            ) : (
              <div className="grid size-10 place-items-center rounded-full bg-primary/90 ring-2 ring-white/15">
                <Bike className="size-4.5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight">{deliverer.full_name}</p>
              <p className="text-xs text-white/40">
                {formatPhone(deliverer.phone)} • {VEHICLE_LABEL[deliverer.vehicle] ?? deliverer.vehicle}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* filtro de período */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-9 w-56 rounded-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period === "custom" && (
              <>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 rounded-full border px-3 text-sm"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 rounded-full border px-3 text-sm"
                />
              </>
            )}
          </div>

          {/* resumo do período */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Card className="rounded-2xl border-neutral-200/70 p-3.5 text-center shadow-none">
              <p className="text-2xl font-bold text-emerald-600">{summary.delivered}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Entregues</p>
            </Card>
            <Card className="rounded-2xl border-neutral-200/70 p-3.5 text-center shadow-none">
              <p className="text-2xl font-bold text-red-500">{summary.failed}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Falharam</p>
            </Card>
            <Card className="rounded-2xl border-primary/20 bg-primary/5 p-3.5 text-center shadow-none">
              <p className="text-xl font-bold text-primary">{brl(summary.toReceive)}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">A receber</p>
            </Card>
            <Card className="rounded-2xl border-emerald-200/70 bg-emerald-50 p-3.5 text-center shadow-none">
              <p className="text-xl font-bold text-emerald-700">{brl(summary.paidTotal)}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pago no período</p>
            </Card>
          </div>
          <p className="-mt-3 text-[11px] text-muted-foreground">
            "A receber" mostra somente entregas ainda não repassadas. Ao marcar como Pago, esses valores saem daqui e permanecem no histórico pago.
          </p>

          {/* observação da loja */}
          <Card className="space-y-3 rounded-2xl border-neutral-200/70 p-4 shadow-none">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Wallet className="size-3.5" /> Observação da loja sobre pagamento
            </h3>
            <Select value={paymentStatus} onValueChange={setPaymentStatus}>
              <SelectTrigger className="h-9 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="partial">Parcialmente pago</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              placeholder='Ex: "Pago via Pix em 20/07, referente à semana de 14 a 20/07"'
              rows={3}
            />
            {deliverer.payment_updated_at && (
              <p className="text-[11px] text-muted-foreground">
                Última atualização: {formatDateTime(deliverer.payment_updated_at)}
              </p>
            )}
            <Button size="sm" className="rounded-full" onClick={savePaymentNote} disabled={savingNote}>
              {savingNote ? "Salvando..." : paymentStatus === "paid" ? `Marcar ${summary.unpaid} entrega(s) como paga(s)` : "Salvar observação"}
            </Button>
          </Card>

          {/* valores pendentes */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Wallet className="size-3.5" /> Valores a receber
            </h3>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>
            ) : !unpaidOrders.length ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum valor pendente nesse período.</p>
            ) : (
              <div className="space-y-2">
                {unpaidOrders.map((o) => (
                  <Card key={o.id} className="rounded-xl border-amber-200/70 bg-amber-50/40 p-3.5 shadow-none">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">#{o.order_number} — {o.customer_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(o.delivered_at ?? o.created_at)} • Taxa {brl(o.delivery_fee)}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Pendente</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* histórico de valores pagos */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="size-3.5" /> Histórico de valores pagos
            </h3>
            {!paidOrders.length ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum pagamento no período.</p>
            ) : (
              <div className="space-y-2">
                {paidOrders.map((o) => (
                  <Card key={o.id} className="rounded-xl border-emerald-200/70 bg-emerald-50/40 p-3.5 shadow-none">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                          <p className="truncate text-sm font-semibold">#{o.order_number} — {o.customer_name}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Pago em {formatDateTime(o.deliverer_paid_at!)} • Taxa {brl(o.delivery_fee)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 rounded-full text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => undoSale(o)}
                      >
                        <Trash2 className="size-3.5" /> Desfazer venda
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

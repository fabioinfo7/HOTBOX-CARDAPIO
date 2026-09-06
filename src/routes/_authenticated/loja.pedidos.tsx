import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  brl,
  formatDateTime,
  formatPhone,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
  orderDisplayRef,
} from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MessageCircle, UtensilsCrossed, Globe, History, Eye, Trash2, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { brasiliaDateDaysAgo, brasiliaDayRange } from "@/lib/brasilia-date";

export const Route = createFileRoute("/_authenticated/loja/pedidos")({
  component: OrdersHistoryPage,
});

const STATUS_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "delivered", label: "Entregue" },
  { value: "cancelled", label: "Cancelado" },
  { value: "failed", label: "Entrega falhou" },
  { value: "pending", label: "Pendente" },
  { value: "preparing", label: "Em preparação" },
  { value: "ready_pickup", label: "Aguardando retirada" },
  { value: "out_for_delivery", label: "Saiu para entrega" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "Todas as origens" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "ifood", label: "iFood" },
  { value: "99food", label: "99Food" },
  { value: "site", label: "Site" },
];

const PAYMENT_OPTIONS = [
  { value: "all", label: "Todas as formas" },
  { value: "pix", label: "Pix" },
  { value: "cash", label: "Dinheiro" },
  { value: "card", label: "Cartão" },
];

const PAYMENT_LABEL: Record<string, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  card: "Cartão",
  credit: "Cartão",
  debit: "Cartão",
  online: "Online",
};

function todayISO(offsetDays = 0) {
  return brasiliaDateDaysAgo(offsetDays);
}

const PAGE_SIZE = 20;

function OrdersHistoryPage() {
  const [from, setFrom] = useState(todayISO(30));
  const [to, setTo] = useState(todayISO(0));
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dizimadoFilter, setDizimadoFilter] = useState<"all" | "sim" | "nao">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load(targetPage = page) {
    setLoading(true);
    const { since, until } = brasiliaDayRange(from, to);
    let q = supabase
      .from("orders")
      .select(
        "id,order_number,external_display_id,customer_name,customer_phone,total,status,payment_method,source,created_at,dizimado,coupon_code,coupon_discount",
        { count: "exact" },
      )
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: false })
      .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1);
    if (status !== "all") q = q.eq("status", status as any);
    if (source !== "all") q = q.eq("source", source as any);
    if (payment !== "all") q = q.eq("payment_method", payment as any);
    if (dizimadoFilter === "sim") q = q.eq("dizimado", true);
    if (dizimadoFilter === "nao") q = q.eq("dizimado", false);

    const { data, count } = await q;
    setRows(data ?? []);
    setTotalCount(count ?? 0);
    setPage(targetPage);
    setLoading(false);
  }

  async function toggleDizimado(id: string, current: boolean) {
    if (togglingId === id) return;
    setTogglingId(id);
    // Optimistic update
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, dizimado: !current } : r));
    const { error } = await supabase.from("orders").update({ dizimado: !current }).eq("id", id);
    if (error) {
      // Revert on failure
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, dizimado: current } : r));
      toast.error("Erro ao atualizar");
    }
    setTogglingId(null);
  }

  async function deleteOrder(id: string, display: string) {
    if (!window.confirm(`Apagar o pedido ${display} do histórico? Essa ação não pode ser desfeita.`)) return;
    setDeletingId(id);
    try {
      await supabase.from("order_items").delete().eq("order_id", id);
      const { error } = await supabase.from("orders").delete().eq("id", id);
      if (error) throw error;
      toast.success("Pedido removido do histórico");
      setRows((prev) => prev.filter((r) => r.id !== id));
      setTotalCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao remover pedido");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    load(0);
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <History className="size-6" /> Histórico de pedidos
        </h1>
        <p className="text-sm text-muted-foreground">Filtre por período, status, origem e forma de pagamento</p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label>De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Origem</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pagamento</Label>
          <Select value={payment} onValueChange={setPayment}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Dizimado</Label>
          <Select value={dizimadoFilter} onValueChange={(v) => setDizimadoFilter(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="nao">🔴 Não dizimado</SelectItem>
              <SelectItem value="sim">✅ Dizimado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => load(0)} disabled={loading}>
          {loading ? "Buscando..." : "Filtrar"}
        </Button>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">Total no período</p>
          <p className="text-xl font-bold text-primary">{brl(total)}</p>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2">#</th>
              <th className="p-2">Cliente</th>
              <th className="p-2">Data</th>
              <th className="p-2">Origem</th>
              <th className="p-2">Pagamento</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-center">Dizimado</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t hover:bg-muted/30 transition-opacity ${r.dizimado ? "opacity-45" : ""}`}>
                <td className="p-2 font-medium">{orderDisplayRef(r)}</td>
                <td className="p-2">
                  <p>{r.customer_name}</p>
                  <p className="text-xs text-muted-foreground">{formatPhone(r.customer_phone)}</p>
                </td>
                <td className="p-2 text-xs">{formatDateTime(r.created_at)}</td>
                <td className="p-2">
                  {r.source === "whatsapp" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      <MessageCircle className="size-3" /> WhatsApp
                    </span>
                  ) : r.source === "ifood" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                      <UtensilsCrossed className="size-3" /> iFood
                    </span>
                  ) : r.source === "99food" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-bold text-yellow-800">
                      <UtensilsCrossed className="size-3" /> 99Food
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      <Globe className="size-3" /> Site
                    </span>
                  )}
                </td>
                <td className="p-2 text-xs font-medium">
                  {PAYMENT_LABEL[r.payment_method?.toLowerCase()] ?? r.payment_method ?? "—"}
                </td>
                <td className="p-2 text-right font-semibold">
                  {brl(r.total)}
                  {r.coupon_code && (
                    <p className="text-[10px] font-bold text-fuchsia-600">
                      🎟 {r.coupon_code} (-{brl(r.coupon_discount)})
                    </p>
                  )}
                </td>
                <td className="p-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ORDER_STATUS_COLOR[r.status]}`}>
                    {ORDER_STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <button
                    disabled={togglingId === r.id}
                    onClick={() => toggleDizimado(r.id, !!r.dizimado)}
                    title={r.dizimado ? "Desmarcar" : "Marcar como dizimado"}
                    className={`transition-transform active:scale-90 disabled:opacity-40 ${
                      r.dizimado
                        ? "text-green-500 hover:text-green-600"
                        : "text-muted-foreground/25 hover:text-green-400"
                    }`}
                  >
                    <CheckCircle2 className="size-5" />
                  </button>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <Link to="/loja/pedido/$id" params={{ id: r.id }} search={{}}>
                      <Button size="sm" variant="ghost">
                        <Eye className="size-4" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      disabled={deletingId === r.id}
                      onClick={() => deleteOrder(r.id, orderDisplayRef(r))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  Nenhum pedido no período/filtros selecionados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {totalCount} pedido(s) — página {page + 1} de {totalPages}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
            Anterior
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => load(page + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

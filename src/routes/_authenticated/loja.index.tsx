import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatDateTime, formatPhone, orderDisplayRef } from "@/lib/formatters";
import { pushIfoodStatusFn } from "@/lib/ifood-push.functions";
import { pushNfoodStatusFn } from "@/lib/nfood-push.functions";
import { sendOrderArrivalNoticeFn } from "@/lib/order-notifications.functions";
import { getAlarmAudio, setAlarmSrc, playAlarm, pauseAlarm, playAlarmBeep, stopAlarmBeep, primeBeepUnlock } from "@/lib/alarm-audio";
import { requestAutoPrint } from "@/components/auto-print-receipt";
import { ManualOrderDialog } from "@/components/manual-order-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Bike,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Clock3,
  CreditCard,
  Edit3,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  PackagePlus,
  Phone,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  User,
  Wallet,
  X,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/")({
  component: OrdersBoard,
});

type Order = {
  id: string;
  order_number: number | null;
  external_display_id: string | null;
  external_id: string | null;
  source: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  created_at: string;
  accepted_at?: string | null;
  ready_at?: string | null;
  out_for_delivery_at?: string | null;
  delivered_at?: string | null;
  delivery_mode: string;
  address_street: string | null;
  address_number: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_reference?: string | null;
  address_cep?: string | null;
  subtotal?: number;
  delivery_fee: number;
  coupon_discount?: number;
  total: number;
  payment_method: string;
  payment_status: string;
  payment_timing?: string | null;
  card_type?: string | null;
  notes?: string | null;
  deliverer_name?: string | null;
  deliverer_vehicle?: string | null;
  customer_cancel_requested?: boolean;
  customer_cancel_reason?: string | null;
};

type OrderItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  list_price?: number | null;
  notes?: string | null;
};

const ACTIVE_STATUSES = ["pending", "pending_review", "preparing", "ready_pickup", "out_for_delivery"];

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function sourceLabel(source: string) {
  if (source === "ifood") return "iFood";
  if (source === "99food") return "99Food";
  if (source === "site") return "Cardápio digital";
  if (source === "manual") return "Pedido manual";
  return "WhatsApp";
}

function paymentLabel(order: Order) {
  if (order.payment_method === "pix") return "PIX";
  if (order.payment_method === "card") return "Cartão";
  return order.payment_method || "Não informado";
}

function minutesSince(value: string) {
  const ms = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

function initials(name: string) {
  return String(name || "Cliente")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CL";
}

function OrderCard({
  order,
  unread,
  onOpen,
  onAdvance,
  onArrival,
  onCancel,
  advancing,
  arrivalLoading,
}: {
  order: Order;
  unread: boolean;
  onOpen: () => void;
  onAdvance: () => void;
  onArrival: () => void;
  onCancel: () => void;
  advancing: boolean;
  arrivalLoading: boolean;
}) {
  const mins = minutesSince(order.created_at);
  const isPickup = order.delivery_mode === "pickup";
  const isNew = ["pending", "pending_review"].includes(order.status);
  const cancellation = Boolean(order.customer_cancel_requested);

  let action = "Marcar como pronto";
  let ActionIcon: any = Package;
  if (isNew) {
    action = "Iniciar preparo";
    ActionIcon = ChefHat;
  } else if (order.status === "ready_pickup") {
    action = isPickup ? "Marcar como retirado" : "Saiu para entrega";
    ActionIcon = isPickup ? CheckCircle2 : Bike;
  } else if (order.status === "out_for_delivery") {
    action = "Marcar como entregue";
    ActionIcon = CheckCircle2;
  }

  return (
    <Card
      className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${
        unread ? "ring-2 ring-emerald-400 ring-offset-2" : ""
      } ${cancellation ? "border-red-300 bg-red-50/40" : ""}`}
    >
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="border-b bg-gradient-to-r from-zinc-950 to-zinc-900 px-4 py-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#ffcf00] font-black text-zinc-950">
                {initials(order.customer_name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black">{orderDisplayRef(order as any)}</span>
                  {isNew && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide">
                      Novo
                    </span>
                  )}
                  {unread && (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide">
                      Mensagem
                    </span>
                  )}
                </div>
                <p className="truncate text-sm font-semibold text-white/90">{order.customer_name}</p>
              </div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-white/60 transition group-hover:translate-x-0.5" />
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-700">
              {sourceLabel(order.source)}
            </span>
            <span className={`flex items-center gap-1 text-xs font-bold ${mins >= 40 ? "text-red-600" : mins >= 25 ? "text-amber-600" : "text-zinc-500"}`}>
              <Clock3 className="size-3.5" /> {mins} min
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-zinc-50 p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">Total</p>
              <p className="mt-0.5 text-sm font-black text-zinc-900">{brl(Number(order.total || 0))}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">Pagamento</p>
              <p className="mt-0.5 truncate text-sm font-bold text-zinc-900">{paymentLabel(order)}</p>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-zinc-600">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-red-500" />
            <span className="line-clamp-2">
              {isPickup
                ? "Retirada na loja"
                : [order.address_street, order.address_number, order.address_neighborhood]
                    .filter(Boolean)
                    .join(", ") || "Endereço não informado"}
            </span>
          </div>

          {cancellation && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              <AlertTriangle className="mr-1 inline size-3.5" /> Cliente solicitou cancelamento
            </div>
          )}
        </div>
      </button>

      <div className="border-t bg-zinc-50/80 p-3">
        {order.status === "out_for_delivery" && !isPickup && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-2 w-full rounded-xl border-amber-300 bg-amber-50 font-bold text-amber-800 hover:bg-amber-100"
            onClick={(event) => {
              event.stopPropagation();
              onArrival();
            }}
            disabled={arrivalLoading}
          >
            <MessageCircle className="mr-2 size-4" />
            {arrivalLoading ? "Avisando..." : "Avisar no WhatsApp que chegou"}
          </Button>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            type="button"
            className="h-10 rounded-xl bg-[#ffcf00] font-black text-zinc-950 hover:bg-[#f2c300]"
            onClick={(event) => {
              event.stopPropagation();
              onAdvance();
            }}
            disabled={advancing || cancellation}
          >
            <ActionIcon className="mr-2 size-4" />
            {advancing ? "Atualizando..." : action}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-10 rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
            title="Cancelar pedido"
          >
            <XCircle className="size-5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function OrderDrawer({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arrivalLoading, setArrivalLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState(1);
  const [manualPrice, setManualPrice] = useState("");
  const [manualNotes, setManualNotes] = useState("");

  async function load() {
    if (!orderId) return;
    setLoading(true);
    const [{ data: orderRow }, { data: itemRows }, { data: productRows }] = await Promise.all([
      supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at"),
      supabase
        .from("products")
        .select("id,name,sale_price,promotion_active,promotion_price,active")
        .eq("active", true)
        .order("name"),
    ]);
    setOrder((orderRow as any) || null);
    setItems((itemRows as any[]) || []);
    setProducts((productRows as any[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setItems([]);
      return;
    }
    void load();

    const channel = supabase
      .channel(`order-drawer-${orderId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `order_id=eq.${orderId}` }, () => void load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  if (!orderId) return null;

  async function syncTotals() {
    const { data: freshItems, error } = await supabase.from("order_items").select("*").eq("order_id", orderId);
    if (error) throw error;
    const subtotal = (freshItems || []).reduce(
      (sum: number, row: any) => sum + Number(row.unit_price || 0) * Number(row.quantity || 0),
      0,
    );
    const discount = Number(order?.coupon_discount || 0);
    const fee = Number(order?.delivery_fee || 0);
    const total = Math.max(0, subtotal - discount) + fee;
    const { error: orderError } = await supabase
      .from("orders")
      .update({ subtotal, total })
      .eq("id", orderId);
    if (orderError) throw orderError;
    await load();
    onChanged();
  }

  function beginEdit() {
    if (!order) return;
    setDraft({
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      address_street: order.address_street || "",
      address_number: order.address_number || "",
      address_complement: order.address_complement || "",
      address_neighborhood: order.address_neighborhood || "",
      address_city: order.address_city || "",
      address_reference: order.address_reference || "",
      address_cep: order.address_cep || "",
      delivery_fee: Number(order.delivery_fee || 0),
      total: Number(order.total || 0),
      notes: order.notes || "",
      payment_method: order.payment_method || "",
      payment_status: order.payment_status || "pending",
    });
    setEditing(true);
  }

  async function saveOrder() {
    if (!order) return;
    setSaving(true);
    try {
      const fee = Math.max(0, Number(String(draft.delivery_fee).replace(",", ".")) || 0);
      const requestedTotal = Math.max(0, Number(String(draft.total).replace(",", ".")) || 0);
      const patch = {
        customer_name: String(draft.customer_name || "").trim(),
        customer_phone: onlyDigits(draft.customer_phone),
        address_street: String(draft.address_street || "").trim() || null,
        address_number: String(draft.address_number || "").trim() || null,
        address_complement: String(draft.address_complement || "").trim() || null,
        address_neighborhood: String(draft.address_neighborhood || "").trim() || null,
        address_city: String(draft.address_city || "").trim() || null,
        address_reference: String(draft.address_reference || "").trim() || null,
        address_cep: onlyDigits(draft.address_cep) || null,
        delivery_fee: fee,
        total: requestedTotal,
        notes: String(draft.notes || "").trim() || null,
        payment_method: draft.payment_method || order.payment_method,
        payment_status: draft.payment_status || order.payment_status,
      };
      const { error } = await supabase.from("orders").update(patch as any).eq("id", orderId);
      if (error) throw error;
      toast.success("Pedido atualizado");
      setEditing(false);
      await load();
      onChanged();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível atualizar o pedido");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(itemId: string, patch: Record<string, any>) {
    try {
      const { error } = await supabase.from("order_items").update(patch).eq("id", itemId);
      if (error) throw error;
      await syncTotals();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao atualizar item");
    }
  }

  async function deleteItem(itemId: string) {
    if (items.length <= 1) return toast.error("O pedido precisa ter pelo menos um item.");
    if (!window.confirm("Remover este item do pedido?")) return;
    const { error } = await supabase.from("order_items").delete().eq("id", itemId);
    if (error) return toast.error(error.message);
    await syncTotals();
    toast.success("Item removido");
  }

  async function addCatalogProduct() {
    const product = products.find((p: any) => String(p.id) === addProductId);
    if (!product) return;
    const unit = Number(product.promotion_active && product.promotion_price != null ? product.promotion_price : product.sale_price || 0);
    const { error } = await supabase.from("order_items").insert({
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      quantity: Math.max(1, addQty),
      unit_price: unit,
      list_price: Number(product.sale_price || unit),
      is_promotion_price: Boolean(product.promotion_active && product.promotion_price != null),
      notes: null,
    });
    if (error) return toast.error(error.message);
    setAddProductId("");
    setAddQty(1);
    await syncTotals();
    toast.success("Produto adicionado");
  }

  async function addManualItem() {
    const name = manualName.trim();
    const price = Math.max(0, Number(String(manualPrice).replace(",", ".")) || 0);
    if (!name) return toast.error("Informe o nome do item.");
    if (!String(manualPrice).trim()) return toast.error("Informe o preço do item.");
    const { error } = await supabase.from("order_items").insert({
      order_id: orderId,
      product_id: null,
      product_name: name,
      quantity: Math.max(1, manualQty),
      unit_price: price,
      list_price: price,
      is_promotion_price: false,
      notes: manualNotes.trim() || "Item adicionado manualmente pela loja",
    });
    if (error) return toast.error(error.message);
    setManualName("");
    setManualQty(1);
    setManualPrice("");
    setManualNotes("");
    await syncTotals();
    toast.success("Item manual adicionado");
  }

  async function updateStatus(status: string) {
    if (!order) return;
    if (
      status === "preparing" &&
      order.payment_method === "pix" &&
      order.payment_timing === "now" &&
      order.payment_status !== "paid" &&
      !window.confirm("Este pedido ainda não consta como pago via PIX. Iniciar preparo mesmo assim?")
    ) return;

    const now = new Date().toISOString();
    const patch: any = { status };
    if (status === "preparing") patch.accepted_at = now;
    if (status === "ready_pickup") patch.ready_at = now;
    if (status === "out_for_delivery") patch.out_for_delivery_at = now;
    if (status === "delivered") patch.delivered_at = now;

    const previousStatus = order.status;
    const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
    if (error) return toast.error(error.message);

    if (["pending", "pending_review"].includes(previousStatus) && status === "preparing") {
      requestAutoPrint(orderId);
    }

    if (order.source === "ifood") {
      try { await pushIfoodStatusFn({ data: { orderId, newStatus: status } }); } catch (error) { console.error(error); }
    }
    if (order.source === "99food") {
      try { await pushNfoodStatusFn({ data: { orderId, newStatus: status } }); } catch (error) { console.error(error); }
    }

    toast.success(status === "delivered" ? "Pedido entregue" : "Status atualizado");
    await load();
    onChanged();
  }

  async function sendArrival() {
    if (!order || arrivalLoading) return;
    setArrivalLoading(true);
    try {
      const result = await sendOrderArrivalNoticeFn({ data: { orderId } });
      if (!result.ok) throw new Error(result.error || "Falha ao enviar aviso");
      toast.success("Cliente avisado pelo WhatsApp: o pedido chegou!");
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível avisar o cliente");
    } finally {
      setArrivalLoading(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    const reason = window.prompt("Motivo do cancelamento:") ?? "";
    if (!window.confirm(`Cancelar ${orderDisplayRef(order as any)}?`)) return;
    const { error } = await supabase.from("orders").update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason.trim() || null,
    }).eq("id", orderId);
    if (error) return toast.error(error.message);
    toast.success("Pedido cancelado");
    onChanged();
    onClose();
  }

  const address = order
    ? [order.address_street, order.address_number, order.address_complement, order.address_neighborhood, order.address_city]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className="fixed inset-0 z-[90]">
      <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/35 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="animate-in slide-in-from-right absolute inset-y-0 right-0 flex w-full flex-col bg-[#f8f7f4] shadow-2xl duration-300 lg:w-1/2 lg:min-w-[620px]">
        <div className="flex items-center justify-between border-b bg-zinc-950 px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#ffcf00] px-2.5 py-1 text-[10px] font-black uppercase text-zinc-950">Resumo do pedido</span>
              {order && <span className="font-black">{orderDisplayRef(order as any)}</span>}
            </div>
            <p className="mt-1 truncate text-sm text-white/70">{order?.customer_name || "Carregando..."}</p>
          </div>
          <Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>

        {loading || !order ? (
          <div className="grid flex-1 place-items-center text-sm text-zinc-500">Carregando pedido...</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-black uppercase text-zinc-400">Origem</p>
                    <p className="mt-1 font-bold">{sourceLabel(order.source)}</p>
                  </div>
                  <div className="rounded-2xl border bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-black uppercase text-zinc-400">Recebido</p>
                    <p className="mt-1 font-bold">{formatDateTime(order.created_at)}</p>
                  </div>
                  <div className="rounded-2xl border bg-white p-3 shadow-sm">
                    <p className="text-[10px] font-black uppercase text-zinc-400">Pagamento</p>
                    <p className="mt-1 font-bold">{paymentLabel(order)}</p>
                  </div>
                  <div className="rounded-2xl border bg-zinc-950 p-3 text-white shadow-sm">
                    <p className="text-[10px] font-black uppercase text-white/50">Total</p>
                    <p className="mt-1 text-lg font-black text-[#ffcf00]">{brl(Number(order.total || 0))}</p>
                  </div>
                </div>

                <Card className="overflow-hidden rounded-2xl border-0 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <h3 className="font-black">Cliente e entrega</h3>
                      <p className="text-xs text-zinc-500">Dados usados para atendimento e entrega.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={beginEdit}>
                      <Edit3 className="mr-2 size-4" /> Editar tudo
                    </Button>
                  </div>
                  <div className="grid gap-3 p-4 sm:grid-cols-2">
                    <div className="flex gap-3 rounded-xl bg-zinc-50 p-3">
                      <User className="mt-0.5 size-4 shrink-0 text-red-500" />
                      <div><p className="text-[10px] font-black uppercase text-zinc-400">Cliente</p><p className="font-bold">{order.customer_name}</p></div>
                    </div>
                    <div className="flex gap-3 rounded-xl bg-zinc-50 p-3">
                      <Phone className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      <div><p className="text-[10px] font-black uppercase text-zinc-400">Telefone</p><p className="font-bold">{formatPhone(order.customer_phone)}</p></div>
                    </div>
                    <div className="flex gap-3 rounded-xl bg-zinc-50 p-3 sm:col-span-2">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-red-500" />
                      <div className="min-w-0"><p className="text-[10px] font-black uppercase text-zinc-400">Endereço</p><p className="font-bold">{order.delivery_mode === "pickup" ? "Retirada na loja" : address || "Não informado"}</p>{order.address_reference && <p className="mt-1 text-xs text-zinc-500">Referência: {order.address_reference}</p>}</div>
                    </div>
                  </div>
                </Card>

                <Card className="overflow-hidden rounded-2xl border-0 bg-white shadow-sm">
                  <div className="border-b px-4 py-3">
                    <h3 className="font-black">Itens do pedido</h3>
                    <p className="text-xs text-zinc-500">Edite quantidade, preço, observações ou inclua qualquer item manualmente.</p>
                  </div>

                  <div className="divide-y">
                    {items.map((item) => (
                      <div key={item.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-sm font-black text-[#ffcf00]">{item.quantity}x</div>
                          <div className="min-w-0 flex-1">
                            <p className="font-black">{item.product_name}</p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-[80px_130px_1fr_auto]">
                              <Input type="number" min={1} defaultValue={item.quantity} className="h-8" onBlur={(e) => updateItem(item.id, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                              <Input inputMode="decimal" defaultValue={Number(item.unit_price || 0).toFixed(2)} className="h-8" onBlur={(e) => updateItem(item.id, { unit_price: Math.max(0, Number(String(e.target.value).replace(",", ".")) || 0) })} />
                              <Input defaultValue={item.notes || ""} placeholder="Observação / adicionais" className="h-8" onBlur={(e) => updateItem(item.id, { notes: e.target.value.trim() || null })} />
                              <Button size="icon" variant="ghost" className="size-8 text-red-500" onClick={() => deleteItem(item.id)}><Trash2 className="size-4" /></Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t bg-zinc-50 p-4">
                    <p className="mb-2 text-xs font-black uppercase text-zinc-500">Adicionar do cardápio</p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_80px_auto]">
                      <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm">
                        <option value="">Selecione um produto...</option>
                        {products.map((product: any) => (
                          <option key={product.id} value={product.id}>{product.name}</option>
                        ))}
                      </select>
                      <Input type="number" min={1} value={addQty} onChange={(e) => setAddQty(Math.max(1, Number(e.target.value) || 1))} />
                      <Button onClick={addCatalogProduct} disabled={!addProductId}><PlusCircle className="mr-2 size-4" /> Adicionar</Button>
                    </div>

                    <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-3">
                      <p className="text-sm font-black">Adicionar qualquer coisa manualmente</p>
                      <p className="mt-0.5 text-xs text-zinc-500">Ex.: bacon extra, bebida, cortesia, cobrança adicional ou item fora do cardápio.</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-[1.3fr_70px_110px_1.2fr_auto]">
                        <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Nome do item" />
                        <Input type="number" min={1} value={manualQty} onChange={(e) => setManualQty(Math.max(1, Number(e.target.value) || 1))} />
                        <Input value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="Preço" />
                        <Input value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="Observação" />
                        <Button onClick={addManualItem}><Plus className="mr-1 size-4" /> Incluir</Button>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="rounded-2xl border-0 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between"><span className="text-sm text-zinc-500">Subtotal</span><b>{brl(Number(order.subtotal || 0))}</b></div>
                  <div className="mt-2 flex items-center justify-between"><span className="text-sm text-zinc-500">Taxa de entrega</span><b>{brl(Number(order.delivery_fee || 0))}</b></div>
                  {Number(order.coupon_discount || 0) > 0 && <div className="mt-2 flex items-center justify-between text-emerald-700"><span className="text-sm">Desconto</span><b>- {brl(Number(order.coupon_discount || 0))}</b></div>}
                  <div className="mt-3 flex items-center justify-between border-t pt-3"><span className="font-black">Total a pagar</span><span className="text-xl font-black">{brl(Number(order.total || 0))}</span></div>
                </Card>

                {editing && (
                  <Card className="rounded-2xl border-2 border-[#ffcf00] bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3"><div><h3 className="font-black">Editar pedido</h3><p className="text-xs text-zinc-500">Altere endereço, cliente, taxa, total e pagamento.</p></div><Button size="icon" variant="ghost" onClick={() => setEditing(false)}><X className="size-4" /></Button></div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Input value={draft.customer_name || ""} onChange={(e) => setDraft((d) => ({ ...d, customer_name: e.target.value }))} placeholder="Nome" />
                      <Input value={draft.customer_phone || ""} onChange={(e) => setDraft((d) => ({ ...d, customer_phone: e.target.value }))} placeholder="Telefone" />
                      <Input value={draft.address_street || ""} onChange={(e) => setDraft((d) => ({ ...d, address_street: e.target.value }))} placeholder="Rua" />
                      <Input value={draft.address_number || ""} onChange={(e) => setDraft((d) => ({ ...d, address_number: e.target.value }))} placeholder="Número" />
                      <Input value={draft.address_complement || ""} onChange={(e) => setDraft((d) => ({ ...d, address_complement: e.target.value }))} placeholder="Complemento" />
                      <Input value={draft.address_neighborhood || ""} onChange={(e) => setDraft((d) => ({ ...d, address_neighborhood: e.target.value }))} placeholder="Bairro" />
                      <Input value={draft.address_city || ""} onChange={(e) => setDraft((d) => ({ ...d, address_city: e.target.value }))} placeholder="Cidade" />
                      <Input value={draft.address_cep || ""} onChange={(e) => setDraft((d) => ({ ...d, address_cep: e.target.value }))} placeholder="CEP" />
                      <Input value={draft.address_reference || ""} onChange={(e) => setDraft((d) => ({ ...d, address_reference: e.target.value }))} placeholder="Referência" className="sm:col-span-2" />
                      <div><label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Taxa de entrega</label><Input inputMode="decimal" value={draft.delivery_fee ?? 0} onChange={(e) => setDraft((d) => ({ ...d, delivery_fee: e.target.value }))} /></div>
                      <div><label className="mb-1 block text-[10px] font-black uppercase text-zinc-400">Total final manual</label><Input inputMode="decimal" value={draft.total ?? 0} onChange={(e) => setDraft((d) => ({ ...d, total: e.target.value }))} /></div>
                      <select className="h-10 rounded-xl border bg-white px-3 text-sm" value={draft.payment_method || ""} onChange={(e) => setDraft((d) => ({ ...d, payment_method: e.target.value }))}><option value="pix">PIX</option><option value="card">Cartão</option></select>
                      <select className="h-10 rounded-xl border bg-white px-3 text-sm" value={draft.payment_status || "pending"} onChange={(e) => setDraft((d) => ({ ...d, payment_status: e.target.value }))}><option value="pending">Pendente</option><option value="paid">Pago</option><option value="failed">Falhou</option></select>
                      <textarea className="min-h-20 rounded-xl border bg-white px-3 py-2 text-sm sm:col-span-2" value={draft.notes || ""} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Observações do pedido" />
                    </div>
                    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button><Button onClick={saveOrder} disabled={saving}><Check className="mr-2 size-4" /> {saving ? "Salvando..." : "Salvar alterações"}</Button></div>
                  </Card>
                )}
              </div>
            </div>

            <div className="border-t bg-white px-5 py-4 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex flex-wrap gap-2">
                {order.customer_phone && (
                  <a href={`https://wa.me/55${onlyDigits(order.customer_phone).replace(/^55/, "")}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold hover:bg-zinc-50">
                    <MessageCircle className="size-4 text-emerald-600" /> WhatsApp
                  </a>
                )}
                {order.delivery_mode !== "pickup" && order.status === "out_for_delivery" && (
                  <Button variant="outline" className="border-amber-300 bg-amber-50 text-amber-800" onClick={sendArrival} disabled={arrivalLoading}>
                    <MessageCircle className="mr-2 size-4" /> {arrivalLoading ? "Avisando..." : "Avisar que chegou"}
                  </Button>
                )}
                {order.status === "out_for_delivery" && <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus("delivered")}><CheckCircle2 className="mr-2 size-4" /> Entregue</Button>}
                {order.status === "ready_pickup" && <Button className="bg-[#ffcf00] text-zinc-950 hover:bg-[#f2c300]" onClick={() => updateStatus(order.delivery_mode === "pickup" ? "delivered" : "out_for_delivery")}><Bike className="mr-2 size-4" /> {order.delivery_mode === "pickup" ? "Retirado" : "Saiu para entrega"}</Button>}
                {order.status === "preparing" && <Button className="bg-[#ffcf00] text-zinc-950 hover:bg-[#f2c300]" onClick={() => updateStatus("ready_pickup")}><Package className="mr-2 size-4" /> Marcar pronto</Button>}
                {["pending", "pending_review"].includes(order.status) && <Button className="bg-[#ffcf00] text-zinc-950 hover:bg-[#f2c300]" onClick={() => updateStatus("preparing")}><ChefHat className="mr-2 size-4" /> Iniciar preparo</Button>}
                {! ["delivered", "cancelled", "failed"].includes(order.status) && <Button variant="destructive" className="ml-auto" onClick={cancelOrder}><XCircle className="mr-2 size-4" /> Cancelar pedido</Button>}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function OrdersBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alarmOn, setAlarmOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [search, setSearch] = useState("");
  const [unreadByPhone, setUnreadByPhone] = useState<Record<string, boolean>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [arrivalOrderId, setArrivalOrderId] = useState<string | null>(null);
  const previousPendingRef = useRef(0);

  async function loadOrders() {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", ACTIVE_STATUSES as any)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error(error.message);
    } else {
      setOrders((data as any[]) || []);
    }
    setLoading(false);
  }

  async function loadUnread() {
    const { data } = await supabase.from("whatsapp_conversations").select("phone,has_unread,unread_count");
    const next: Record<string, boolean> = {};
    for (const row of data || []) {
      const key = onlyDigits((row as any).phone);
      if (key) next[key] = Boolean((row as any).has_unread || Number((row as any).unread_count || 0) > 0);
    }
    setUnreadByPhone(next);
  }

  useEffect(() => {
    void loadOrders();
    void loadUnread();

    const ordersChannel = supabase
      .channel("hotbox-orders-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void loadOrders())
      .subscribe();

    const chatChannel = supabase
      .channel("hotbox-orders-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => void loadUnread())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: "direction=eq.in" }, () => void loadUnread())
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(chatChannel);
    };
  }, []);

  const pendingCount = orders.filter((order) => ["pending", "pending_review"].includes(order.status)).length;

  useEffect(() => {
    if (!alarmOn) {
      pauseAlarm();
      stopAlarmBeep();
      return;
    }
    if (pendingCount > 0 && pendingCount >= previousPendingRef.current) {
      playAlarm();
      playAlarmBeep();
    } else if (pendingCount === 0) {
      pauseAlarm();
      stopAlarmBeep();
    }
    previousPendingRef.current = pendingCount;
    return () => stopAlarmBeep();
  }, [pendingCount, alarmOn]);

  async function enableSound() {
    try {
      await primeBeepUnlock();
      const src = await getAlarmAudio();
      if (src) setAlarmSrc(src);
      setSoundReady(true);
      toast.success("Som dos pedidos ativado");
    } catch {
      toast.error("Não foi possível ativar o som");
    }
  }

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => [order.customer_name, order.customer_phone, order.order_number, order.external_display_id].some((value) => String(value || "").toLowerCase().includes(q)));
  }, [orders, search]);

  const columns = useMemo(() => ({
    preparing: filteredOrders.filter((order) => ["pending", "pending_review", "preparing"].includes(order.status)),
    ready: filteredOrders.filter((order) => order.status === "ready_pickup"),
    delivery: filteredOrders.filter((order) => order.status === "out_for_delivery"),
  }), [filteredOrders]);

  async function advance(order: Order) {
    let next = "ready_pickup";
    if (["pending", "pending_review"].includes(order.status)) next = "preparing";
    else if (order.status === "preparing") next = "ready_pickup";
    else if (order.status === "ready_pickup") next = order.delivery_mode === "pickup" ? "delivered" : "out_for_delivery";
    else if (order.status === "out_for_delivery") next = "delivered";

    if (
      next === "preparing" &&
      order.payment_method === "pix" &&
      order.payment_timing === "now" &&
      order.payment_status !== "paid" &&
      !window.confirm("Este pedido ainda não consta como pago via PIX. Iniciar preparo mesmo assim?")
    ) return;

    setBusyOrderId(order.id);
    try {
      const now = new Date().toISOString();
      const patch: any = { status: next };
      if (next === "preparing") patch.accepted_at = now;
      if (next === "ready_pickup") patch.ready_at = now;
      if (next === "out_for_delivery") patch.out_for_delivery_at = now;
      if (next === "delivered") patch.delivered_at = now;
      const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
      if (error) throw error;
      if (["pending", "pending_review"].includes(order.status) && next === "preparing") requestAutoPrint(order.id);
      if (order.source === "ifood") {
        try { await pushIfoodStatusFn({ data: { orderId: order.id, newStatus: next } }); } catch (error) { console.error(error); }
      }
      if (order.source === "99food") {
        try { await pushNfoodStatusFn({ data: { orderId: order.id, newStatus: next } }); } catch (error) { console.error(error); }
      }
      toast.success(next === "delivered" ? "Pedido entregue" : "Pedido avançado");
      await loadOrders();
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível atualizar o pedido");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function sendArrival(order: Order) {
    setArrivalOrderId(order.id);
    try {
      const result = await sendOrderArrivalNoticeFn({ data: { orderId: order.id } });
      if (!result.ok) throw new Error(result.error || "Falha ao enviar aviso");
      toast.success("Cliente avisado pelo WhatsApp: o pedido chegou!");
    } catch (error: any) {
      toast.error(error?.message || "Não foi possível avisar o cliente");
    } finally {
      setArrivalOrderId(null);
    }
  }

  async function cancel(order: Order) {
    const reason = window.prompt("Motivo do cancelamento:") ?? "";
    if (!window.confirm(`Cancelar ${orderDisplayRef(order as any)}?`)) return;
    const { error } = await supabase.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason.trim() || null }).eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success("Pedido cancelado");
    await loadOrders();
    if (selectedOrderId === order.id) setSelectedOrderId(null);
  }

  const columnDefinitions = [
    { key: "preparing", title: "Em preparo", subtitle: "Novos pedidos e pedidos sendo preparados", icon: ChefHat, count: columns.preparing.length, accent: "bg-orange-500" },
    { key: "ready", title: "Pronto", subtitle: "Pedidos finalizados aguardando saída", icon: Package, count: columns.ready.length, accent: "bg-sky-500" },
    { key: "delivery", title: "Saiu para entrega", subtitle: "Pedidos a caminho do cliente", icon: Bike, count: columns.delivery.length, accent: "bg-emerald-500" },
  ] as const;

  return (
    <div className="min-h-[calc(100vh-72px)] bg-[#f4f2ed] px-3 py-4 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <div className="overflow-hidden rounded-3xl bg-zinc-950 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-6">
            <div>
              <div className="flex items-center gap-2"><span className="rounded-full bg-[#ffcf00] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-950">Operação HotBox</span>{pendingCount > 0 && <span className="rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-black uppercase text-white">{pendingCount} novo(s)</span>}</div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Central de pedidos</h1>
              <p className="mt-1 text-sm text-white/60">Fluxo visual em 3 etapas. Clique em qualquer pedido para abrir o resumo completo.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative hidden sm:block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido..." className="w-64 border-white/10 bg-white/10 pl-9 text-white placeholder:text-white/40" /></div>
              {!soundReady && <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={enableSound}><Bell className="mr-2 size-4" /> Ativar som</Button>}
              <Button variant="outline" size="icon" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => setAlarmOn((value) => !value)} title={alarmOn ? "Desligar alarme" : "Ligar alarme"}>{alarmOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}</Button>
              <Button variant="outline" size="icon" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={loadOrders}><RefreshCw className="size-4" /></Button>
              <Button className="bg-[#ffcf00] font-black text-zinc-950 hover:bg-[#f2c300]" onClick={() => setManualOpen(true)}><PackagePlus className="mr-2 size-4" /> Novo pedido</Button>
            </div>
          </div>
        </div>

        <div className="relative sm:hidden"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido..." className="bg-white pl-9" /></div>

        <div className="grid gap-4 xl:grid-cols-3">
          {columnDefinitions.map((column) => {
            const Icon = column.icon;
            const list = columns[column.key];
            return (
              <section key={column.key} className="flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-[#ebe9e3] shadow-sm">
                <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-4 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`grid size-10 place-items-center rounded-2xl text-white shadow-sm ${column.accent}`}><Icon className="size-5" /></span>
                      <div><h2 className="text-lg font-black text-zinc-950">{column.title}</h2><p className="text-[11px] text-zinc-500">{column.subtitle}</p></div>
                    </div>
                    <span className="grid min-w-9 place-items-center rounded-full bg-zinc-950 px-2.5 py-1.5 text-xs font-black text-white">{column.count}</span>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4 xl:max-h-[calc(100vh-250px)]">
                  {loading ? (
                    <div className="grid min-h-52 place-items-center text-sm text-zinc-400">Carregando pedidos...</div>
                  ) : list.length === 0 ? (
                    <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-6 text-center"><div><Icon className="mx-auto size-7 text-zinc-300" /><p className="mt-2 text-sm font-bold text-zinc-500">Nenhum pedido aqui</p><p className="mt-1 text-xs text-zinc-400">Quando o status mudar, o pedido aparecerá nesta coluna.</p></div></div>
                  ) : (
                    list.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        unread={Boolean(unreadByPhone[onlyDigits(order.customer_phone)] || unreadByPhone[onlyDigits(order.customer_phone).replace(/^55/, "")])}
                        onOpen={() => setSelectedOrderId(order.id)}
                        onAdvance={() => void advance(order)}
                        onArrival={() => void sendArrival(order)}
                        onCancel={() => void cancel(order)}
                        advancing={busyOrderId === order.id}
                        arrivalLoading={arrivalOrderId === order.id}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <OrderDrawer orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} onChanged={() => void loadOrders()} />
      <ManualOrderDialog open={manualOpen} onOpenChange={setManualOpen} onCreated={() => { setManualOpen(false); void loadOrders(); }} />
    </div>
  );
}

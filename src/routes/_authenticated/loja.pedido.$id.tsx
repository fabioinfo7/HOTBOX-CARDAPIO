import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brasiliaDateISO } from "@/lib/brasilia-date";
import { pushIfoodStatusFn } from "@/lib/ifood-push.functions";
import { pushNfoodStatusFn } from "@/lib/nfood-push.functions";
import { sendOrderArrivalNoticeFn } from "@/lib/order-notifications.functions";
import { confirmSitePaymentFn } from "@/lib/site-payment.functions";
import {
  brl,
  formatDateTime,
  formatPhone,
  orderNumberFmt,
  orderDisplayRef,
  ORDER_STATUS_LABEL,
} from "@/lib/formatters";
import { StatusBadge } from "@/components/order-status-badge";
import { PrintReceipt } from "@/components/print-receipt";
import { requestAutoPrint } from "@/components/auto-print-receipt";
import { formatBusinessHoursText } from "@/lib/business-hours";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Printer,
  ArrowLeft,
  XCircle,
  CheckCircle2,
  MapPin,
  Wallet,
  User,
  Phone,
  Sparkles,
  Bike as BikeIcon,
  MessageCircle,
  UtensilsCrossed,
  Store,
  AlertCircle,
  RotateCcw,
  History,
  Save,
  PlusCircle,
  Pencil,
  UserRoundCheck,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/loja/pedido/$id")({
  component: OrderDetail,
  validateSearch: (search: Record<string, unknown>) => {
    const out: { print?: string } = {};
    if (typeof search.print === "string") out.print = search.print;
    return out;
  },
});

function OrderDetail() {
  const nav = useNavigate();
  const { id } = Route.useParams();
  const { print: autoPrint } = Route.useSearch();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [hasPrinted, setHasPrinted] = useState(false);
  const [lastStatusChange, setLastStatusChange] = useState<{
    oldStatus: string;
    changedAt: string;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [sendingArrivalNotice, setSendingArrivalNotice] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [businessHoursText, setBusinessHoursText] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addQuantity, setAddQuantity] = useState(1);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<string, any>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  async function reopenOrder() {
    if (!window.confirm("Reabrir esse pedido? Ele volta pra fila como pendente, como se tivesse acabado de chegar."))
      return;
    setReopening(true);
    try {
      const { error } = await supabase.from("orders").update({ status: "pending", cancel_reason: null }).eq("id", id);
      if (error) throw error;
      toast.success("Pedido reaberto!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao reabrir pedido");
    } finally {
      setReopening(false);
    }
  }

  useEffect(() => {
    const load = async () => {
      const { data: o } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      setOrder(o);
      const { data: it } = await supabase.from("order_items").select("*").eq("order_id", id).order("created_at");
      setItems(it ?? []);
      const [{ data: productRows }, { data: auditTrail }] = await Promise.all([
        supabase.from("products").select("id,name,sale_price,promotion_active,promotion_price,active").eq("active", true).order("name"),
        supabase.from("audit_log").select("id,action,old_data,new_data,created_at,user_email").eq("table_name", "orders").eq("record_id", id).order("created_at", { ascending: false }).limit(20),
      ]);
      setProducts(productRows ?? []);
      setAuditRows(auditTrail ?? []);

      // horário de atendimento configurado — impresso no rodapé da nota
      const { data: hoursCfg } = await (supabase as any)
        .from("store_config")
        .select("business_hours_enabled, business_hours")
        .maybeSingle();
      if (
        hoursCfg?.business_hours_enabled &&
        Array.isArray(hoursCfg.business_hours) &&
        hoursCfg.business_hours.length
      ) {
        setBusinessHoursText(formatBusinessHoursText(hoursCfg.business_hours));
      }

      // busca a última mudança de status desse pedido na trilha de auditoria,
      // pra oferecer "desfazer" caso tenha sido sem querer
      const { data: audit } = await supabase
        .from("audit_log")
        .select("old_data, new_data, created_at")
        .eq("table_name", "orders")
        .eq("record_id", id)
        .eq("action", "UPDATE")
        .order("created_at", { ascending: false })
        .limit(5);
      const statusChange = (audit ?? []).find(
        (a: any) => a.old_data?.status && a.new_data?.status && a.old_data.status !== a.new_data.status,
      );
      setLastStatusChange(
        statusChange
          ? {
              oldStatus: (statusChange.old_data as any).status as string,
              changedAt: statusChange.created_at,
            }
          : null,
      );
    };
    load();
    const ch = supabase
      .channel(`admin-order-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  async function undoStatusChange() {
    if (!lastStatusChange) return;
    if (!window.confirm(`Voltar o status desse pedido pra "${lastStatusChange.oldStatus}"?`)) return;
    setUndoing(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: lastStatusChange.oldStatus as any })
        .eq("id", id);
      if (error) throw error;
      toast.success("Status revertido!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao desfazer");
    } finally {
      setUndoing(false);
    }
  }

  useEffect(() => {
    if (autoPrint === "1" && order && !hasPrinted) {
      setHasPrinted(true);
      setTimeout(() => window.print(), 300);
    }
  }, [autoPrint, order, hasPrinted]);

  if (!order) return <div className="grid min-h-[50vh] place-items-center text-muted-foreground">Carregando...</div>;

  async function updateStatus(status: string, extra: Record<string, any> = {}) {
    if (
      status === "preparing" &&
      order.payment_method === "pix" &&
      order.payment_timing === "now" &&
      order.payment_status !== "paid"
    ) {
      const proceed = window.confirm(
        `⚠️ O pedido ${orderDisplayRef(order)} ainda NÃO foi pago via Pix.\n\nTem certeza que quer começar o preparo mesmo assim?`,
      );
      if (!proceed) return;
    }
    const now = new Date().toISOString();
    const patch: any = { status, ...extra };
    if (status === "preparing") patch.accepted_at = now;
    if (status === "ready_pickup") patch.ready_at = now;
    if (status === "out_for_delivery") patch.out_for_delivery_at = now;
    if (status === "delivered") patch.delivered_at = now;
    const { error } = await supabase.from("orders").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Atualizado");

    // "Aceitar" = pending -> preparing. Dispara a nota automaticamente se a
    // impressão automática estiver ligada (Configurações).
    if (order?.status === "pending" && status === "preparing") {
      requestAutoPrint(id);
    }

    // pedidos da iFood: avisa a iFood DIRETAMENTE aqui também, além do
    // gatilho do banco — redundância com guard de idempotência
    if (order?.source === "ifood") {
      try {
        await pushIfoodStatusFn({ data: { orderId: id, newStatus: status } });
      } catch (err) {
        console.error("[ifood] push direto falhou (o gatilho do banco ainda pode cobrir):", err);
      }
    }
    // mesma redundância, mas pra 99Food — caminho totalmente separado do da iFood
    if (order?.source === "99food") {
      try {
        await pushNfoodStatusFn({ data: { orderId: id, newStatus: status } });
      } catch (err) {
        console.error("[99food] push direto falhou (o gatilho do banco ainda pode cobrir):", err);
      }
    }
  }


  async function sendArrivalNotice() {
    if (!order?.customer_phone || sendingArrivalNotice) return;
    setSendingArrivalNotice(true);
    try {
      const result = await sendOrderArrivalNoticeFn({ data: { orderId: id } });
      if (!result.ok) return toast.error(result.error || "Não foi possível avisar o cliente.");
      toast.success("Cliente avisado pelo WhatsApp: pedido chegou!");
    } catch (err: any) {
      toast.error(String(err?.message ?? "Falha ao enviar aviso."));
    } finally {
      setSendingArrivalNotice(false);
    }
  }

  async function markFailed() {
    if (!reason.trim()) return toast.error("Informe o motivo da falha");
    await updateStatus("failed", { failure_reason: reason });
  }

  async function confirmFromReview() {
    if (order.payment_method === "pix" && order.payment_timing === "now" && order.payment_status !== "paid") {
      const proceed = window.confirm(
        `⚠️ O pedido ${orderDisplayRef(order)} ainda NÃO foi pago via Pix.\n\nSe aceitar agora, ele já entra em preparo. Tem certeza?`,
      );
      if (!proceed) return;
    }
    const { error } = await supabase
      .from("orders")
      .update({ status: "preparing", accepted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido confirmado e aceito!");
    if (order?.status === "pending_review") requestAutoPrint(id);
    nav({ to: "/loja" });
  }

  async function changePaymentMethod(value: "pix" | "card" | "cash" | "link" | "later") {
    if (value === "later") {
      if (order.payment_timing === "later") return;
      await markPayLater();
      return;
    }
    if (value === order.payment_method && order.payment_timing !== "later") return;
    const patch: any = { payment_method: value };
    if (order.payment_timing === "later") patch.payment_timing = null;
    const { error } = await supabase.from("orders").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOrder((prev: any) => (prev ? { ...prev, ...patch } : prev));
    toast.success("Forma de pagamento atualizada");
  }

  async function markPayLater() {
    const dueDate = window.prompt(
      "Data prevista para o pagamento (AAAA-MM-DD):",
      brasiliaDateISO(),
    );
    if (!dueDate) return;
    try {
      const { data: rec, error: recErr } = await supabase
        .from("receivables")
        .insert({
          customer_name: order.customer_name,
          description: `Pedido ${orderDisplayRef(order)} — pagar depois`,
          purchase_date: brasiliaDateISO(),
          order_id: id,
          due_date: dueDate,
          notes: order.notes ?? null,
        })
        .select("id")
        .single();
      if (recErr || !rec) throw recErr;

      const recItems = items.map((it: any) => ({
        receivable_id: rec.id,
        product_id: it.product_id,
        description: it.product_name || "Item",
        quantity: it.quantity,
        unit_price: it.unit_price,
        cost_price: 0,
      }));
      if (Number(order.delivery_fee) > 0) {
        recItems.push({
          receivable_id: rec.id,
          product_id: null,
          description: "Taxa de entrega",
          quantity: 1,
          unit_price: Number(order.delivery_fee),
          cost_price: 0,
        });
      }
      if (recItems.length) {
        const { error: itemsErr } = await supabase.from("receivable_items").insert(recItems);
        if (itemsErr) throw itemsErr;
      }

      const { error } = await supabase
        .from("orders")
        .update({ payment_timing: "later", payment_status: "pending" })
        .eq("id", id);
      if (error) throw error;

      setOrder((prev: any) =>
        prev ? { ...prev, payment_timing: "later", payment_status: "pending" } : prev,
      );
      toast.success("Marcado para pagar depois e lançado em A Receber!");
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao lançar em A Receber");
    }
  }

  async function confirmPayment() {
    try {
      if (order.source === "site") {
        const result = await confirmSitePaymentFn({ data: { orderId: id } });
        if (!result.ok) return toast.error(result.error || "Falha ao confirmar pagamento");
        setOrder((prev: any) => prev ? { ...prev, payment_status: "paid", payment_timing: "now", status: prev.status === "pending_review" ? "pending" : prev.status } : prev);
        toast.success("Pagamento confirmado. Pedido liberado para o fluxo operacional e cliente avisado no WhatsApp.");
        return;
      }
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          payment_timing: order.payment_timing === "later" ? null : order.payment_timing,
          payment_confirmed_at: new Date().toISOString(),
          payment_confirmed_by: "admin",
        })
        .eq("id", id);
      if (error) toast.error(error.message);
      else toast.success("Pagamento confirmado");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao confirmar pagamento");
    }
  }

  async function cancelOrder() {
    if (!window.confirm(`Cancelar o pedido #${order.order_number}? Essa ação não pode ser desfeita.`)) return;
    const cancelReason = window.prompt("Motivo do cancelamento (opcional):") ?? "";
    const { error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason || null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Pedido cancelado");
  }

  async function syncOrderTotals() {
    const [{ data: freshItems, error: itemsError }, { data: freshOrder, error: orderError }] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", id).order("created_at"),
      supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    ]);
    if (itemsError) throw itemsError;
    if (orderError) throw orderError;
    if (!freshOrder) throw new Error("Pedido não encontrado");

    const subtotal = (freshItems ?? []).reduce(
      (sum: number, item: any) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
      0,
    );
    const deliveryFee = Number(freshOrder.delivery_fee || 0);
    const discount = Number(freshOrder.coupon_discount || 0);
    const total = Math.max(0, subtotal - discount) + deliveryFee;

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({ subtotal, total })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;

    setItems(freshItems ?? []);
    setOrder(updatedOrder ?? { ...freshOrder, subtotal, total });
  }

  async function editItem(itemId: string, patch: any) {
    const normalizedPatch = { ...patch };
    if ("quantity" in normalizedPatch) normalizedPatch.quantity = Math.max(1, Number(normalizedPatch.quantity) || 1);
    if ("unit_price" in normalizedPatch) normalizedPatch.unit_price = Math.max(0, Number(normalizedPatch.unit_price) || 0);

    const { error } = await supabase.from("order_items").update(normalizedPatch).eq("id", itemId);
    if (error) return toast.error(error.message);
    try {
      await syncOrderTotals();
      toast.success("Item e total atualizados");
    } catch (err: any) {
      toast.error(err.message ?? "Não foi possível sincronizar os totais");
    }
  }

  async function removeItem(itemId: string) {
    const { error } = await supabase.from("order_items").delete().eq("id", itemId);
    if (error) return toast.error(error.message);
    try {
      await syncOrderTotals();
      toast.success("Item removido e total atualizado");
    } catch (err: any) {
      toast.error(err.message ?? "Não foi possível sincronizar os totais");
    }
  }

  function openEditDialog() {
    setEditDraft({
      customer_name: order.customer_name ?? "",
      customer_phone: order.customer_phone ?? "",
      address_street: order.address_street ?? "",
      address_number: order.address_number ?? "",
      address_complement: order.address_complement ?? "",
      address_neighborhood: order.address_neighborhood ?? "",
      address_city: order.address_city ?? "",
      address_reference: order.address_reference ?? "",
      delivery_fee: order.delivery_fee ?? 0,
      notes: order.notes ?? "",
    });
    setEditDialogOpen(true);
  }

  async function saveEditDraft() {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      const patch: any = {
        customer_name: String(editDraft.customer_name || "").trim(),
        customer_phone: String(editDraft.customer_phone || "").replace(/\D/g, ""),
        address_street: String(editDraft.address_street || "").trim() || null,
        address_number: String(editDraft.address_number || "").trim() || null,
        address_complement: String(editDraft.address_complement || "").trim() || null,
        address_neighborhood: String(editDraft.address_neighborhood || "").trim() || null,
        address_city: String(editDraft.address_city || "").trim() || null,
        address_reference: String(editDraft.address_reference || "").trim() || null,
        delivery_fee: Math.max(0, Number(editDraft.delivery_fee) || 0),
        notes: String(editDraft.notes || "").trim() || null,
      };
      if (!patch.customer_name) return toast.error("Informe o nome do cliente.");
      if (!patch.customer_phone) return toast.error("Informe o telefone do cliente.");
      const { error } = await supabase.from("orders").update(patch).eq("id", id);
      if (error) throw error;
      await syncOrderTotals();
      setEditDialogOpen(false);
      toast.success("Alterações salvas com segurança");
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível salvar as alterações");
    } finally {
      setSavingDraft(false);
    }
  }

  async function addProductToOrder() {
    const product = products.find((p) => p.id === addProductId);
    if (!product) return toast.error("Selecione um produto do cardápio.");
    const quantity = Math.max(1, Number(addQuantity) || 1);
    const unitPrice = product.promotion_active && product.promotion_price != null ? Number(product.promotion_price) : Number(product.sale_price || 0);
    const existing = items.find((i: any) => i.product_id === product.id && Number(i.unit_price) === unitPrice);
    try {
      if (existing) {
        const { error } = await supabase.from("order_items").update({ quantity: Number(existing.quantity) + quantity }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("order_items").insert({
          order_id: id, product_id: product.id, product_name: product.name, quantity, unit_price: unitPrice,
          list_price: Number(product.sale_price || unitPrice), is_promotion_price: Boolean(product.promotion_active && product.promotion_price != null),
        });
        if (error) throw error;
      }
      setAddProductId(""); setAddQuantity(1);
      await syncOrderTotals();
      toast.success("Produto adicionado e total recalculado");
    } catch (err: any) { toast.error(err?.message ?? "Não foi possível adicionar o produto"); }
  }

  const isReview = order.status === "pending_review" && order.source !== "ifood" && order.source !== "99food";


  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link to="/loja">
          <Button variant="ghost" size="sm" className="rounded-full font-semibold">
            <ArrowLeft className="size-4" /> Voltar
          </Button>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full font-semibold" onClick={openEditDialog}>
            <Pencil className="size-4" /> CORRIGIR DADOS
          </Button>
          <Button variant="outline" className="rounded-full font-semibold" onClick={() => window.print()}>
            <Printer className="size-4" /> IMPRIMIR PEDIDO
          </Button>
        </div>
      </div>

      {isReview && (
        <div className="no-print overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-400/90 text-white shadow-sm">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h2 className="text-[18px] font-extrabold text-amber-900">
                  Pedido interpretado pela IA — revise antes de confirmar
                </h2>
                <p className="text-sm text-amber-800/80">
                  Confira nome, endereço e itens abaixo. Assim que estiver tudo certo, confirme para entrar na fila de
                  preparo.
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="rounded-full bg-amber-500 px-6 font-bold text-white shadow-md hover:bg-amber-600"
              onClick={confirmFromReview}
            >
              <CheckCircle2 className="size-5" /> Confirmar e aceitar pedido
            </Button>
          </div>
        </div>
      )}

      <div className="no-print grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl p-0 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between gap-2 bg-foreground px-6 py-3.5">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-background/70">
              {order.source === "whatsapp" && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                  <MessageCircle className="size-3" /> WhatsApp
                </span>
              )}
              {order.source === "ifood" && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                  <UtensilsCrossed className="size-3" /> iFood
                </span>
              )}
              {order.source === "99food" && (
                <span className="flex items-center gap-1 rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-[10px] font-bold text-yellow-300">
                  <UtensilsCrossed className="size-3" /> 99Food
                </span>
              )}
              Pedido: {orderDisplayRef(order)} · {formatDateTime(order.created_at)}
            </span>
            <StatusBadge
              status={order.status}
              label={
                order.status === "ready_pickup" && order.delivery_mode === "pickup"
                  ? "Aguardando Retirada do Cliente"
                  : undefined
              }
            />
          </div>
          {(order.assigned_operator_email || order.assigned_operator_id) && (
            <div className="flex items-center gap-1.5 border-b bg-blue-50 px-6 py-2 text-xs font-semibold text-blue-800">
              <UserRoundCheck className="size-3.5" /> Atendimento por {order.assigned_operator_email || "operador identificado"}
            </div>
          )}

          <div className="space-y-2 px-6 pt-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <User className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Nome do cliente · editável</p>
                <Input
                  className="h-10 text-[18px] font-extrabold uppercase"
                  defaultValue={order.customer_name ?? ""}
                  onBlur={async (e) => {
                    const value = e.target.value.trim();
                    if (!value || value === order.customer_name) return;
                    const { error } = await supabase.from("orders").update({ customer_name: value }).eq("id", id);
                    if (error) return toast.error(error.message);
                    setOrder((prev: any) => prev ? { ...prev, customer_name: value } : prev);
                    toast.success("Nome do cliente atualizado");
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center">
                <Phone className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Telefone · editável</p>
                <Input
                  className="h-9 text-[15px]"
                  defaultValue={order.customer_phone ?? ""}
                  onBlur={async (e) => {
                    const value = e.target.value.replace(/\D/g, "");
                    if (!value || value === String(order.customer_phone || "").replace(/\D/g, "")) return;
                    const { error } = await supabase.from("orders").update({ customer_phone: value }).eq("id", id);
                    if (error) return toast.error(error.message);
                    setOrder((prev: any) => prev ? { ...prev, customer_phone: value } : prev);
                    toast.success("Telefone do cliente atualizado");
                  }}
                />
              </div>
            </div>
            {order.customer_phone && (
              <div className="mt-2 flex flex-wrap gap-2 pl-11">
                <a
                  href={`https://wa.me/${String(order.customer_phone).replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-600"
                >
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
                <a
                  href={`tel:+${String(order.customer_phone).replace(/\D/g, "")}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-bold text-background shadow-sm transition hover:opacity-90"
                >
                  <Phone className="size-4" /> Ligar
                </a>
                {order.delivery_mode !== "pickup" && (order.address_street || order.address_neighborhood) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([order.address_street, order.address_number, order.address_complement, order.address_neighborhood, order.address_city].filter(Boolean).join(", "))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700"
                  >
                    <MapPin className="size-4" /> Abrir mapa
                  </a>
                )}
                {order.delivery_mode !== "pickup" && ["out_for_delivery", "delivered"].includes(order.status) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full border-amber-300 bg-amber-50 font-bold text-amber-800 hover:bg-amber-100"
                    onClick={sendArrivalNotice}
                    disabled={sendingArrivalNotice}
                    title="Enviar WhatsApp avisando que o pedido chegou"
                  >
                    <MessageCircle className="size-4" />
                    {sendingArrivalNotice ? "Enviando..." : "Pedido chegou"}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2.5 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Itens do pedido</h3>
              <div className="flex min-w-0 flex-1 justify-end gap-2">
                <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className="h-9 min-w-0 max-w-xs rounded-md border bg-background px-2 text-xs">
                  <option value="">Adicionar produto do cardápio...</option>
                  {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {brl(p.promotion_active && p.promotion_price != null ? p.promotion_price : p.sale_price)}</option>)}
                </select>
                <Input type="number" min={1} className="h-9 w-16" value={addQuantity} onChange={(e) => setAddQuantity(Math.max(1, Number(e.target.value) || 1))} />
                <Button size="sm" className="h-9" onClick={addProductToOrder} disabled={!addProductId}><PlusCircle className="size-4" /> Adicionar</Button>
              </div>
            </div>
            {items.map((i) => (
              <div
                key={i.id}
                className={`rounded-xl border p-3 ${Number(i.unit_price) === 0 ? "border-2 border-destructive bg-destructive/5" : "bg-muted/20"}`}
              >
                {Number(i.unit_price) === 0 && (
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-destructive">
                    <AlertCircle className="size-3.5" /> Preço zerado — confira se esse item bate com o cardápio antes
                    de aceitar
                  </p>
                )}
                {i.is_promotion_price && (
                  <p className="mb-2 text-xs font-bold text-fuchsia-600">
                    🏷 Vendido em promoção{i.list_price ? ` (preço normal: ${brl(i.list_price)})` : ""}
                  </p>
                )}
                <div className="grid grid-cols-12 items-center gap-2">
                  <Input
                    className="col-span-5 border-none bg-transparent text-[15px] font-semibold shadow-none focus-visible:ring-1"
                    defaultValue={i.product_name}
                    onBlur={(e) => editItem(i.id, { product_name: e.target.value })}
                  />
                  <Input
                    className="col-span-2 bg-background text-center text-[15px]"
                    type="number"
                    defaultValue={i.quantity}
                    min={1}
                    onBlur={(e) => editItem(i.id, { quantity: Number(e.target.value) })}
                  />
                  <Input
                    className="col-span-2 bg-background text-[15px]"
                    type="number"
                    step="0.01"
                    defaultValue={i.unit_price}
                    onBlur={(e) => editItem(i.id, { unit_price: Number(e.target.value) })}
                  />
                  <span className="col-span-2 text-right text-[17px] font-extrabold text-primary">
                    {brl(i.unit_price * i.quantity)}
                  </span>
                  <Button className="col-span-1" size="icon" variant="ghost" onClick={() => removeItem(i.id)}>
                    <XCircle className="size-4 text-muted-foreground" />
                  </Button>
                </div>
                {i.notes && <p className="mt-1.5 pl-1 text-sm italic text-muted-foreground">Obs: {i.notes}</p>}
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t bg-muted/20 px-6 py-4 text-[16px]">
            <div className="flex justify-between text-foreground/70">
              <span>Subtotal</span>
              <span>{brl(order.subtotal)}</span>
            </div>
            {order.coupon_code && Number(order.coupon_discount) > 0 && (
              <div className="flex justify-between font-semibold text-emerald-600">
                <span>🎟 Cupom {order.coupon_code}</span>
                <span>-{brl(order.coupon_discount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 text-foreground/70">
              <span className="whitespace-nowrap">
                Entrega
                {order.delivery_distance_km != null ? ` (${Number(order.delivery_distance_km).toFixed(1)} km)` : ""}
              </span>
              <Input
                type="number"
                step="0.01"
                className="h-9 max-w-[130px] text-right text-[15px]"
                defaultValue={order.delivery_fee ?? 0}
                onBlur={async (e) => {
                  const newFee = Math.max(0, Number(e.target.value) || 0);
                  const { error } = await supabase.from("orders").update({ delivery_fee: newFee }).eq("id", id);
                  if (error) return toast.error(error.message);
                  try {
                    await syncOrderTotals();
                    toast.success("Taxa e total atualizados");
                  } catch (err: any) {
                    toast.error(err.message ?? "Não foi possível sincronizar os totais");
                  }
                }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-dashed pt-2.5">
              <span className="text-[15px] font-bold uppercase tracking-wide">Total</span>
              <div className="min-w-[150px] text-right text-[22px] font-extrabold text-primary">
                {brl(order.total ?? 0)}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold uppercase tracking-wide text-muted-foreground">
              <MapPin className="size-4" /> {order.delivery_mode === "pickup" ? "Retirada" : "Entrega"}
            </h3>
            {order.delivery_mode === "pickup" ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-[16px] font-bold text-blue-700">
                <Store className="size-4" /> Cliente vai retirar na loja
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <Input
                    className="col-span-3 text-[15px]"
                    placeholder="Rua"
                    defaultValue={order.address_street ?? ""}
                    onBlur={async (e) => {
                      await supabase.from("orders").update({ address_street: e.target.value }).eq("id", id);
                    }}
                  />
                  <Input
                    className="col-span-1 text-[15px]"
                    placeholder="Nº"
                    defaultValue={order.address_number ?? ""}
                    onBlur={async (e) => {
                      await supabase.from("orders").update({ address_number: e.target.value }).eq("id", id);
                    }}
                  />
                </div>
                <Input
                  className="text-[15px]"
                  placeholder="Complemento"
                  defaultValue={order.address_complement ?? ""}
                  onBlur={async (e) => {
                    await supabase
                      .from("orders")
                      .update({ address_complement: e.target.value || null })
                      .eq("id", id);
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="text-[15px]"
                    placeholder="Bairro"
                    defaultValue={order.address_neighborhood ?? ""}
                    onBlur={async (e) => {
                      await supabase.from("orders").update({ address_neighborhood: e.target.value }).eq("id", id);
                    }}
                  />
                  <Input
                    className="text-[15px]"
                    placeholder="Cidade"
                    defaultValue={order.address_city ?? ""}
                    onBlur={async (e) => {
                      await supabase.from("orders").update({ address_city: e.target.value }).eq("id", id);
                    }}
                  />
                </div>
                <Input
                  className="text-[15px]"
                  placeholder="Ponto de referência"
                  defaultValue={order.address_reference ?? ""}
                  onBlur={async (e) => {
                    await supabase
                      .from("orders")
                      .update({ address_reference: e.target.value || null })
                      .eq("id", id);
                  }}
                />
              </div>
            )}
            <Textarea
              className="mt-3 text-[15px]"
              rows={2}
              placeholder="Observação do pedido"
              defaultValue={order.notes ?? ""}
              onBlur={async (e) => {
                await supabase
                  .from("orders")
                  .update({ notes: e.target.value || null })
                  .eq("id", id);
              }}
            />
          </Card>

          <Card className="rounded-2xl p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold uppercase tracking-wide text-muted-foreground">
              <History className="size-4" /> Histórico de alterações
            </h3>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {auditRows.length ? auditRows.map((row: any) => {
                const oldStatus = row.old_data?.status; const newStatus = row.new_data?.status;
                return <div key={row.id} className="rounded-lg border bg-muted/20 p-2 text-xs">
                  <div className="flex justify-between gap-2"><strong>{row.action}</strong><span className="text-muted-foreground">{formatDateTime(row.created_at)}</span></div>
                  {oldStatus && newStatus && oldStatus !== newStatus && <p className="mt-1">Status: {ORDER_STATUS_LABEL[oldStatus] || oldStatus} → {ORDER_STATUS_LABEL[newStatus] || newStatus}</p>}
                  {row.user_email && <p className="mt-1 text-muted-foreground">Por: {row.user_email}</p>}
                </div>;
              }) : <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>}
            </div>
          </Card>

          <Card className="rounded-2xl p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold uppercase tracking-wide text-muted-foreground">
              <Wallet className="size-4" /> Pagamento
            </h3>
            <div className="text-[15px]">
              <span className="mb-1.5 block font-semibold text-muted-foreground">Forma de pagamento</span>
              <Select
                value={order.payment_timing === "later" ? "later" : (order.payment_method ?? "cash")}
                onValueChange={changePaymentMethod}
              >
                <SelectTrigger className="w-full text-[17px] font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="cash">Dinheiro</SelectItem>
                  <SelectItem value="card">Cartão</SelectItem>
                  <SelectItem value="link">Link de pagamento</SelectItem>
                  <SelectItem value="later">Pagar depois (A receber)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Pode ser alterado a qualquer momento, mesmo depois do pedido entregue.
                {order.payment_timing === "later" && " Escolher \"Pagar depois\" de novo lança um novo lançamento em A Receber."}
              </p>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-[15px]">
              Status:
              {order.payment_status === "paid" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="size-3.5" /> Pago
                </span>
              ) : order.payment_timing === "later" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                  A receber
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                  {order.payment_status}
                </span>
              )}
            </p>
            {order.payment_confirmed_by && (
              <p className="mt-1 text-xs text-muted-foreground">
                Confirmado por: {order.payment_confirmed_by === "ia" ? "IA (comprovante WhatsApp)" : order.payment_confirmed_by === "stripe" ? "Stripe — pagamento confirmado por webhook" : "Admin"}
              </p>
            )}
            {order.source === "site" && order.payment_status === "paid" && order.payment_confirmed_by === "stripe" && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700">
                <CheckCircle2 className="size-4" /> PAGAMENTO CONFIRMADO VIA STRIPE
              </div>
            )}
            {order.payment_receipt_url && (
              <a href={order.payment_receipt_url} target="_blank" rel="noopener noreferrer" className="mt-3 block">
                <img
                  src={order.payment_receipt_url}
                  alt="Comprovante Pix"
                  className="max-h-40 rounded-xl border object-contain"
                />
              </a>
            )}
            {(order.payment_method === "pix" || order.payment_timing === "later") && order.payment_status !== "paid" && (
              <Button
                size="lg"
                variant="outline"
                className="mt-3 w-full rounded-full font-semibold"
                onClick={confirmPayment}
              >
                <CheckCircle2 className="size-4" /> Confirmar pagamento manualmente
              </Button>
            )}
            {order.deliverer_name && (
              <p className="mt-3 flex items-center gap-1.5 text-[15px]">
                <BikeIcon className="size-4 text-muted-foreground" /> Entregador: <b>{order.deliverer_name}</b>
              </p>
            )}
          </Card>

          <Card className="rounded-2xl p-5 shadow-sm">
            <h3 className="mb-3 text-[15px] font-bold uppercase tracking-wide text-muted-foreground">Ações</h3>
            {lastStatusChange && (
              <Button
                size="sm"
                variant="outline"
                className="mb-3 w-full rounded-full"
                onClick={undoStatusChange}
                disabled={undoing}
              >
                <RotateCcw className="size-3.5" />{" "}
                {undoing
                  ? "Desfazendo..."
                  : `Desfazer — voltar pra "${ORDER_STATUS_LABEL[lastStatusChange.oldStatus] ?? lastStatusChange.oldStatus}"`}
              </Button>
            )}
            {order.customer_cancel_requested && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border-2 border-destructive bg-destructive/10 px-3 py-2.5">
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="text-sm">
                  <p className="font-bold text-destructive">Cliente cancelou</p>
                  {order.customer_cancel_reason && (
                    <p className="text-xs text-destructive/80">Motivo: {order.customer_cancel_reason}</p>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {!order.customer_cancel_requested && order.status === "pending" && (
                <Button
                  size="lg"
                  className="w-full rounded-full font-semibold"
                  onClick={() => updateStatus("preparing")}
                >
                  Aceitar → Em preparo
                </Button>
              )}
              {!order.customer_cancel_requested && order.status === "preparing" && (
                <Button
                  size="lg"
                  className="w-full rounded-full font-semibold"
                  onClick={() => updateStatus("ready_pickup")}
                >
                  Marcar como Pronto
                </Button>
              )}
              {!order.customer_cancel_requested && order.status === "ready_pickup" && (
                <Button
                  size="lg"
                  className="w-full rounded-full font-semibold"
                  onClick={() => updateStatus("out_for_delivery")}
                >
                  Saindo para entrega
                </Button>
              )}
              {!order.customer_cancel_requested && order.status === "out_for_delivery" && (
                <Button
                  size="lg"
                  className="w-full rounded-full font-semibold"
                  onClick={() => updateStatus("delivered")}
                >
                  Entregue
                </Button>
              )}
              {!order.customer_cancel_requested && !["delivered", "failed", "cancelled"].includes(order.status) && (
                <>
                  <Textarea
                    placeholder="Motivo da falha (se houver)"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="lg"
                    variant="destructive"
                    className="w-full rounded-full font-semibold"
                    onClick={markFailed}
                  >
                    Marcar Entrega Não Realizada
                  </Button>
                </>
              )}
              {order.failure_reason && (
                <p className="rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
                  Motivo: {order.failure_reason}
                </p>
              )}
              {!["delivered", "cancelled"].includes(order.status) && (
                <Button
                  size="lg"
                  variant="destructive"
                  className="w-full rounded-full font-semibold"
                  onClick={cancelOrder}
                >
                  <XCircle className="size-4" /> Cancelar pedido
                </Button>
              )}
              {order.status === "cancelled" && (
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full rounded-full font-semibold"
                  onClick={reopenOrder}
                  disabled={reopening}
                >
                  <RotateCcw className="size-4" /> {reopening ? "Reabrindo..." : "Reabrir pedido"}
                </Button>
              )}
              {order.cancel_reason && (
                <p className="rounded-lg bg-muted p-2.5 text-sm text-muted-foreground">
                  Cancelado: {order.cancel_reason}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ============ COMPROVANTE TÉRMICO 80MM ============ */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Corrigir dados do pedido</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Revise os dados interpretados pela IA. Nada é salvo até você clicar em <strong>Salvar alterações</strong>.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-xs font-semibold">Nome</label><Input value={editDraft.customer_name ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, customer_name: e.target.value }))} /></div>
            <div><label className="mb-1 block text-xs font-semibold">Telefone</label><Input value={editDraft.customer_phone ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, customer_phone: e.target.value }))} /></div>
            {order.delivery_mode !== "pickup" && <>
              <div><label className="mb-1 block text-xs font-semibold">Rua</label><Input value={editDraft.address_street ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_street: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-semibold">Número</label><Input value={editDraft.address_number ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_number: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-semibold">Bairro</label><Input value={editDraft.address_neighborhood ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_neighborhood: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-semibold">Cidade</label><Input value={editDraft.address_city ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_city: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-semibold">Complemento</label><Input value={editDraft.address_complement ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_complement: e.target.value }))} /></div>
              <div><label className="mb-1 block text-xs font-semibold">Referência</label><Input value={editDraft.address_reference ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, address_reference: e.target.value }))} /></div>
            </>}
            <div><label className="mb-1 block text-xs font-semibold">Taxa de entrega</label><Input type="number" step="0.01" min={0} value={editDraft.delivery_fee ?? 0} onChange={(e) => setEditDraft((d) => ({ ...d, delivery_fee: e.target.value }))} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold">Observações</label><Textarea rows={3} value={editDraft.notes ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={savingDraft}>Cancelar</Button>
            <Button onClick={saveEditDraft} disabled={savingDraft}><Save className="size-4" /> {savingDraft ? "Salvando..." : "Salvar alterações"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrintReceipt order={order} items={items} businessHoursText={businessHoursText} />
    </div>
  );
}

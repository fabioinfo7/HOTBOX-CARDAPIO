import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pushIfoodStatusFn } from "@/lib/ifood-push.functions";
import { pushNfoodStatusFn } from "@/lib/nfood-push.functions";
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
  const [reopening, setReopening] = useState(false);
  const [businessHoursText, setBusinessHoursText] = useState<string | null>(null);

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
      new Date().toISOString().slice(0, 10),
    );
    if (!dueDate) return;
    try {
      const { data: rec, error: recErr } = await supabase
        .from("receivables")
        .insert({
          customer_name: order.customer_name,
          description: `Pedido ${orderDisplayRef(order)} — pagar depois`,
          purchase_date: new Date().toISOString().slice(0, 10),
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

  async function editItem(itemId: string, patch: any) {
    const { error } = await supabase.from("order_items").update(patch).eq("id", itemId);
    if (error) toast.error(error.message);
    else toast.success("Item atualizado");
  }
  async function removeItem(itemId: string) {
    await supabase.from("order_items").delete().eq("id", itemId);
    toast.success("Item removido");
    supabase
      .from("order_items")
      .select("*")
      .eq("order_id", id)
      .then(({ data }) => setItems(data ?? []));
  }

  const isReview = order.status === "pending_review" && order.source !== "ifood" && order.source !== "99food";


  return (
    <div className="space-y-4">
      {order?.is_scheduled && (
        <div className="rounded-2xl border-4 border-amber-500 bg-amber-300 p-5 text-center text-amber-950 shadow-sm">
          <p className="text-2xl font-black uppercase tracking-wide">🗓️ PEDIDO AGENDADO / RESERVADO</p>
          <p className="mt-2 text-base font-black">FAZER CONTATO COM O CLIENTE ANTES DE ENTREGAR</p>
          {order?.scheduled_for_date && (
            <p className="mt-2 text-sm font-bold">
              Data escolhida pelo cliente: {new Date(`${order.scheduled_for_date}T12:00:00`).toLocaleDateString("pt-BR")}
            </p>
          )}
          <p className="mt-2 text-xs font-semibold">
            Este pedido foi pago/reservado fora do horário de funcionamento. Não iniciar preparo automaticamente.
            Confirme com o cliente o horário da entrega.
          </p>
        </div>
      )}
      <div className="no-print flex items-center justify-between">
        <Link to="/loja">
          <Button variant="ghost" size="sm" className="rounded-full font-semibold">
            <ArrowLeft className="size-4" /> Voltar
          </Button>
        </Link>
        <Button variant="outline" className="rounded-full font-semibold" onClick={() => window.print()}>
          <Printer className="size-4" /> IMPRIMIR PEDIDO
        </Button>
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

          <div className="space-y-1 px-6 pt-5">
            <h2 className="flex items-center gap-2.5 text-[24px] font-extrabold uppercase leading-tight tracking-wide">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <User className="size-5" />
              </span>
              {order.customer_name}
            </h2>
            <p className="flex items-center gap-2.5 pl-[3px] text-[16px] text-foreground/70">
              <span className="grid size-9 shrink-0 place-items-center">
                <Phone className="size-4 text-muted-foreground" />
              </span>
              {formatPhone(order.customer_phone)}
            </p>
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
              </div>
            )}
          </div>

          <div className="space-y-2.5 px-6 py-5">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Itens do pedido</h3>
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
                  const newFee = Number(e.target.value);
                  const newTotal = Number(order.subtotal ?? 0) + newFee;
                  const { error } = await supabase
                    .from("orders")
                    .update({ delivery_fee: newFee, total: newTotal })
                    .eq("id", id);
                  if (error) toast.error(error.message);
                  else toast.success("Taxa de entrega atualizada");
                }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-dashed pt-2.5">
              <span className="text-[15px] font-bold uppercase tracking-wide">Total</span>
              <Input
                type="number"
                step="0.01"
                className="h-10 max-w-[150px] text-right text-[20px] font-extrabold text-primary"
                defaultValue={order.total ?? 0}
                onBlur={async (e) => {
                  const newTotal = Number(e.target.value);
                  const { error } = await supabase.from("orders").update({ total: newTotal }).eq("id", id);
                  if (error) toast.error(error.message);
                  else toast.success("Total atualizado");
                }}
              />
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
                Confirmado por: {order.payment_confirmed_by === "ia" ? "IA (comprovante WhatsApp)" : "Admin"}
              </p>
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
      <PrintReceipt order={order} items={items} businessHoursText={businessHoursText} />
    </div>
  );
}

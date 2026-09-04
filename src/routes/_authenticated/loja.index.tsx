import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAlarmAudio, setAlarmSrc, playAlarm, pauseAlarm, playAlarmBeep, stopAlarmBeep, primeBeepUnlock } from "@/lib/alarm-audio";
import { brl, formatDateTime, orderNumberFmt, orderDisplayRef, ORDER_STATUS_LABEL } from "@/lib/formatters";
import { pushIfoodStatusFn } from "@/lib/ifood-push.functions";
import { pushNfoodStatusFn } from "@/lib/nfood-push.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Bell,
  BellOff,
  ChefHat,
  Package,
  Bike,
  Car,
  Footprints,
  CheckCircle2,
  XCircle,
  Eye,
  Clock,
  MapPin,
  Wallet,
  AlertCircle,
  MessageCircle,
  UtensilsCrossed,
  LayoutGrid,
  List,
  Gift,
  PackagePlus,
  Store,
} from "lucide-react";
import { VEHICLE_LABEL } from "@/lib/formatters";
import { StatusBadge, STATUS_STYLE } from "@/components/order-status-badge";
import { ManualOrderDialog } from "@/components/manual-order-dialog";
import { requestAutoPrint } from "@/components/auto-print-receipt";

function VehicleIcon({ vehicle, className }: { vehicle: string | null | undefined; className?: string }) {
  if (vehicle === "carro") return <Car className={className} />;
  if (vehicle === "pe") return <Footprints className={className} />;
  return <Bike className={className} />;
}

export const Route = createFileRoute("/_authenticated/loja/")({
  component: OrdersDashboard,
});

type Order = {
  id: string;
  order_number: number | null;
  status: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  payment_method: string;
  created_at: string;
  address_street: string | null;
  address_number: string | null;
  deliverer_name: string | null;
  deliverer_vehicle: string | null;
  source: string;
  customer_cancel_requested: boolean;
  customer_cancel_reason: string | null;
  payment_status: string;
  payment_timing: string | null;
  delivery_mode: string;
  external_display_id: string | null;
  order_timing: string | null;
  scheduled_start_at: string | null;
  ifood_driver_assigned_at: string | null;
  nfood_driver_assigned_at: string | null;
  loyalty_reward_used?: boolean;
};

function statusLabelFor(o: Order): string {
  if (o.status === "ready_pickup" && o.delivery_mode === "pickup") return "Aguardando Retirada do Cliente";
  return ORDER_STATUS_LABEL[o.status];
}

function OrdersDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [alarmOn, setAlarmOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [unreadByPhone, setUnreadByPhone] = useState<Record<string, boolean>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const [viewMode, setViewMode] = useState<"cards" | "rows">(() => {
    try {
      return (localStorage.getItem("hb_orders_view") as any) === "rows" ? "rows" : "cards";
    } catch {
      return "cards";
    }
  });
  const [manualOpen, setManualOpen] = useState(false);

  function toggleView() {
    const next = viewMode === "cards" ? "rows" : "cards";
    setViewMode(next);
    try {
      localStorage.setItem("hb_orders_view", next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const normalizePhoneKey = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
    const loadUnread = async () => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("phone,has_unread,unread_count");
      const next: Record<string, boolean> = {};
      for (const row of data ?? []) {
        const key = normalizePhoneKey((row as any).phone);
        if (key) next[key] = Boolean((row as any).has_unread || Number((row as any).unread_count ?? 0) > 0);
      }
      setUnreadByPhone(next);
    };
    loadUnread();
    const unreadChannel = supabase
      .channel("orders-customer-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, loadUnread)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: "direction=eq.in" }, loadUnread)
      .subscribe();
    return () => { supabase.removeChannel(unreadChannel); };
  }, []);

  useEffect(() => {
    const loadStock = () =>
      supabase
        .from("ingredients")
        .select("id,name,unit,stock_quantity,low_stock_threshold,track_stock")
        .eq("track_stock", true)
        .then(({ data }) =>
          setLowStock(
            (data ?? []).filter(
              (i: any) =>
                Number(i.low_stock_threshold) > 0 && Number(i.stock_quantity) <= Number(i.low_stock_threshold),
            ),
          ),
        );
    loadStock();
    const ch2 = supabase
      .channel("stock-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "ingredients" }, loadStock)
      .subscribe();
    return () => {
      supabase.removeChannel(ch2);
    };
  }, []);

  useEffect(() => {
    supabase
      .from("store_config")
      .select("alarm_sound_url,admin_alarm_default_on")
      .maybeSingle()
      .then(({ data }) => {
        setAlarmSrc(data?.alarm_sound_url || "https://cdn.jsdelivr.net/gh/anars/blank-audio/1-minute-of-silence.mp3");
        setAlarmOn(data?.admin_alarm_default_on ?? true);
      });
    const load = () =>
      supabase
        .from("orders")
        .select("*")
        .in("status", ["pending", "pending_review", "preparing", "ready_pickup", "out_for_delivery"])
        .order("created_at", { ascending: false })
        .then(({ data }) => setOrders((data as Order[]) ?? []));
    load();
    const ch = supabase
      .channel("orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Navegadores só liberam áudio com som depois de uma interação do usuário.
  // O clique no botão "Entrar" da tela de login já destrava o som (ver
  // primeAlarmUnlock em admin.login.tsx) — isso aqui é só uma rede de
  // segurança extra para quando a sessão já vem ativa (ex: página recarregada).
  useEffect(() => {
    function unlock() {
      if (soundReady) return;
      const a = getAlarmAudio();
      if (!a) return;
      a.play()
        .then(() => {
          a.pause();
          setSoundReady(true);
        })
        .catch(() => {});
    }
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    unlock();
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, [soundReady]);

  const pendingCount = orders.filter((o) => o.status === "pending" || o.status === "pending_review").length;

  // Alarme duplo: HTMLAudioElement (se alarm_sound_url configurado) +
  // beep sintetizado via Web Audio API (sempre funciona, sem CDN).
  useEffect(() => {
    if (!alarmOn) {
      pauseAlarm();
      stopAlarmBeep();
      return;
    }
    if (pendingCount > 0) {
      playAlarm();      // áudio configurado em Configurações (pode ser silencioso se não configurado)
      playAlarmBeep();  // beep sintetizado — sempre toca independente de configuração
    } else {
      pauseAlarm();
      stopAlarmBeep();
    }
    return () => stopAlarmBeep(); // limpa ao desmontar
  }, [pendingCount, alarmOn]);

  async function updateStatus(order: Order, status: string, extra: Record<string, any> = {}) {
    if (
      status === "preparing" &&
      order.payment_method === "pix" &&
      (order as any).payment_timing === "now" &&
      (order as any).payment_status !== "paid"
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
    const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Status atualizado");

    // "Aceitar" = pending -> preparing. Se a impressão automática estiver
    // ligada (Configurações), dispara a nota assim que o pedido é aceito.
    if (order.status === "pending" && status === "preparing") {
      requestAutoPrint(order.id);
    }

    // pedidos da iFood: avisa a iFood DIRETAMENTE aqui também, além do
    // gatilho do banco — se um caminho falhar, o outro cobre; o guard de
    // idempotência garante que ela só recebe o aviso uma vez
    if (order.source === "ifood") {
      try {
        await pushIfoodStatusFn({ data: { orderId: order.id, newStatus: status } });
      } catch (err) {
        console.error("[ifood] push direto falhou (o gatilho do banco ainda pode cobrir):", err);
      }
    }
    // mesma redundância pra 99Food, caminho totalmente independente do da iFood
    if (order.source === "99food") {
      try {
        await pushNfoodStatusFn({ data: { orderId: order.id, newStatus: status } });
      } catch (err) {
        console.error("[99food] push direto falhou (o gatilho do banco ainda pode cobrir):", err);
      }
    }
  }

  async function cancelOrder(id: string, orderNumber: number | null) {
    if (!window.confirm(`Cancelar o pedido #${orderNumber}? Essa ação não pode ser desfeita.`)) return;
    const reason = window.prompt("Motivo do cancelamento (opcional):") ?? "";
    const { error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason || null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(`Pedido #${orderNumber} cancelado`);
  }

  const failedInList = orders.filter((o) => o.status === "failed");
  const activeList = orders.filter((o) => o.status !== "failed");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pedidos ao vivo</h1>
          <p className="text-sm text-muted-foreground">
            Atualização em tempo real.{" "}
            {pendingCount > 0 && (
              <span className="font-semibold text-primary">{pendingCount} aguardando confirmação</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => setManualOpen(true)}>
            <PackagePlus className="size-4" /> Novo pedido manual
          </Button>
          <Button
            variant="outline"
            size="icon"
            title={viewMode === "cards" ? "Ver como lista" : "Ver como cards"}
            onClick={toggleView}
          >
            {viewMode === "cards" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
          </Button>
          <Button variant="outline" onClick={() => setAlarmOn(!alarmOn)}>
            {alarmOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}{" "}
            {alarmOn ? "Alarme ativo" : "Alarme mudo"}
          </Button>
          {alarmOn && !soundReady && (
            <span className="text-xs text-muted-foreground">Clique em qualquer lugar da tela pra liberar o som</span>
          )}
        </div>
      </div>

      <ManualOrderDialog open={manualOpen} onOpenChange={setManualOpen} />

      {/* áudio do alarme agora é o singleton compartilhado (src/lib/alarm-audio.ts) */}

      {lowStock.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-warning bg-warning/10 p-4">
          <div>
            <h3 className="font-bold text-warning-foreground">
              ⚠ Estoque baixo: {lowStock.map((i) => i.name).join(", ")}
            </h3>
            <p className="text-xs text-muted-foreground">Reponha esses insumos antes que faltem.</p>
          </div>
          <Link to="/loja/produtos">
            <Button size="sm" variant="outline">
              Ver insumos
            </Button>
          </Link>
        </div>
      )}

      {failedInList.length > 0 && (
        <div className="rounded-xl border-2 border-destructive p-4 red-blink">
          <h3 className="mb-2 font-bold text-white">⚠ Entregas com falha ({failedInList.length})</h3>
          <div className="space-y-1 text-sm text-white">
            {failedInList.map((o) => (
              <div key={o.id}>
                #{o.order_number} — {o.customer_name}
              </div>
            ))}
          </div>
        </div>
      )}

      {!activeList.length && !failedInList.length ? (
        <Card className="p-10 text-center text-muted-foreground">Nenhum pedido em andamento</Card>
      ) : viewMode === "rows" ? (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="p-2">Status</th>
                <th className="p-2">Pedido</th>
                <th className="p-2">Cliente</th>
                <th className="p-2">Endereço</th>
                <th className="p-2">Pagto</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {activeList.map((o) => {
                const isPending = o.status === "pending" || o.status === "pending_review";
                const s = STATUS_STYLE[o.status] ?? STATUS_STYLE.pending;
                const StatusIcon = s.icon;
                const nextAction = (() => {
                  if (o.customer_cancel_requested) return null;
                  if (o.status === "pending_review") return { label: "Revisar", href: true, icon: Eye };
                  if (o.status === "pending") return { label: "Aceitar", next: "preparing", icon: ChefHat };
                  if (o.status === "preparing") return { label: "Pronto", next: "ready_pickup", icon: Package };
                  if (o.status === "ready_pickup") return { label: "Saindo", next: "out_for_delivery", icon: Bike };
                  if (o.status === "out_for_delivery")
                    return { label: "Entregue", next: "delivered", icon: CheckCircle2 };
                  return null;
                })();
                return (
                  <tr
                    key={o.id}
                    className={`border-t transition-colors hover:bg-muted/40 ${isPending ? "bg-primary/5" : ""}`}
                  >
                    <td className="p-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.bg} ${s.text} ${s.border} border`}
                      >
                        <StatusIcon className="size-3" /> {statusLabelFor(o)}
                      </span>
                    </td>
                    <td className="p-2 font-bold">{orderDisplayRef(o)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        {o.source === "whatsapp" && <MessageCircle className="size-3 text-emerald-600" />}
                        {o.source === "ifood" && <UtensilsCrossed className="size-3 text-red-600" />}
                        {o.source === "99food" && <UtensilsCrossed className="size-3 text-yellow-700" />}
                        <span className="font-semibold">{o.customer_name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{formatDateTime(o.created_at)}</div>
                    </td>
                    <td className="max-w-[260px] p-2 text-xs">
                      {o.address_street ? `${o.address_street}, ${o.address_number}` : "—"}
                    </td>
                    <td className="p-2 text-xs uppercase">{o.payment_method}</td>
                    <td className="p-2 text-right font-bold text-primary">{brl(o.total)}</td>
                    <td className="flex items-center gap-1 p-2">
                      <Link to="/loja/pedido/$id" params={{ id: o.id }} search={{}}>
                        <Button size="sm" variant="ghost" title="Ver detalhes">
                          <Eye className="size-4" />
                        </Button>
                      </Link>
                      {nextAction &&
                        ("next" in nextAction ? (
                          <Button size="sm" onClick={() => updateStatus(o, nextAction.next!)}>
                            <nextAction.icon className="size-3.5" /> {nextAction.label}
                          </Button>
                        ) : (
                          <Link to="/loja/pedido/$id" params={{ id: o.id }} search={{}}>
                            <Button size="sm">{nextAction.label}</Button>
                          </Link>
                        ))}
                      {!["delivered", "cancelled"].includes(o.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => cancelOrder(o.id, o.order_number)}
                          title="Cancelar"
                        >
                          <XCircle className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeList.map((o) => {
            const isPending = o.status === "pending" || o.status === "pending_review";
            // pedido da iFood parado sem ninguém aceitar há mais de 3 minutos —
            // isso já causou perda de prazo de homologação por passar
            // despercebido na tela. Pisca forte, só pra esse caso específico.
            const ifoodStuck =
              o.source === "ifood" && o.status === "pending" && nowTick - new Date(o.created_at).getTime() > 3 * 60_000;
            const nfoodStuck =
              o.source === "99food" &&
              o.status === "pending" &&
              nowTick - new Date(o.created_at).getTime() > 3 * 60_000;
            const platformStuck = ifoodStuck || nfoodStuck;
            const s = STATUS_STYLE[o.status] ?? STATUS_STYLE.pending;
            const StatusIcon = s.icon;
            const customerHasUnread = Boolean(unreadByPhone[String(o.customer_phone ?? "").replace(/\D/g, "")]);
            return (
              <Card
                key={o.id}
                className={`overflow-hidden rounded-2xl border p-0 shadow-sm transition-shadow hover:shadow-lg ${customerHasUnread ? "customer-message-pulse border-2 border-emerald-500" : platformStuck ? "ifood-urgent-pulse border-2 border-red-500" : isPending ? "alarm-pulse" : ""}`}
              >
                {o.loyalty_reward_used && (
                  <div className="flex items-center justify-center gap-2 bg-emerald-600 px-3 py-3 text-center text-sm font-black uppercase tracking-wide text-white shadow-inner">
                    <Gift className="size-5" /> CLIENTE FIEL — TEM DIREITO A UMA BATATA GRÁTIS
                  </div>
                )}
                {ifoodStuck && (
                  <div className="flex items-center justify-center gap-1.5 bg-red-600 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white">
                    <AlertCircle className="size-3.5 animate-pulse" /> Pedido iFood aguardando aceite há mais de 3 min!
                  </div>
                )}
                {nfoodStuck && (
                  <div className="flex items-center justify-center gap-1.5 bg-red-600 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white">
                    <AlertCircle className="size-3.5 animate-pulse" /> Pedido 99Food aguardando aceite há mais de 3 min!
                  </div>
                )}
                {/* faixa de status no topo — uma linha só, ícone maior, centralizado */}
                <div className={`flex items-center justify-center gap-2 py-2.5 ${s.bg} ${s.border} border-b-2`}>
                  <StatusIcon className={`size-5 ${s.text}`} />
                  <span className={`text-sm font-extrabold uppercase tracking-wide ${s.text}`}>
                    {statusLabelFor(o)}
                  </span>
                </div>

                <div className="px-4 pb-1 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold">
                      {o.source === "whatsapp" && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                          <MessageCircle className="size-3" /> WhatsApp
                        </span>
                      )}
                      {o.source === "ifood" && (
                        <span className="flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                          <UtensilsCrossed className="size-3" /> iFood
                        </span>
                      )}
                      {o.source === "99food" && (
                        <span className="flex items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-bold text-yellow-800">
                          <UtensilsCrossed className="size-3" /> 99Food
                        </span>
                      )}
                      Pedido: {orderDisplayRef(o)}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {formatDateTime(o.created_at)}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    <h3 className="text-[16px] font-extrabold uppercase leading-tight tracking-wide text-foreground">
                      {o.customer_name}
                    </h3>

                    {o.delivery_mode === "pickup" ? (
                      <p className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[13px] font-bold text-blue-700">
                        <Store className="size-3.5 shrink-0" /> Retirada no local
                      </p>
                    ) : (
                      <p className="flex items-start gap-1.5 text-[14px] leading-snug text-foreground/75">
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="font-semibold text-muted-foreground">Endereço: </span>
                          {o.address_street ? `${o.address_street}, ${o.address_number}` : "Sem endereço"}
                        </span>
                      </p>
                    )}

                    {o.order_timing === "SCHEDULED" && o.scheduled_start_at && (
                      <p className="flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-[13px] font-bold text-violet-700">
                        <Clock className="size-3.5 shrink-0" /> Agendado para{" "}
                        {new Date(o.scheduled_start_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}

                    {o.source === "ifood" &&
                      o.ifood_driver_assigned_at &&
                      !["delivered", "cancelled"].includes(o.status) && (
                        <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[13px] font-bold text-emerald-700 animate-pulse">
                          <Bike className="size-3.5 shrink-0" /> Entregador iFood a caminho
                        </p>
                      )}
                    {o.source === "99food" &&
                      o.nfood_driver_assigned_at &&
                      !["delivered", "cancelled"].includes(o.status) && (
                        <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[13px] font-bold text-emerald-700 animate-pulse">
                          <Bike className="size-3.5 shrink-0" /> Entregador 99Food a caminho
                        </p>
                      )}

                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                      <Wallet className="size-3.5 shrink-0" />
                      <span>Pagamento:</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">
                        {o.payment_method === "pix" ? "Pix" : o.payment_method === "cash" ? "Dinheiro" : "Cartão"}
                      </span>
                    </div>

                    {o.deliverer_name && (
                      <div className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-[11px]">
                        <VehicleIcon
                          vehicle={o.deliverer_vehicle}
                          className="size-3.5 shrink-0 text-accent-foreground"
                        />
                        <span>
                          Entregador — <span className="font-semibold">{o.deliverer_name}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-dashed pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Total
                    </span>
                    <span className="text-[17px] font-extrabold text-primary">{brl(o.total)}</span>
                  </div>
                </div>

                {o.payment_method === "pix" && o.payment_timing === "now" && o.payment_status !== "paid" && (
                  <div className="mx-4 mb-2 flex animate-pulse items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2">
                    <Wallet className="size-4 shrink-0 text-amber-600" />
                    <p className="text-xs font-bold text-amber-700">
                      Aguardando pagamento Pix — não inicie o preparo ainda
                    </p>
                  </div>
                )}

                {o.customer_cancel_requested && (
                  <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border-2 border-destructive bg-destructive/10 px-3 py-2">
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="text-xs">
                      <p className="font-bold text-destructive">Cliente cancelou</p>
                      {o.customer_cancel_reason && (
                        <p className="text-destructive/80">Motivo: {o.customer_cancel_reason}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ações — grade 2 colunas, compacta */}
                <div className="grid grid-cols-2 gap-1.5 border-t bg-muted/30 p-3">
                  <Link to="/loja/pedido/$id" params={{ id: o.id }} search={{}} className="col-span-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full rounded-full border-2 font-semibold"
                      disabled={o.customer_cancel_requested}
                    >
                      <Eye className="size-3.5" /> Ver detalhes
                    </Button>
                  </Link>
                  {o.status === "pending_review" && !o.customer_cancel_requested && (
                    <Link to="/loja/pedido/$id" params={{ id: o.id }} search={{}} className="col-span-2">
                      <Button size="sm" className="w-full rounded-full font-semibold shadow-sm">
                        Revisar
                      </Button>
                    </Link>
                  )}
                  {o.status === "pending" && !o.customer_cancel_requested && (
                    <Button
                      size="sm"
                      className="rounded-full font-semibold shadow-sm"
                      onClick={() => updateStatus(o, "preparing")}
                    >
                      <ChefHat className="size-3.5" /> Aceitar
                    </Button>
                  )}
                  {o.status === "preparing" && !o.customer_cancel_requested && (
                    <Button
                      size="sm"
                      className="rounded-full font-semibold shadow-sm"
                      onClick={() => updateStatus(o, "ready_pickup")}
                    >
                      <Package className="size-3.5" /> Pronto
                    </Button>
                  )}
                  {o.status === "ready_pickup" && !o.customer_cancel_requested && (
                    <Button
                      size="sm"
                      className="rounded-full font-semibold shadow-sm"
                      onClick={() => updateStatus(o, "out_for_delivery")}
                    >
                      <Bike className="size-3.5" /> Saindo
                    </Button>
                  )}
                  {o.status === "out_for_delivery" && !o.customer_cancel_requested && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-full font-semibold shadow-sm"
                      onClick={() => updateStatus(o, "delivered")}
                    >
                      <CheckCircle2 className="size-3.5" /> Entregue
                    </Button>
                  )}
                  {!["delivered", "cancelled"].includes(o.status) && (
                    <Button
                      size="sm"
                      variant={o.customer_cancel_requested ? "destructive" : "ghost"}
                      className={
                        o.customer_cancel_requested
                          ? "col-span-2 rounded-full font-semibold"
                          : "rounded-full font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                      }
                      onClick={() => cancelOrder(o.id, o.order_number)}
                    >
                      <XCircle className="size-3.5" /> Cancelar
                    </Button>
                  )}
                  <Link
                    to="/loja/chat"
                    search={{ phone: o.customer_phone, name: o.customer_name || undefined }}
                    className="col-span-2"
                  >
                    <Button
                      size="sm"
                      variant={customerHasUnread ? "default" : "outline"}
                      className="w-full rounded-full font-semibold"
                    >
                      <MessageCircle className="size-3.5" />
                      {customerHasUnread ? "Nova mensagem — abrir conversa" : "Conversar com cliente"}
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

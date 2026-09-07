import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAlarmAudio, setAlarmSrc, playAlarm, pauseAlarm, playAlarmBeep, stopAlarmBeep, primeBeepUnlock } from "@/lib/alarm-audio";
import { brl, formatDateTime, formatPhone, ORDER_STATUS_LABEL } from "@/lib/formatters";
import { brasiliaDateISO, brasiliaLocalToUtcISO, brasiliaPeriodStartISO } from "@/lib/brasilia-date";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bike,
  Car,
  Footprints,
  LogOut,
  MapPin,
  Navigation,
  Package,
  RefreshCw,
  CheckCheck,
  XCircle,
  History,
  PlayCircle,
  Bell,
  BellOff,
  Undo2,
  Phone,
  ChevronRight,
  MessageCircle,
  ArrowLeft,
  Wallet,
  ClipboardList,
  ThumbsDown,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/entregador")({
  component: DelivererApp,
});

type Order = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  address_street: string;
  address_number: string;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_reference: string | null;
  total: number;
  delivery_fee: number;
  payment_method: string;
  status: string;
  deliverer_id: string | null;
  deliverer_name: string | null;
  deliverer_vehicle: string | null;
  notes: string | null;
  delivered_at: string | null;
  deliverer_paid_at: string | null;
  created_at: string;
  source?: string;
  delivery_mode?: string | null;
};
type Item = { order_id: string; product_name: string; quantity: number };

function VehicleIcon({ vehicle, className }: { vehicle: string | null; className?: string }) {
  if (vehicle === "carro") return <Car className={className} />;
  if (vehicle === "pe") return <Footprints className={className} />;
  return <Bike className={className} />;
}

function fullAddress(o: Order) {
  return [
    o.address_street && `${o.address_street}, ${o.address_number}`,
    o.address_complement,
    o.address_neighborhood,
    o.address_city,
  ]
    .filter(Boolean)
    .join(" — ");
}

function itemsSummary(items: Item[]) {
  if (!items.length) return null;
  return items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ");
}

function periodStartISO(days: number) {
  return brasiliaPeriodStartISO(days);
}

const DISMISSED_KEY = "hb_dismissed_orders";
const DELIVERY_QUEUE_STATUSES = ["pending", "pending_review", "preparing", "ready_pickup"] as const;

function DelivererApp() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string>("");
  const [checking, setChecking] = useState(true);
  const [isDeliverer, setIsDeliverer] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, Item[]>>({});
  const [alarmOn, setAlarmOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDays, setHistoryDays] = useState("1");
  const [history, setHistory] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<Record<string, Item[]>>({});
  const [historyDetail, setHistoryDetail] = useState<Order | null>(null);
  const [todayEarnings, setTodayEarnings] = useState({ total: 0, count: 0 });

  async function loadTodayEarnings() {
    const startISO = brasiliaLocalToUtcISO(brasiliaDateISO(), 0, 0, 0, 0);
    const { data } = await supabase
      .from("orders")
      .select("delivery_fee,deliverer_paid_at")
      .eq("deliverer_id", userId)
      .eq("status", "delivered")
      .is("deliverer_paid_at", null)
      .gte("delivered_at", startISO);
    const list = data ?? [];
    setTodayEarnings({ total: list.reduce((s, o: any) => s + Number(o.delivery_fee || 0), 0), count: list.length });
  }

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "deliverer")
        .maybeSingle();
      if (!role) {
        nav({ to: "/app" });
        return;
      }
      setIsDeliverer(true);
      const { data: d } = await supabase.from("deliverers").select("*").eq("id", u.user.id).maybeSingle();
      setMe(d);
      const { data: cfg } = await supabase
        .from("store_config")
        .select("deliverer_alarm_sound_url,alarm_sound_url,deliverer_alarm_default_on")
        .maybeSingle();
      const configuredAlarm = cfg?.deliverer_alarm_sound_url || cfg?.alarm_sound_url;
      if (configuredAlarm) setAlarmSrc(configuredAlarm);
      setAlarmOn(cfg?.deliverer_alarm_default_on ?? true);
      setChecking(false);
    })();
  }, []);

  // Navegadores só liberam áudio com som depois de uma interação do usuário.
  // O clique no botão "Entrar" da tela de login já destrava o som (ver
  // primeAlarmUnlock em entregador.login.tsx) — isso aqui é só uma rede de
  // segurança extra para quando a sessão já vem ativa (ex: página recarregada).
  useEffect(() => {
    function unlock() {
      primeBeepUnlock();
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

  useEffect(() => {
    if (!isDeliverer || !userId) return;
    load();
    loadTodayEarnings();

    // Realtime é a primeira camada; polling é a rede de segurança para
    // celulares/navegadores que suspendem ou perdem o websocket.
    const ch = supabase
      .channel(`deliverer-orders-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        load();
        loadTodayEarnings();
      })
      .subscribe();

    const poll = window.setInterval(() => {
      load();
      loadTodayEarnings();
    }, 5000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        load();
        loadTodayEarnings();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(ch);
    };
  }, [isDeliverer, userId]);

  async function load() {
    if (!userId) return;

    // SECURITY DEFINER RPC: garante que a fila chegue ao entregador mesmo
    // quando uma policy antiga estiver cacheada/aplicada incorretamente.
    const { data: raw, error } = await (supabase as any).rpc("get_deliverer_queue");
    if (error) {
      console.error("Falha ao carregar fila do entregador:", error);
      return;
    }

    const { data: cfg } = await supabase.from("store_config").select("nfood_own_delivery").maybeSingle();
    const nfoodHandledExternally = cfg?.nfood_own_delivery !== false;

    const list = ((raw as Order[]) ?? [])
      .filter((o: any) => o.delivery_mode !== "pickup")
      .filter((o: any) => o.source !== "ifood")
      .filter((o: any) => !(nfoodHandledExternally && o.source === "99food"));

    setOrders(list);

    setDismissed((prev) => {
      const activeIds = new Set(list.map((o) => o.id));
      const cleaned = prev.filter((id) => activeIds.has(id));
      if (cleaned.length !== prev.length) {
        try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(cleaned)); } catch {}
      }
      return cleaned;
    });

    if (list.length) {
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id,product_name,quantity")
        .in("order_id", list.map((o) => o.id));
      const grouped: Record<string, Item[]> = {};
      for (const it of (items as Item[]) ?? []) (grouped[it.order_id] ||= []).push(it);
      setItemsByOrder(grouped);
    } else {
      setItemsByOrder({});
    }

    setDetailOrder((prev) => (prev ? (list.find((o) => o.id === prev.id) ?? null) : prev));
  }



  async function loadHistory(days: string) {
    setHistoryLoading(true);
    const since = periodStartISO(Number(days));
    const { data } = await supabase
      .from("orders")
      .select(
        "id,order_number,customer_name,customer_phone,address_street,address_number,address_complement,address_neighborhood,address_city,address_reference,total,delivery_fee,payment_method,status,deliverer_id,deliverer_name,deliverer_vehicle,notes,delivered_at,deliverer_paid_at,created_at",
      )
      .eq("deliverer_id", userId)
      .eq("status", "delivered")
      .not("deliverer_paid_at", "is", null)
      .gte("deliverer_paid_at", since)
      .order("deliverer_paid_at", { ascending: false });
    const list = (data as Order[]) ?? [];
    setHistory(list);
    if (list.length) {
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id,product_name,quantity")
        .in(
          "order_id",
          list.map((o) => o.id),
        );
      const grouped: Record<string, Item[]> = {};
      for (const it of (items as Item[]) ?? []) (grouped[it.order_id] ||= []).push(it);
      setHistoryItems(grouped);
    } else {
      setHistoryItems({});
    }
    setHistoryLoading(false);
  }

  // Somente pedidos AINDA sem entregador disparam o alarme
  const waitingCount = useMemo(
    () => orders.filter((o) => DELIVERY_QUEUE_STATUSES.includes(o.status as any) && !o.deliverer_id && !dismissed.includes(o.id)).length,
    [orders, dismissed],
  );
  useEffect(() => {
    if (!alarmOn) {
      pauseAlarm();
      stopAlarmBeep();
      return;
    }
    if (waitingCount > 0) {
      playAlarm();
      playAlarmBeep();
    } else {
      pauseAlarm();
      stopAlarmBeep();
    }
    return () => {
      if (waitingCount <= 0) stopAlarmBeep();
    };
  }, [waitingCount, alarmOn]);

  function dismiss(o: Order) {
    setDismissed((prev) => {
      const next = [...new Set([...prev, o.id])];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      return next;
    });
    toast("Pedido recusado — ele continua disponível para outros entregadores");
  }

  async function accept(o: Order) {
    // Aceite atômico no banco: somente um entregador consegue reservar.
    const { data, error } = await (supabase as any).rpc("claim_delivery_order", { p_order_id: o.id });
    if (error) {
      console.error("Falha ao aceitar pedido:", error);
      return toast.error("Erro ao aceitar pedido");
    }
    if (!data) return toast.warning("Outro entregador já pegou esse pedido");
    toast.success(`Pedido #${o.order_number} é seu!`);
    await load();
  }

  async function goOutForDelivery(o: Order) {
    const { error } = await supabase
      .from("orders")
      .update({ status: "out_for_delivery", out_for_delivery_at: new Date().toISOString() })
      .eq("id", o.id)
      .eq("deliverer_id", userId)
      .eq("status", "ready_pickup");
    if (error) return toast.error("Erro ao atualizar status");
    toast.success("Status atualizado: saiu para entrega");
    load();
  }

  async function revokeAcceptance(o: Order) {
    if (
      !window.confirm(
        `Desfazer o aceite do pedido #${o.order_number}? Ele volta a ficar disponível para qualquer entregador.`,
      )
    )
      return;
    const { error } = await supabase
      .from("orders")
      .update({ deliverer_id: null, deliverer_name: null, deliverer_vehicle: null, accepted_by_deliverer_at: null })
      .eq("id", o.id)
      .eq("deliverer_id", userId)
      .in("status", [...DELIVERY_QUEUE_STATUSES]);
    if (error) return toast.error("Erro ao desfazer aceite");
    toast.success(`Pedido #${o.order_number} liberado para outros entregadores`);
    setDetailOrder(null);
    load();
  }

  async function markDelivered(o: Order) {
    const { error } = await supabase
      .from("orders")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", o.id)
      .eq("deliverer_id", userId);
    if (error) return toast.error("Erro ao concluir entrega");
    toast.success("Entrega concluída!");
    setDetailOrder(null);
    load();
  }

  async function markFailed(o: Order) {
    const reason = window.prompt("Motivo da falha na entrega?");
    if (!reason) return;
    const { error } = await supabase
      .from("orders")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", o.id)
      .eq("deliverer_id", userId);
    if (error) return toast.error("Erro ao registrar falha");
    toast.success("Falha registrada. A loja foi avisada.");
    setDetailOrder(null);
    load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    nav({ to: "/entregador/login" });
  }

  function navigateTo(o: Order) {
    const addr = [o.address_street, o.address_number, o.address_neighborhood, o.address_city]
      .filter(Boolean)
      .join(", ");
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}&travelmode=driving`;
    window.open(url, "_blank");
  }

  const available = useMemo(
    () => orders.filter((o) => DELIVERY_QUEUE_STATUSES.includes(o.status as any) && !o.deliverer_id && !dismissed.includes(o.id)),
    [orders, dismissed],
  );
  const mine = useMemo(() => orders.filter((o) => o.deliverer_id === userId), [orders, userId]);

  if (checking) return <div className="grid min-h-screen place-items-center text-muted-foreground">Carregando...</div>;

  if (!isDeliverer) return null; // redirecionando para /app

  if (me && me.active === false) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <XCircle className="mx-auto mb-3 size-10 text-destructive" />
          <h1 className="text-lg font-bold">Cadastro em análise</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta foi criada, mas ainda precisa ser ativada pela loja. Assim que liberarem, você começa a receber
            pedidos automaticamente.
          </p>
          <Button variant="outline" className="mt-4 w-full" onClick={signOut}>
            Sair
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7]">
      {/* áudio do alarme agora é o singleton compartilhado (src/lib/alarm-audio.ts) */}
      <header className="sticky top-0 z-30 border-b border-neutral-800/60 bg-neutral-900 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            {me?.selfie_url ? (
              <img
                src={me.selfie_url}
                alt={me?.full_name}
                className="size-10 rounded-full object-cover ring-2 ring-white/15"
              />
            ) : (
              <div className="grid size-10 place-items-center rounded-full bg-primary/90 text-primary-foreground ring-2 ring-white/15">
                <Bike className="size-4.5" />
              </div>
            )}
            <div>
              <p className="text-[15px] font-semibold leading-none tracking-tight">{me?.full_name ?? "Entregador"}</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-white/40">HotBox Delivery</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {alarmOn && !soundReady && (
              <span className="hidden text-[11px] text-white/40 sm:inline">Toque na tela pra liberar o som</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAlarmOn(!alarmOn)}
              className="rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              {alarmOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </Button>
            <Dialog
              open={historyOpen}
              onOpenChange={(v) => {
                setHistoryOpen(v);
                if (v) loadHistory(historyDays);
              }}
            >
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <History className="size-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-semibold tracking-tight">Histórico de valores pagos</DialogTitle>
                </DialogHeader>
                <div className="mb-1">
                  <Select
                    value={historyDays}
                    onValueChange={(v) => {
                      setHistoryDays(v);
                      loadHistory(v);
                    }}
                  >
                    <SelectTrigger className="h-9 w-48 rounded-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Hoje</SelectItem>
                      <SelectItem value="7">Últimos 7 dias</SelectItem>
                      <SelectItem value="15">Últimos 15 dias</SelectItem>
                      <SelectItem value="30">Últimos 30 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {historyLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>
                ) : !history.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Nenhum valor pago no período.</p>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between rounded-xl bg-primary/5 px-3.5 py-2.5">
                      <span className="text-xs font-medium text-neutral-500">
                        Total pago no período ({history.length} entrega{history.length === 1 ? "" : "s"})
                      </span>
                      <span className="text-base font-bold text-primary">
                        {brl(
                          history.reduce((s, o) => s + Number(o.delivery_fee || 0), 0),
                        )}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {history.map((o) => (
                        <Card
                          key={o.id}
                          onClick={() => {
                            setHistoryOpen(false);
                            setHistoryDetail(o);
                          }}
                          className="cursor-pointer rounded-xl border-neutral-200/70 p-3.5 text-sm shadow-none transition hover:border-primary/40 hover:bg-muted/30"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="flex items-start gap-1.5 text-neutral-700">
                              <MapPin className="mt-0.5 size-3.5 shrink-0 text-neutral-400" /> {fullAddress(o)}
                            </p>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${o.status === "delivered" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}
                            >
                              {`Pago ${brl(o.delivery_fee)}`}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Pago em {formatDateTime(o.deliverer_paid_at ?? o.delivered_at ?? o.created_at)}
                          </p>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="sm"
              onClick={load}
              className="rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-7 px-4 py-5">
        <div className="flex items-center justify-between rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">A receber hoje</p>
            <p className="text-[11px] text-muted-foreground">
              {todayEarnings.count} entrega{todayEarnings.count === 1 ? "" : "s"} concluída
              {todayEarnings.count === 1 ? "" : "s"}
            </p>
          </div>
          <p className="text-2xl font-bold text-primary">{brl(todayEarnings.total)}</p>
        </div>

        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">
            <Package className="size-3.5" /> Minhas entregas <span className="text-neutral-400">({mine.length})</span>
          </h2>
          {!mine.length ? (
            <p className="rounded-2xl border border-dashed border-neutral-200 bg-white/60 p-6 text-center text-xs text-muted-foreground">
              Nenhuma entrega em andamento
            </p>
          ) : (
            <div className="space-y-2.5">
              {mine.map((o) => (
                <MineCard key={o.id} o={o} onOpen={() => setDetailOrder(o)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">
            <MapPin className="size-3.5" /> Disponíveis <span className="text-neutral-400">({available.length})</span>
          </h2>
          {!available.length ? (
            <p className="rounded-2xl border border-dashed border-neutral-200 bg-white/60 p-6 text-center text-xs text-muted-foreground">
              Sem pedidos prontos no momento
            </p>
          ) : (
            <div className="space-y-2.5">
              {available.map((o) => (
                <AvailableCard
                  key={o.id}
                  o={o}
                  items={itemsByOrder[o.id] ?? []}
                  onAccept={() => accept(o)}
                  onReject={() => dismiss(o)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <DeliveryDetailSheet
        order={detailOrder}
        items={detailOrder ? (itemsByOrder[detailOrder.id] ?? []) : []}
        onClose={() => setDetailOrder(null)}
        onNavigate={() => detailOrder && navigateTo(detailOrder)}
        onGoOut={detailOrder?.status === "ready_pickup" ? () => goOutForDelivery(detailOrder) : undefined}
        onRevoke={detailOrder && DELIVERY_QUEUE_STATUSES.includes(detailOrder.status as any) ? () => revokeAcceptance(detailOrder) : undefined}
        onDelivered={detailOrder?.status === "out_for_delivery" ? () => markDelivered(detailOrder) : undefined}
        onFailed={detailOrder?.status === "out_for_delivery" ? () => markFailed(detailOrder) : undefined}
      />

      <DeliveryDetailSheet
        order={historyDetail}
        items={historyDetail ? (historyItems[historyDetail.id] ?? []) : []}
        onClose={() => setHistoryDetail(null)}
        onNavigate={() => historyDetail && navigateTo(historyDetail)}
        readOnlyBadge={historyDetail?.status === "delivered" ? "Entregue" : "Entrega falhou"}
      />
    </div>
  );
}

// ============ CARD: pedido disponível — nome, endereço, produto, aceitar/recusar ============
function AvailableCard({
  o,
  items,
  onAccept,
  onReject,
}: {
  o: Order;
  items: Item[];
  onAccept: () => void;
  onReject: () => void;
}) {
  const summary = itemsSummary(items);
  return (
    <Card className="overflow-hidden rounded-2xl border-neutral-200/70 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Pedido #{o.order_number}</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          + {brl(o.delivery_fee)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-[15px] font-semibold tracking-tight">{o.customer_name}</p>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
          {ORDER_STATUS_LABEL[o.status] ?? o.status}
        </span>
      </div>
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-neutral-500">
        <MapPin className="mt-0.5 size-3.5 shrink-0" /> {fullAddress(o)}
      </p>
      {summary && (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-neutral-500">
          <Package className="mt-0.5 size-3.5 shrink-0" /> {summary}
        </p>
      )}
      <div className="mt-3.5 flex gap-2">
        <Button
          variant="outline"
          className="flex-1 rounded-full border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
          onClick={onReject}
        >
          <ThumbsDown className="size-4" /> Recusar
        </Button>
        <Button className="flex-1 rounded-full" onClick={onAccept}>
          Aceitar entrega
        </Button>
      </div>
    </Card>
  );
}

// ============ CARD: pedido meu — resumo + botão pra tela cheia ============
function MineCard({ o, onOpen }: { o: Order; onOpen: () => void }) {
  return (
    <Card
      onClick={onOpen}
      className="cursor-pointer overflow-hidden rounded-2xl border-neutral-200/70 p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Pedido #{o.order_number}</p>
          <p className="mt-0.5 text-[15px] font-semibold tracking-tight">{o.customer_name}</p>
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-neutral-500">
            <MapPin className="mt-0.5 size-3.5 shrink-0" /> {fullAddress(o)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {ORDER_STATUS_LABEL[o.status] ?? o.status}
        </span>
      </div>
      <Button className="mt-3.5 w-full rounded-full" variant="secondary">
        Fazer entrega <ChevronRight className="size-4" />
      </Button>
    </Card>
  );
}

// ============ TELA CHEIA: todos os dados e ações do pedido ============
function DeliveryDetailSheet({
  order,
  items,
  onClose,
  onNavigate,
  onGoOut,
  onRevoke,
  onDelivered,
  onFailed,
  readOnlyBadge,
}: {
  order: Order | null;
  items: Item[];
  onClose: () => void;
  onNavigate: () => void;
  onGoOut?: () => void;
  onRevoke?: () => void;
  onDelivered?: () => void;
  onFailed?: () => void;
  readOnlyBadge?: string;
}) {
  if (!order) return null;
  const paid = order.payment_method === "pix" || order.payment_method === "card";
  const paymentLabel = order.payment_method === "cash" ? "Dinheiro" : order.payment_method === "pix" ? "Pix" : "Cartão";
  const hasActions = !!(onGoOut || onDelivered || onRevoke || onFailed);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#faf9f7]">
      {/* topo */}
      <div className="flex items-center gap-3 border-b border-neutral-800/60 bg-neutral-900 px-4 py-3.5 text-white">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold leading-tight tracking-tight">
            Pedido #{order.order_number}
          </p>
          <p className="text-xs text-white/40">{formatDateTime(order.created_at)}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          {readOnlyBadge ?? ORDER_STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-lg space-y-3.5">
          {/* cliente */}
          <Card className="rounded-2xl border-neutral-200/70 p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <ClipboardList className="size-3.5" /> Cliente
            </h3>
            <p className="text-lg font-semibold tracking-tight">{order.customer_name}</p>
            <p className="mt-1 text-sm text-neutral-500">{formatPhone(order.customer_phone)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={`https://wa.me/${order.customer_phone.replace(/\D/g, "").replace(/^55?/, "55")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-600 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
              <a
                href={`tel:+${order.customer_phone.replace(/\D/g, "").replace(/^55?/, "55")}`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-neutral-900 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                <Phone className="size-4" /> Ligar
              </a>
            </div>

            <div className="mt-4 flex items-start gap-2 border-t border-neutral-100 pt-3.5">
              <MapPin className="mt-0.5 size-5 shrink-0 text-neutral-400" />
              <div>
                <p className="font-medium">
                  {order.address_street}, {order.address_number}
                </p>
                {order.address_complement && (
                  <p className="text-sm text-muted-foreground">Complemento: {order.address_complement}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {order.address_neighborhood} {order.address_city ? `— ${order.address_city}` : ""}
                </p>
                {order.address_reference && (
                  <p className="mt-1 text-sm text-muted-foreground">Ref.: {order.address_reference}</p>
                )}
              </div>
            </div>

            <Button className="mt-4 w-full rounded-full" size="lg" onClick={onNavigate}>
              <Navigation className="size-4" /> Abrir no mapa
            </Button>
          </Card>

          {/* pedido */}
          <Card className="rounded-2xl border-neutral-200/70 p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <Package className="size-3.5" /> Itens do pedido
            </h3>
            {items.length ? (
              <div className="space-y-1.5">
                {items.map((it, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>
                      {it.quantity}× {it.product_name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sem detalhamento de itens</p>
            )}
            {order.notes && (
              <p className="mt-3 rounded-xl bg-amber-50 p-2.5 text-sm font-medium text-amber-800">📝 {order.notes}</p>
            )}
          </Card>

          {/* pagamento */}
          <Card className="rounded-2xl border-neutral-200/70 p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <Wallet className="size-3.5" /> Pagamento
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">
                {paymentLabel} {paid ? "(já pago)" : "(a receber na entrega)"}
              </span>
              <span className="text-xl font-bold text-primary">{brl(order.total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
              <span className="text-xs text-neutral-500">Sua taxa de entrega</span>
              <span className="text-sm font-semibold text-emerald-600">{brl(order.delivery_fee)}</span>
            </div>
          </Card>

          {/* entregador atual, se houver — só faz sentido fora do modo histórico */}
          {!readOnlyBadge && order.deliverer_name && (
            <Card className="flex items-center gap-2 rounded-2xl border-neutral-200/70 p-4 text-sm shadow-sm">
              <VehicleIcon vehicle={order.deliverer_vehicle} className="size-4 text-neutral-400" />
              Entregador: <span className="font-semibold">{order.deliverer_name}</span>
            </Card>
          )}
        </div>
      </div>

      {/* ações fixas embaixo — só aparecem fora do modo histórico */}
      {hasActions && (
        <div className="border-t border-neutral-100 bg-white p-4">
          <div className="mx-auto flex max-w-lg flex-wrap gap-2">
            {onGoOut && (
              <Button size="lg" className="flex-1 rounded-full" onClick={onGoOut}>
                <PlayCircle className="size-4" /> Saí para entrega
              </Button>
            )}
            {onDelivered && (
              <Button
                size="lg"
                className="flex-1 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onDelivered}
              >
                <CheckCheck className="size-4" /> Marcar como entregue
              </Button>
            )}
            {onRevoke && (
              <Button size="lg" variant="outline" className="rounded-full" onClick={onRevoke}>
                <Undo2 className="size-4" /> Desfazer aceite
              </Button>
            )}
            {onFailed && (
              <Button size="lg" variant="destructive" className="rounded-full" onClick={onFailed}>
                <XCircle className="size-4" /> Entrega falhou
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { CheckCircle2, Clock, Package, Bike, XCircle, Copy, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, ORDER_STATUS_LABEL, orderDisplayRef } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pedido/$id")({
  component: OrderStatusPage,
});

type Order = {
  id: string; order_number: number | null; external_id: string | null; external_display_id: string | null; source: string | null; status: string; customer_name: string;
  total: number; payment_method: string; payment_status: string; pix_code: string | null; payment_confirmed_by: string | null;
  created_at: string; deliverer_name: string | null; coupon_code: string | null; coupon_discount: number | null;
};

function OrderStatusPage() {
  const { id } = Route.useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pixQrUrl, setPixQrUrl] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("orders").select("id,order_number,external_id,external_display_id,source,status,customer_name,total,payment_method,payment_status,pix_code,payment_confirmed_by,created_at,deliverer_name,coupon_code,coupon_discount").eq("id", id).maybeSingle();
      setOrder(data as Order);
      const { data: its } = await supabase.from("order_items").select("*").eq("order_id", id);
      setItems(its ?? []);
    };
    load();
    const ch = supabase.channel(`order-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${id}` }, (p) => setOrder(p.new as Order))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  useEffect(() => {
    if (!order?.pix_code) { setPixQrUrl(""); return; }
    QRCode.toDataURL(order.pix_code, { width: 260, margin: 1, errorCorrectionLevel: "M" })
      .then(setPixQrUrl)
      .catch(() => setPixQrUrl(""));
  }, [order?.pix_code]);

  if (!order) return <div className="grid min-h-screen place-items-center text-muted-foreground">Carregando pedido...</div>;

  const steps = [
    { key: "pending", label: "Recebido", icon: Clock },
    { key: "preparing", label: "Em preparo", icon: Package },
    { key: "out_for_delivery", label: "Saiu para entrega", icon: Bike },
    { key: "delivered", label: "Entregue", icon: CheckCircle2 },
  ];
  const idx = steps.findIndex((s) => s.key === order.status);
  const failed = order.status === "failed" || order.status === "cancelled";

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Voltar ao cardápio</Link>
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">Pedido</p>
          <h1 className="text-3xl font-bold">{orderDisplayRef(order)}</h1>
          <p className="mt-2 text-lg font-semibold text-primary">{ORDER_STATUS_LABEL[order.status] || order.status}</p>
        </div>

        {!failed ? (
          <div className="mt-8 flex items-center justify-between">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const done = i <= idx;
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center">
                  <div className={`grid size-10 place-items-center rounded-full border-2 ${done ? "border-primary bg-primary text-primary-foreground" : "border-muted bg-background text-muted-foreground"}`}>
                    <Icon className="size-5" />
                  </div>
                  <p className={`mt-2 text-center text-xs ${done ? "font-semibold" : "text-muted-foreground"}`}>{s.label}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-destructive">
            <XCircle className="size-5" /> <span>{ORDER_STATUS_LABEL[order.status]}</span>
          </div>
        )}

        {order.deliverer_name && (
          <div className="mt-6 rounded-lg bg-accent/20 p-4 text-center">
            <p className="text-sm">Entregador a caminho:</p>
            <p className="font-semibold">{order.deliverer_name}</p>
          </div>
        )}

        <Card className="mt-6 p-4">
          <h3 className="mb-3 font-semibold">Itens</h3>
          <div className="space-y-2">
            {items.map((i) => (
              <div key={i.id} className="flex justify-between text-sm">
                <span>{i.quantity}× {i.product_name}</span>
                <span className="text-muted-foreground">{brl(i.unit_price * i.quantity)}</span>
              </div>
            ))}
          </div>
          {order.coupon_code && Number(order.coupon_discount) > 0 && (
            <div className="mt-2 flex justify-between text-sm font-semibold text-emerald-600">
              <span>Desconto ({order.coupon_code})</span>
              <span>-{brl(Number(order.coupon_discount))}</span>
            </div>
          )}
          <div className="mt-3 flex justify-between border-t pt-3 font-bold">
            <span>Total</span><span>{brl(order.total)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Pagamento: {order.payment_method === "pix" ? "Pix" : order.payment_method === "cash" ? "Dinheiro antecipado" : "Cartão via Stripe"}</p>
          {order.payment_status === "paid" && order.payment_confirmed_by === "stripe" && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700">
              <CheckCircle2 className="size-4" /> PAGAMENTO CONFIRMADO VIA STRIPE
            </div>
          )}
        </Card>

        {order.payment_method === "pix" && order.payment_status !== "paid" && order.pix_code && (
          <Card className="mt-4 overflow-hidden rounded-3xl border-amber-200 bg-amber-50 p-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold"><QrCode className="size-4" /> Pague com Pix para liberar o pedido</h3>
            <p className="mb-4 text-xs text-muted-foreground">O pagamento é antecipado. Não há cobrança na entrega.</p>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              {pixQrUrl && <img src={pixQrUrl} alt="QR Code Pix" className="size-44 rounded-2xl border bg-white p-2" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 rounded-2xl border bg-white p-3">
                  <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">{order.pix_code}</code>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(order.pix_code!); toast.success("Código copiado!"); }}>
                    <Copy className="size-3.5" /> Copiar
                  </Button>
                </div>
                <p className="mt-3 text-xs text-amber-900/70">Depois do pagamento, a loja confirma o recebimento e o pedido entra automaticamente no fluxo operacional.</p>
              </div>
            </div>
          </Card>
        )}

        {order.payment_method === "cash" && order.payment_status !== "paid" && (
          <Card className="mt-4 rounded-3xl border-red-200 bg-red-50 p-5">
            <h3 className="font-semibold text-red-950">Aguardando pagamento em dinheiro</h3>
            <p className="mt-2 text-xs leading-relaxed text-red-900/70">O pagamento precisa ser confirmado antes do preparo. Não há pagamento em dinheiro na entrega.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brl, formatDateTime, ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, orderDisplayRef } from "@/lib/formatters";
import { Card } from "@/components/ui/card";
import { ArrowLeft, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/meus-pedidos")({
  component: MyOrdersPage,
});

const MY_ORDERS_KEY = "hb_my_orders";

type Order = { id: string; order_number: number | null; external_id: string | null; external_display_id: string | null; source: string | null; status: string; total: number; created_at: string };

function MyOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let ids: string[] = [];
      try {
        const raw = localStorage.getItem(MY_ORDERS_KEY);
        ids = raw ? JSON.parse(raw) : [];
      } catch { /* localStorage indisponível */ }
      if (!ids.length) { setLoading(false); return; }
      const { data } = await supabase.from("orders").select("id,order_number,external_id,external_display_id,source,status,total,created_at").in("id", ids);
      const byId = new Map((data ?? []).map((o: any) => [o.id, o]));
      setOrders(ids.map((id) => byId.get(id)).filter(Boolean) as Order[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Voltar ao cardápio
        </Link>
        <h1 className="mt-4 flex items-center gap-2 text-2xl font-bold"><ClipboardList className="size-6" /> Meus pedidos</h1>
        <p className="text-sm text-muted-foreground">Pedidos feitos neste navegador</p>

        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !orders.length ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Você ainda não fez nenhum pedido por aqui.
              <br />
              <Link to="/" className="mt-2 inline-block text-primary underline">Ver cardápio</Link>
            </Card>
          ) : (
            orders.map((o) => (
              <Link key={o.id} to="/pedido/$id" params={{ id: o.id }}>
                <Card className="flex items-center justify-between p-4 transition hover:bg-muted/40">
                  <div>
                    <p className="font-semibold">Pedido {orderDisplayRef(o)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ORDER_STATUS_COLOR[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                    <p className="mt-1 font-bold text-primary">{brl(o.total)}</p>
                  </div>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

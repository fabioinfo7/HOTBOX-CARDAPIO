import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/formatters";
import { getSiteCheckoutStatus } from "@/lib/site-checkout.functions";

export const Route = createFileRoute("/checkout/$id")({
  component: CheckoutStatusPage,
});

function CheckoutStatusPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [checkout, setCheckout] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: any;
    const load = async () => {
      const res = await getSiteCheckoutStatus({ data: { checkoutId: id } });
      if (cancelled) return;
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      const c = (res as any).checkout;
      setCheckout(c);
      if (c?.order_id) {
        try {
          const raw = localStorage.getItem("hb_my_orders");
          const ids: string[] = raw ? JSON.parse(raw) : [];
          if (!ids.includes(c.order_id)) ids.unshift(c.order_id);
          localStorage.setItem("hb_my_orders", JSON.stringify(ids.slice(0, 30)));
        } catch { /* ignore */ }
        nav({ to: "/pedido/$id", params: { id: c.order_id }, replace: true });
        return;
      }
      if (["created", "payment_pending"].includes(String(c?.status))) {
        timer = setTimeout(load, 1500);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, nav]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f7f7] px-4">
        <Card className="w-full max-w-md p-6 text-center">
          <XCircle className="mx-auto size-10 text-destructive" />
          <h1 className="mt-3 text-xl font-black">Não foi possível consultar o pagamento</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Link to="/"><Button className="mt-5">Voltar ao cardápio</Button></Link>
        </Card>
      </div>
    );
  }

  const failed = checkout && ["expired", "payment_failed", "cancelled"].includes(checkout.status);
  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f7f7] px-4 py-10">
      <Card className="w-full max-w-lg rounded-3xl p-7 text-center shadow-lg">
        {failed ? <XCircle className="mx-auto size-12 text-destructive" /> : checkout?.status === "paid" ? <CheckCircle2 className="mx-auto size-12 text-emerald-600" /> : <Loader2 className="mx-auto size-12 animate-spin text-primary" />}
        <h1 className="mt-4 text-2xl font-black">
          {failed ? "Pagamento não concluído" : "Confirmando seu pagamento"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {failed
            ? "Seu pedido não foi criado. Você pode voltar ao cardápio e tentar novamente."
            : "Estamos confirmando seu pagamento. Assim que ele for aprovado, seu pedido será enviado automaticamente para preparo."}
        </p>
        {checkout?.total != null && <p className="mt-4 text-2xl font-black text-primary">{brl(Number(checkout.total))}</p>}
        {!failed && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left text-xs leading-relaxed text-emerald-900">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span><strong>Quase pronto!</strong> Aguarde só mais alguns segundos enquanto confirmamos o pagamento e preparamos seu pedido para a cozinha.</span>
          </div>
        )}
        {checkout?.status === "payment_pending" && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground"><Clock className="size-4" /> Aguardando confirmação do pagamento</div>
        )}
        {failed && <Link to="/"><Button className="mt-6 w-full">Voltar ao cardápio</Button></Link>}
      </Card>
    </div>
  );
}

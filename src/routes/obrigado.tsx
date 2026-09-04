import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, Receipt, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/obrigado")({ component: ObrigadoPage });

const WHATSAPP_URL = "https://wa.me/5521984296288?text=" + encodeURIComponent("Olá! Acabei de fazer um pedido pelo cardápio digital da Hotbox.");

type State = "checking" | "paid" | "pending";

function ObrigadoPage() {
  const [state, setState] = useState<State>("checking");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider") || "infinitepay";

    async function confirmMercadoPago() {
      const checkoutId = params.get("checkout_id") || "";
      if (!checkoutId) { if (alive) setState("pending"); return; }
      try {
        const { getSiteCheckoutStatus } = await import("@/lib/site-checkout.functions");
        const current: any = await getSiteCheckoutStatus({ data: { checkoutId } });
        if (!alive) return;
        if (current?.checkout?.status === "paid" && current.checkout.order_id) {
          setOrderId(String(current.checkout.order_id)); setState("paid"); return;
        }
        const paymentId = current?.checkout?.mercadopago_payment_id;
        if (paymentId) {
          const { checkMercadoPagoPayment } = await import("@/lib/mercadopago.functions");
          const checked: any = await checkMercadoPagoPayment({ data: { checkoutId, paymentId: String(paymentId) } });
          if (!alive) return;
          if (checked?.approved) { setOrderId(checked.order_id || null); setState("paid"); return; }
        }
        setState("pending");
      } catch { if (alive) setState("pending"); }
    }

    async function confirmInfinitePay() {
      const order_nsu = params.get("order_nsu") || "";
      const transaction_nsu = params.get("transaction_nsu") || "";
      const slug = params.get("slug") || "";
      const receipt_url = params.get("receipt_url");
      setReceipt(receipt_url);
      if (!order_nsu || !transaction_nsu || !slug) { if (alive) setState("pending"); return; }
      try {
        const { confirmInfinitePayReturn } = await import("@/lib/infinitepay.functions");
        const result: any = await confirmInfinitePayReturn({ data: { order_nsu, transaction_nsu, slug, receipt_url } });
        if (!alive) return;
        if (result.ok) { setOrderId(result.order_id || null); setState("paid"); } else setState("pending");
      } catch { if (alive) setState("pending"); }
    }

    void (provider === "mercadopago" ? confirmMercadoPago() : confirmInfinitePay());
    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1b0905] via-[#6c160e] to-[#f7f4ef] px-4 py-10">
      <div className="mx-auto max-w-lg overflow-hidden rounded-[34px] bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-[#ffd400] to-[#ff9f1a] p-7 text-center text-black">
          {state === "checking" ? <Loader2 className="mx-auto size-14 animate-spin" /> : <CheckCircle2 className="mx-auto size-16" />}
          <h1 className="mt-4 text-3xl font-black">{state === "paid" ? "Pagamento confirmado!" : state === "checking" ? "Confirmando seu pagamento" : "Pagamento em confirmação"}</h1>
          <p className="mt-2 text-sm font-semibold">Obrigado por escolher a Hotbox. 🔥</p>
        </div>
        <div className="space-y-4 p-6 sm:p-8">
          <div className={`rounded-2xl border p-4 text-sm leading-relaxed ${state === "paid" ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}>
            {state === "paid" ? "Seu pedido já entrou no nosso sistema e seguirá para preparo." : "Estamos aguardando a confirmação final. Você não precisa pagar novamente. Se o pagamento já foi feito, a confirmação também pode chegar pelo WhatsApp."}
          </div>
          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3"><MessageCircle className="mt-0.5 size-5 text-emerald-600" /><div><p className="font-black">Acompanhe pelo WhatsApp</p><p className="mt-1 text-sm text-muted-foreground">A HotBox avisa as etapas do pedido no número informado no checkout.</p></div></div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3"><Clock className="mt-0.5 size-5 text-primary" /><div><p className="font-black">Não repita o pagamento</p><p className="mt-1 text-sm text-muted-foreground">Se houver demora entre o banco e o provedor, o webhook continua verificando a transação em segundo plano.</p></div></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {orderId ? <Button asChild className="rounded-xl"><Link to="/pedido/$id" params={{ id: orderId }}><Receipt className="mr-2 size-4" /> Ver meu pedido</Link></Button> : <Button asChild className="rounded-xl"><Link to="/">Voltar ao cardápio</Link></Button>}
            <Button asChild variant="outline" className="rounded-xl"><a href={WHATSAPP_URL} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 size-4" /> Falar com a HotBox</a></Button>
          </div>
          {receipt && <a href={receipt} target="_blank" rel="noreferrer" className="block text-center text-xs font-bold text-primary underline">Abrir comprovante do pagamento</a>}
        </div>
      </div>
    </main>
  );
}

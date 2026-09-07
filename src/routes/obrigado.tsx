import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Loader2, MessageCircle, Receipt, Clock, Instagram, Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackAnalytics } from "@/lib/analytics";

export const Route = createFileRoute("/obrigado")({ component: ObrigadoPage });

const WHATSAPP_URL = "https://wa.me/5521984296288?text=" + encodeURIComponent("Olá! Acabei de fazer um pedido pelo cardápio digital da Hotbox.");
const INSTAGRAM_URL = "https://www.instagram.com/hotboxbatata/";

type State = "checking" | "paid" | "pending" | "delivery";

function ObrigadoPage() {
  function trackPurchaseOnce(order: string | null, checkout: string | null, total: number | null, method: string) {
    if (!order) return;

    const key = `hb_purchase_tracked_${order}`;

    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}

    let pending: any = null;

    if (checkout) {
      try {
        const raw = sessionStorage.getItem(`hb_meta_checkout_${checkout}`);
        pending = raw ? JSON.parse(raw) : null;
      } catch {
        pending = null;
      }
    }

    const properties = {
      ...(pending?.properties && typeof pending.properties === "object" ? pending.properties : {}),
      event_id: `purchase_${order}`,
      order_id: order,
    };

    const contents = Array.isArray(properties.contents) ? properties.contents : [];
    const numItems = contents.reduce(
      (sum: number, item: any) => sum + Math.max(1, Number(item?.quantity || 1)),
      0,
    );

    trackAnalytics("purchase", {
      event_category: "commerce",
      order_id: order,
      checkout_id: checkout,
      value: Number(total ?? pending?.value ?? 0),
      quantity: numItems || undefined,
      payment_method: method,
      properties,
    });

    if (checkout) {
      try {
        sessionStorage.removeItem(`hb_meta_checkout_${checkout}`);
      } catch {}
    }
  }
  const [state, setState] = useState<State>("checking");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<"pix" | "card">("card");
  const [instagramQrUrl, setInstagramQrUrl] = useState("");


  useEffect(() => {
    QRCode.toDataURL(INSTAGRAM_URL, { width: 260, margin: 1, errorCorrectionLevel: "M" })
      .then(setInstagramQrUrl)
      .catch(() => setInstagramQrUrl(""));
  }, []);

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
          setOrderId(String(current.checkout.order_id)); trackPurchaseOnce(String(current.checkout.order_id), checkoutId, Number(current.checkout.total || 0), "mercadopago"); setState("paid"); return;
        }
        const paymentId = current?.checkout?.mercadopago_payment_id;
        if (paymentId) {
          const { checkMercadoPagoPayment } = await import("@/lib/mercadopago.functions");
          const checked: any = await checkMercadoPagoPayment({ data: { checkoutId, paymentId: String(paymentId) } });
          if (!alive) return;
          if (checked?.approved) { setOrderId(checked.order_id || null); trackPurchaseOnce(checked.order_id || null, checked.checkout_id || checkoutId, Number(checked.total || 0), checked.payment_method || "mercadopago"); setState("paid"); return; }
        }
        setState("pending");
      } catch { if (alive) setState("pending"); }
    }

    async function confirmPayOnDelivery() {
      const directOrderId = params.get("order_id") || "";
      const method = params.get("method") === "pix" ? "pix" : "card";
      if (directOrderId) { setOrderId(directOrderId); trackPurchaseOnce(directOrderId, null, null, method === "pix" ? "delivery_pix" : "delivery_card"); }
      setDeliveryMethod(method);
      if (alive) setState("delivery");
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
        if (result.ok) { setOrderId(result.order_id || null); trackPurchaseOnce(result.order_id || null, result.checkout_id || order_nsu, Number(result.total || 0), result.payment_method || "infinitepay"); setState("paid"); } else setState("pending");
      } catch { if (alive) setState("pending"); }
    }

    void (provider === "delivery" ? confirmPayOnDelivery() : provider === "mercadopago" ? confirmMercadoPago() : confirmInfinitePay());
    return () => { alive = false; };
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#1b0905] via-[#6c160e] to-[#f7f4ef] px-4 py-10">
      <div className="mx-auto max-w-lg overflow-hidden rounded-[34px] bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-[#ffd400] to-[#ff9f1a] p-7 text-center text-black">
          {state === "checking" ? <Loader2 className="mx-auto size-14 animate-spin" /> : <CheckCircle2 className="mx-auto size-16" />}
          <h1 className="mt-4 text-3xl font-black">{state === "delivery" ? "Pedido confirmado!" : state === "paid" ? "Pagamento confirmado!" : state === "checking" ? "Confirmando seu pagamento" : "Pagamento em confirmação"}</h1>
          <p className="mt-2 text-sm font-semibold">Obrigado por escolher a Hotbox. 🔥</p>
        </div>
        <div className="space-y-4 p-6 sm:p-8">
          <div className={`rounded-2xl border p-4 text-sm leading-relaxed ${state === "paid" || state === "delivery" ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}>
            {state === "delivery"
              ? `Seu pedido já entrou no sistema. O pagamento será realizado na entrega por ${deliveryMethod === "pix" ? "Pix" : "cartão"}.`
              : state === "paid"
                ? "Seu pedido já entrou no nosso sistema e seguirá para preparo."
                : "Estamos aguardando a confirmação final. Você não precisa pagar novamente. Se o pagamento já foi feito, a confirmação também pode chegar pelo WhatsApp."}
          </div>
          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3"><MessageCircle className="mt-0.5 size-5 text-emerald-600" /><div><p className="font-black">Acompanhe pelo WhatsApp</p><p className="mt-1 text-sm text-muted-foreground">A HotBox avisa as etapas do pedido no número informado no checkout.</p></div></div>
          </div>
          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3"><Clock className="mt-0.5 size-5 text-primary" /><div><p className="font-black">{state === "delivery" ? "Pagamento na entrega" : "Não repita o pagamento"}</p><p className="mt-1 text-sm text-muted-foreground">{state === "delivery" ? "Nenhuma cobrança foi feita agora. Deixe a forma escolhida disponível quando o entregador chegar." : "Seu pagamento está sendo confirmado com segurança. Assim que a confirmação chegar, o pedido segue automaticamente para a próxima etapa. Obrigado pela preferência!"}</p></div></div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-[#ffcf33]/60 bg-gradient-to-br from-[#fff8dc] via-white to-[#fff1ed] shadow-sm">
            <div className="bg-gradient-to-r from-[#ff4d2e] via-[#ef233c] to-[#a020f0] px-5 py-4 text-white">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5" />
                <p className="text-lg font-black">Seu próximo desconto pode estar no Instagram 👀</p>
              </div>
              <p className="mt-1 text-sm text-white/90">Siga <b>@hotboxbatata</b> e fique por dentro de cupons, promoções completas, novidades e lançamentos da Hotbox.</p>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#ffdf65] text-black"><Gift className="size-5" /></div>
                  <div>
                    <p className="font-black">Cupons e promoções para quem acompanha a Hotbox</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Clique no botão ou aponte a câmera para o QR Code. No Instagram você acompanha as promoções na íntegra e não perde oportunidades de economizar no próximo pedido.</p>
                  </div>
                </div>
                <Button asChild className="mt-4 w-full rounded-xl bg-black text-white hover:bg-black/90 sm:w-auto">
                  <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer"><Instagram className="mr-2 size-4" /> Seguir @hotboxbatata</a>
                </Button>
              </div>
              {instagramQrUrl && (
                <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="mx-auto block rounded-2xl border bg-white p-2 shadow-sm" aria-label="Abrir Instagram da Hotbox">
                  <img src={instagramQrUrl} alt="QR Code do Instagram @hotboxbatata" className="size-32" />
                </a>
              )}
            </div>
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

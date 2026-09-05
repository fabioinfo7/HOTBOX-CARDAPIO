import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, CreditCard, Loader2, QrCode, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createMercadoPagoPayment, checkMercadoPagoPayment } from "@/lib/mercadopago.functions";

const SDK_SRC = "https://sdk.mercadopago.com/js/v2";
const SECURITY_SRC = "https://www.mercadopago.com/v2/security.js";

declare global {
  interface Window {
    MercadoPago?: any;
    MP_DEVICE_SESSION_ID?: string;
  }
}

type Props = {
  checkoutId: string;
  amount: number;
  publicKey: string;
  maxInstallments?: number;
  customerEmail?: string | null;
  origin: string;
  onPaid: (orderId?: string | null) => void;
  onCancel: () => void;
};

type PendingState = {
  paymentId: string;
  status: string;
  statusDetail: string;
  message?: string | null;
  qrCode?: string | null;
  qrCodeBase64?: string | null;
  challengeUrl?: string | null;
  challengeCreq?: string | null;
};

function loadScript(src: string, attrs?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as any).dataset.loaded === "true" || src === SECURITY_SRC) return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar módulo de pagamento.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    Object.entries(attrs || {}).forEach(([k, v]) => script.setAttribute(k, v));
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Falha ao carregar módulo de pagamento."));
    document.head.appendChild(script);
  });
}

export function MercadoPagoPayment({ checkoutId, amount, publicKey, maxInstallments = 1, customerEmail, origin, onPaid, onCancel }: Props) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [checking, setChecking] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [brickKey, setBrickKey] = useState(0);
  const controllerRef = useRef<any>(null);
  const challengeFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let alive = true;
    let controller: any = null;

    async function init() {
      try {
        if (!publicKey) throw new Error("Chave pública do Mercado Pago não configurada.");
        await Promise.all([
          loadScript(SDK_SRC),
          loadScript(SECURITY_SRC, { view: "checkout" }).catch(() => undefined),
        ]);
        if (!alive || !window.MercadoPago) return;

        const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
        const bricks = mp.bricks();
        controller = await bricks.create("payment", "hotbox_payment_brick", {
          initialization: {
            amount: Number(amount.toFixed(2)),
            payer: customerEmail ? { email: customerEmail } : undefined,
          },
          customization: {
            paymentMethods: {
              bankTransfer: "all",
              creditCard: "all",
              minInstallments: 1,
              maxInstallments: Math.min(12, Math.max(1, Number(maxInstallments || 1))),
            },
            visual: {
              style: { theme: "default" },
            },
          },
          callbacks: {
            onReady: () => alive && setReady(true),
            onError: (error: any) => {
              console.error("[mercadopago-brick]", error);
              if (alive) setFatalError("Não foi possível carregar o formulário de pagamento. Atualize a página e tente novamente.");
            },
            onSubmit: async ({ formData }: any) => {
              const attemptId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
              const result: any = await createMercadoPagoPayment({
                data: {
                  checkoutId,
                  origin,
                  formData,
                  deviceId: window.MP_DEVICE_SESSION_ID || null,
                  attemptId,
                },
              });

              if (!result?.ok) {
                toast.error(result?.error || "Pagamento não aprovado. Confira os dados e tente novamente.");
                throw new Error(result?.error || "Pagamento não aprovado");
              }
              if (result.approved) {
                onPaid(result.order_id || null);
                return result;
              }
              setPending({
                paymentId: String(result.paymentId || ""),
                status: String(result.status || "pending"),
                statusDetail: String(result.statusDetail || ""),
                message: result.message || null,
                qrCode: result.qrCode || null,
                qrCodeBase64: result.qrCodeBase64 || null,
                challengeUrl: result.challengeUrl || null,
                challengeCreq: result.challengeCreq || null,
              });
              return result;
            },
          },
        });
        controllerRef.current = controller;
      } catch (e: any) {
        if (alive) setFatalError(String(e?.message || "Não foi possível iniciar o pagamento."));
      }
    }

    void init();
    return () => {
      alive = false;
      try { controller?.unmount?.(); } catch {}
      controllerRef.current = null;
    };
  }, [checkoutId, amount, publicKey, maxInstallments, customerEmail, origin, brickKey]);

  useEffect(() => {
    if (!pending?.paymentId) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      try {
        const result: any = await checkMercadoPagoPayment({ data: { checkoutId, paymentId: pending.paymentId } });
        if (!result?.ok) return;
        if (result.approved) {
          stopped = true;
          window.clearInterval(timer);
          onPaid(result.order_id || null);
          return;
        }
        if (result.rejected) {
          stopped = true;
          window.clearInterval(timer);
          setPending(null);
          setReady(false);
          setBrickKey((k) => k + 1);
          toast.error(result.message || "O pagamento não foi aprovado. Escolha Pix ou cartão e tente novamente.");
          return;
        }
        setPending((current) => current ? {
          ...current,
          status: String(result.status || current.status),
          statusDetail: String(result.statusDetail || current.statusDetail),
          message: result.message || current.message,
          qrCode: result.qrCode || current.qrCode,
          qrCodeBase64: result.qrCodeBase64 || current.qrCodeBase64,
          challengeUrl: result.challengeUrl || current.challengeUrl,
          challengeCreq: result.challengeCreq || current.challengeCreq,
        } : current);
      } catch {
        // Webhook continua como segunda camada; uma falha momentânea de polling não cancela o pagamento.
      }
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [pending?.paymentId, checkoutId, onPaid]);

  useEffect(() => {
    if (!pending?.challengeUrl || !pending?.challengeCreq || !challengeFrameRef.current) return;
    const iframe = challengeFrameRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write("<!doctype html><html><body style='margin:0;font-family:sans-serif'><p style='padding:16px'>Abrindo confirmação do banco…</p></body></html>");
    doc.close();
    const form = doc.createElement("form");
    form.method = "post";
    form.action = pending.challengeUrl;
    const input = doc.createElement("input");
    input.type = "hidden";
    input.name = "creq";
    input.value = pending.challengeCreq;
    form.appendChild(input);
    doc.body.appendChild(form);
    form.submit();
  }, [pending?.challengeUrl, pending?.challengeCreq]);

  async function manualCheck() {
    if (!pending?.paymentId || checking) return;
    setChecking(true);
    try {
      const result: any = await checkMercadoPagoPayment({ data: { checkoutId, paymentId: pending.paymentId } });
      if (result?.approved) return onPaid(result.order_id || null);
      if (result?.rejected) {
        setPending(null);
        setReady(false);
        setBrickKey((k) => k + 1);
        toast.error(result.message || "Pagamento não aprovado. Tente novamente ou escolha outro meio.");
      } else toast.message(result?.message || "Ainda estamos aguardando a confirmação do pagamento.");
    } finally {
      setChecking(false);
    }
  }

  if (fatalError) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-950">
        <p className="font-black">Não foi possível abrir o pagamento</p>
        <p className="mt-1">{fatalError}</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={onCancel}>Voltar ao pedido</Button>
      </div>
    );
  }

  if (pending?.challengeUrl && pending?.challengeCreq) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
          <div className="flex items-center gap-3"><ShieldCheck className="size-6" /><div><p className="font-black">Confirmação do seu banco</p><p className="text-xs">Esta etapa de segurança aparece somente quando o banco emissor solicita.</p></div></div>
        </div>
        <iframe ref={challengeFrameRef} title="Confirmação 3DS do banco" className="h-[470px] w-full rounded-3xl border bg-white sm:h-[580px]" />
        <Button variant="outline" className="w-full rounded-xl" onClick={manualCheck} disabled={checking}>
          {checking ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />} Já confirmei no banco
        </Button>
      </div>
    );
  }

  if (pending?.qrCode) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-600 text-white"><QrCode className="size-6" /></div>
          <h3 className="mt-3 text-xl font-black text-emerald-950">Pix gerado</h3>
          <p className="mt-1 text-sm text-emerald-900">Pague pelo aplicativo do seu banco. A confirmação acontece automaticamente.</p>
          {pending.qrCodeBase64 && (
            <img src={`data:image/png;base64,${pending.qrCodeBase64}`} alt="QR Code Pix" className="mx-auto mt-4 size-56 rounded-2xl bg-white p-2 shadow-sm" />
          )}
          <div className="mt-4 rounded-2xl bg-white p-3 text-left">
            <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">Pix Copia e Cola</p>
            <p className="mt-1 break-all text-xs leading-relaxed text-foreground">{pending.qrCode}</p>
          </div>
          <Button className="mt-3 w-full rounded-xl" onClick={async () => { await navigator.clipboard.writeText(pending.qrCode || ""); toast.success("Pix Copia e Cola copiado"); }}>
            <Copy className="mr-2 size-4" /> Copiar Pix
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Aguardando confirmação do pagamento…</div>
        <Button variant="outline" className="w-full rounded-xl" onClick={manualCheck} disabled={checking}>
          {checking && <Loader2 className="mr-2 size-4 animate-spin" />} Já paguei, verificar agora
        </Button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="rounded-3xl border bg-muted/30 p-6 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <h3 className="mt-3 font-black">Confirmando seu pagamento</h3>
        <p className="mt-1 text-sm text-muted-foreground">{pending.message || "Aguarde alguns instantes. Não envie o pagamento novamente."}</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={manualCheck} disabled={checking}>Verificar agora</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-950"><ShieldCheck className="size-5" /> Pagamento protegido pelo Mercado Pago</div>
        <button type="button" onClick={onCancel} className="rounded-full p-1.5 hover:bg-white" aria-label="Fechar pagamento"><X className="size-4" /></button>
      </div>
      {!ready && <div className="flex items-center justify-center gap-2 rounded-2xl border p-6 text-sm font-semibold text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Carregando Pix e cartão…</div>}
      <div id="hotbox_payment_brick" className={ready ? "block" : "min-h-0 overflow-hidden opacity-0"} />
      <div className="flex items-center justify-center gap-4 text-[11px] font-semibold text-muted-foreground"><span className="flex items-center gap-1"><QrCode className="size-3.5" /> Pix</span><span className="flex items-center gap-1"><CreditCard className="size-3.5" /> Cartão</span><span className="flex items-center gap-1"><ShieldCheck className="size-3.5" /> 3DS quando necessário</span></div>
    </div>
  );
}

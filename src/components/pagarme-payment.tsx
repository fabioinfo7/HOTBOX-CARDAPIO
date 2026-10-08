import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, CreditCard, Loader2, MessageCircle, QrCode, RefreshCw, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPagarmePayment, createPagarmePayment, type PagarmeMethod } from "@/lib/pagarme.functions";
import { trackAnalytics } from "@/lib/analytics";

type BillingAddress = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
  complement?: string | null;
};

type Props = {
  checkoutId: string;
  amount: number;
  publicKey: string;
  method: PagarmeMethod | "both";
  maxInstallments?: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  billingAddress?: BillingAddress | null;
  supportWhatsappUrl: string;
  onPaid: (orderId?: string | null) => void;
  onCancel: () => void;
  onSwitchToPix?: () => void;
};

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

function formatCardNumber(v: string) {
  return digits(v).slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

function validateCardForm(input: { number: string; holder: string; expiry: string; cvv: string }) {
  if (digits(input.number).length < 13) return "Confira o número do cartão.";
  if (String(input.holder || "").trim().length < 3) return "Informe o nome impresso no cartão.";
  const m = String(input.expiry || "").match(/^(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return "Informe a validade no formato MM/AA.";
  if (digits(input.cvv).length < 3) return "Confira o CVV.";
  return "";
}

export function PagarmePayment({
  checkoutId,
  amount,
  publicKey,
  method,
  maxInstallments = 1,
  customerName,
  customerEmail,
  customerPhone,
  billingAddress,
  supportWhatsappUrl,
  onPaid,
  onCancel,
  onSwitchToPix,
}: Props) {
  const [selectedMethod, setSelectedMethod] = useState<PagarmeMethod>(method === "pix" ? "pix" : "card");
  const activeMethod: PagarmeMethod = method === "both" ? selectedMethod : method;
  const [email, setEmail] = useState(String(customerEmail || ""));
  const [document, setDocument] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState(customerName || "");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [billing, setBilling] = useState<BillingAddress>(billingAddress || { street: "", number: "", neighborhood: "", city: "Duque de Caxias", state: "RJ", cep: "", complement: "" });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ qrCode?: string | null; qrCodeUrl?: string | null; status?: string | null } | null>(null);
  const [rejected, setRejected] = useState("");

  const needsBillingFields = activeMethod === "card" && !billingAddress;

  const installmentsOptions = useMemo(() => {
    const max = Math.min(12, Math.max(1, Number(maxInstallments || 1)));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [maxInstallments]);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      try {
        const result: any = await checkPagarmePayment({ data: { checkoutId } });
        if (result?.approved) {
          stopped = true;
          window.clearInterval(timer);
          onPaid(result.order_id || null);
          return;
        }
        if (result?.rejected) {
          stopped = true;
          window.clearInterval(timer);
          setPending(null);
          setRejected(result.message || "O pagamento não foi aprovado.");
        }
      } catch {
        // O webhook continua como camada principal de confirmação.
      }
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [pending, checkoutId, onPaid]);

  async function tokenizeCard() {
    const validation = validateCardForm({ number, holder, expiry, cvv });
    if (validation) throw new Error(validation);
    if (!publicKey) throw new Error("Chave pública do Pagar.me não configurada.");
    const [month, yearRaw] = expiry.split("/");
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const response = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "card",
        card: {
          number: digits(number),
          holder_name: holder.trim(),
          exp_month: Number(month),
          exp_year: Number(year),
          cvv: digits(cvv),
        },
      }),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || !body?.id) throw new Error(String(body?.message || body?.errors?.[0]?.message || "Não foi possível validar o cartão."));
    return String(body.id);
  }

  async function pay() {
    if (loading) return;
    if (!/\S+@\S+\.\S+/.test(email.trim())) return toast.error("Informe um e-mail válido.");
    if (![11, 14].includes(digits(document).length)) return toast.error("Informe seu CPF para o pagamento.");
    if (activeMethod === "card" && needsBillingFields) {
      if (!billing.street.trim() || !billing.number.trim() || !billing.neighborhood.trim() || !billing.city.trim() || digits(billing.cep).length !== 8) {
        return toast.error("Preencha o endereço de cobrança do cartão.");
      }
    }

    setLoading(true);
    setRejected("");
    try {
      const cardToken = activeMethod === "card" ? await tokenizeCard() : null;
      const result: any = await createPagarmePayment({
        data: {
          checkoutId,
          method: activeMethod,
          cardToken,
          email: email.trim(),
          document: digits(document),
          installments,
          billingAddress: activeMethod === "card" ? billing : null,
        },
      });

      if (!result?.ok) {
        const message = result?.error || "Pagamento não aprovado.";
        if (result?.rejected && activeMethod === "card") {
          setRejected(message);
          trackAnalytics("payment_failed", {
            event_category: "payment",
            checkout_id: checkoutId,
            payment_method: "card",
            value: amount,
            properties: { provider: "pagarme", payment_type: "card", reason_friendly: message },
          });
          return;
        }
        throw new Error(message);
      }

      if (result.approved) {
        onPaid(result.order_id || null);
        return;
      }

      setPending({ qrCode: result.qrCode || null, qrCodeUrl: result.qrCodeUrl || null, status: result.status || "pending" });
    } catch (e: any) {
      toast.error(String(e?.message || "Não foi possível processar o pagamento."));
    } finally {
      setLoading(false);
    }
  }

  async function manualCheck() {
    if (checking) return;
    setChecking(true);
    try {
      const result: any = await checkPagarmePayment({ data: { checkoutId } });
      if (result?.approved) return onPaid(result.order_id || null);
      if (result?.rejected) {
        setPending(null);
        setRejected(result.message || "O cartão não foi aprovado.");
      } else {
        toast.message("Ainda estamos aguardando a confirmação do pagamento.");
      }
    } finally {
      setChecking(false);
    }
  }

  if (rejected) {
    return (
      <div className="space-y-4 rounded-3xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-red-600 text-white"><CreditCard className="size-5" /></div>
          <div>
            <h3 className="font-black text-red-950">Cartão não aprovado</h3>
            <p className="mt-1 text-sm text-red-900">{rejected}</p>
          </div>
        </div>
        <p className="text-xs font-semibold text-red-900/80">Você pode continuar sem refazer o pedido:</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" className="rounded-xl" onClick={() => { setRejected(""); setNumber(""); setCvv(""); }}>
            <RefreshCw className="mr-2 size-4" /> Outro cartão
          </Button>
          {onSwitchToPix && (
            <Button type="button" variant="outline" className="rounded-xl border-emerald-300 bg-white text-emerald-800" onClick={onSwitchToPix}>
              <QrCode className="mr-2 size-4" /> Pagar com Pix
            </Button>
          )}
          <a href={supportWhatsappUrl} target="_blank" rel="noreferrer">
            <Button type="button" variant="outline" className="w-full rounded-xl border-[#25D366]/40 bg-white text-[#128C4A]">
              <MessageCircle className="mr-2 size-4" /> Link pelo WhatsApp
            </Button>
          </a>
        </div>
      </div>
    );
  }

  if (pending?.qrCode) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-600 text-white"><QrCode className="size-6" /></div>
          <h3 className="mt-3 text-xl font-black text-emerald-950">Pix pronto</h3>
          <p className="mt-1 text-sm text-emerald-900">Pague pelo seu banco. A confirmação é automática.</p>
          {pending.qrCodeUrl && <img src={pending.qrCodeUrl} alt="QR Code Pix" className="mx-auto mt-4 size-56 rounded-2xl bg-white p-2 shadow-sm" />}
          <div className="mt-4 rounded-2xl bg-white p-3 text-left">
            <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">Pix Copia e Cola</p>
            <p className="mt-1 break-all text-xs leading-relaxed">{pending.qrCode}</p>
          </div>
          <Button className="mt-3 w-full rounded-xl" onClick={async () => { await navigator.clipboard.writeText(pending.qrCode || ""); toast.success("Pix copiado"); }}>
            <Copy className="mr-2 size-4" /> Copiar Pix
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Aguardando confirmação…</div>
        <Button variant="outline" className="w-full rounded-xl" onClick={manualCheck} disabled={checking}>{checking ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />} Já paguei, verificar</Button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="rounded-3xl border bg-muted/30 p-6 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <h3 className="mt-3 font-black">Confirmando pagamento</h3>
        <p className="mt-1 text-sm text-muted-foreground">Aguarde alguns instantes. Não tente cobrar novamente.</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={manualCheck} disabled={checking}>Verificar agora</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {method === "both" && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
          <button type="button" onClick={() => { setSelectedMethod("card"); setRejected(""); }} className={`rounded-lg px-3 py-2 text-sm font-black ${activeMethod === "card" ? "bg-white shadow-sm" : "text-zinc-600"}`}>
            <CreditCard className="mr-1 inline size-4" /> Cartão
          </button>
          <button type="button" onClick={() => { setSelectedMethod("pix"); setRejected(""); }} className={`rounded-lg px-3 py-2 text-sm font-black ${activeMethod === "pix" ? "bg-white shadow-sm" : "text-zinc-600"}`}>
            <QrCode className="mr-1 inline size-4" /> Pix
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-950"><ShieldCheck className="size-5" /> Pagamento seguro</div>
        <button type="button" onClick={onCancel} className="rounded-full p-1.5 hover:bg-white" aria-label="Fechar pagamento"><X className="size-4" /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>E-mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" autoComplete="email" />
        </div>
        <div>
          <Label>CPF</Label>
          <Input value={document} onChange={(e) => setDocument(digits(e.target.value).slice(0, 14))} placeholder="Somente números" inputMode="numeric" />
        </div>
      </div>

      {activeMethod === "card" && (
        <>
          <div>
            <Label>Número do cartão</Label>
            <Input value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number" />
          </div>
          <div>
            <Label>Nome no cartão</Label>
            <Input value={holder} onChange={(e) => setHolder(e.target.value.toUpperCase())} placeholder="NOME COMO ESTÁ NO CARTÃO" autoComplete="cc-name" />
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div>
              <Label>Validade</Label>
              <Input value={expiry} onChange={(e) => {
                const d = digits(e.target.value).slice(0, 6);
                setExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              }} placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" />
            </div>
            <div>
              <Label>CVV</Label>
              <Input value={cvv} onChange={(e) => setCvv(digits(e.target.value).slice(0, 4))} placeholder="123" inputMode="numeric" autoComplete="cc-csc" />
            </div>
          </div>
          {installmentsOptions.length > 1 && (
            <div>
              <Label>Parcelas</Label>
              <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                {installmentsOptions.map((n) => <option key={n} value={n}>{n}x</option>)}
              </select>
            </div>
          )}
          {needsBillingFields && (
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-sm font-black">Endereço de cobrança</p>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">Só pedimos porque o Pagar.me exige o endereço associado ao cartão.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={billing.cep} onChange={(e) => setBilling({ ...billing, cep: digits(e.target.value).slice(0, 8) })} placeholder="CEP" inputMode="numeric" />
                <Input value={billing.number} onChange={(e) => setBilling({ ...billing, number: e.target.value })} placeholder="Número" />
                <Input value={billing.street} onChange={(e) => setBilling({ ...billing, street: e.target.value })} placeholder="Rua" className="sm:col-span-2" />
                <Input value={billing.neighborhood} onChange={(e) => setBilling({ ...billing, neighborhood: e.target.value })} placeholder="Bairro" />
                <Input value={billing.city} onChange={(e) => setBilling({ ...billing, city: e.target.value })} placeholder="Cidade" />
              </div>
            </div>
          )}
        </>
      )}

      <Button className="w-full rounded-full bg-[#ffd400] py-6 text-base font-black text-black hover:bg-[#f4ca00]" onClick={pay} disabled={loading}>
        {loading ? <><Loader2 className="mr-2 size-5 animate-spin" /> Processando…</> : activeMethod === "pix" ? <><QrCode className="mr-2 size-5" /> Gerar Pix • R$ {amount.toFixed(2).replace(".", ",")}</> : <><CreditCard className="mr-2 size-5" /> Pagar no cartão • R$ {amount.toFixed(2).replace(".", ",")}</>}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">Os dados do cartão são tokenizados diretamente pelo Pagar.me e não ficam armazenados na HotBox.</p>
    </div>
  );
}

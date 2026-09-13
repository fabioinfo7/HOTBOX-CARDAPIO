import { useEffect, useMemo, useState } from "react";
import EfiPay from "payment-token-efi";
import { CheckCircle2, Copy, CreditCard, Loader2, MessageCircle, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkEfiPayment, createEfiPayment, type EfiMethod } from "@/lib/efi.functions";
import { trackAnalytics } from "@/lib/analytics";

type BillingAddress = { street: string; number: string; neighborhood: string; city: string; state: string; cep: string; complement?: string | null };
type Props = {
  checkoutId: string;
  amount: number;
  payeeCode: string;
  environment: "sandbox" | "production";
  method: EfiMethod;
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
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const cardNumberMask = (v: string) => digits(v).slice(0, 19).replace(/(.{4})/g, "$1 ").trim();

export function EfiPayment({ checkoutId, amount, payeeCode, environment, method, maxInstallments=1, customerName, customerEmail, customerPhone, billingAddress, supportWhatsappUrl, onPaid, onCancel, onSwitchToPix }: Props) {
  const [email,setEmail]=useState(String(customerEmail||""));
  const [document,setDocument]=useState("");
  const [number,setNumber]=useState("");
  const [holder,setHolder]=useState(customerName||"");
  const [expiry,setExpiry]=useState("");
  const [cvv,setCvv]=useState("");
  const [installments,setInstallments]=useState(1);
  const [billing,setBilling]=useState<BillingAddress>(billingAddress||{street:"",number:"",neighborhood:"",city:"Duque de Caxias",state:"RJ",cep:"",complement:""});
  const [loading,setLoading]=useState(false);
  const [checking,setChecking]=useState(false);
  const [pending,setPending]=useState<{qrCode?:string|null;qrCodeUrl?:string|null;status?:string|null}|null>(null);
  const [rejected,setRejected]=useState("");
  const needsBillingFields=method==="card"&&!billingAddress;
  const installmentOptions=useMemo(()=>Array.from({length:Math.min(12,Math.max(1,Number(maxInstallments||1)))},(_,i)=>i+1),[maxInstallments]);

  useEffect(()=>{
    if(!pending) return;
    let stopped=false;
    const timer=window.setInterval(async()=>{
      if(stopped) return;
      try{
        const result:any=await checkEfiPayment({data:{checkoutId}});
        if(result?.approved){stopped=true;window.clearInterval(timer);onPaid(result.order_id||null);return;}
        if(result?.rejected){stopped=true;window.clearInterval(timer);setPending(null);setRejected(result.message||"O cartão não foi aprovado.");}
      }catch{}
    },3000);
    return()=>{stopped=true;window.clearInterval(timer)};
  },[pending,checkoutId,onPaid]);

  async function tokenizeCard(){
    if(!payeeCode) throw new Error("Identificador da conta Efí não configurado.");
    if(digits(number).length<13) throw new Error("Confira o número do cartão.");
    if(holder.trim().length<3) throw new Error("Informe o nome impresso no cartão.");
    const m=expiry.match(/^(\d{2})\/(\d{2}|\d{4})$/); if(!m) throw new Error("Informe a validade no formato MM/AA.");
    if(digits(cvv).length<3) throw new Error("Confira o CVV.");
    const year=m[2].length===2?`20${m[2]}`:m[2];
    const brand=await EfiPay.CreditCard.setCardNumber(digits(number)).verifyCardBrand();
    if(!brand||brand==="unsupported"||brand==="undefined") throw new Error("Bandeira do cartão não suportada pela Efí.");
    const result=await EfiPay.CreditCard
      .setAccount(payeeCode)
      .setEnvironment(environment)
      .setCreditCardData({brand,number:digits(number),cvv:digits(cvv),expirationMonth:m[1],expirationYear:year,holderName:holder.trim(),holderDocument:digits(document),reuse:false})
      .getPaymentToken();
    if(!result?.payment_token) throw new Error("Não foi possível validar o cartão.");
    return String(result.payment_token);
  }

  async function pay(){
    if(loading) return;
    if(method==="card"&&!/\S+@\S+\.\S+/.test(email.trim())) return toast.error("Informe um e-mail válido.");
    if(method==="card"&&digits(document).length!==11) return toast.error("Informe um CPF válido.");
    if(method==="card"&&needsBillingFields&&(!billing.street.trim()||!billing.number.trim()||!billing.neighborhood.trim()||!billing.city.trim()||digits(billing.cep).length!==8)) return toast.error("Preencha o endereço de cobrança.");
    setLoading(true);setRejected("");
    try{
      const paymentToken=method==="card"?await tokenizeCard():null;
      const result:any=await createEfiPayment({data:{checkoutId,method,paymentToken,email:email.trim(),document:digits(document),installments,billingAddress:method==="card"?billing:null}});
      if(!result?.ok){
        const message=result?.error||"Pagamento não aprovado.";
        if(result?.rejected&&method==="card"){
          setRejected(message);
          trackAnalytics("payment_failed",{event_category:"payment",checkout_id:checkoutId,payment_method:"card",value:amount,properties:{provider:"efi",payment_type:"card",reason_friendly:message}});
          return;
        }
        throw new Error(message);
      }
      if(result.approved){onPaid(result.order_id||null);return;}
      setPending({qrCode:result.qrCode||null,qrCodeUrl:result.qrCodeUrl||null,status:result.status||"pending"});
    }catch(e:any){toast.error(String(e?.error_description||e?.message||"Não foi possível processar o pagamento."));}
    finally{setLoading(false)}
  }

  async function manualCheck(){
    if(checking)return;setChecking(true);
    try{const r:any=await checkEfiPayment({data:{checkoutId}});if(r?.approved)return onPaid(r.order_id||null);if(r?.rejected){setPending(null);setRejected(r.message||"Cartão não aprovado.")}else toast.message("Ainda estamos aguardando a confirmação do pagamento.");}
    finally{setChecking(false)}
  }

  if(rejected) return <div className="space-y-4 rounded-3xl border border-red-200 bg-red-50 p-5">
    <div className="flex items-start gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-red-600 text-white"><CreditCard className="size-5"/></div><div><h3 className="font-black text-red-950">Cartão não aprovado</h3><p className="mt-1 text-sm text-red-900">{rejected}</p></div></div>
    <p className="text-xs font-semibold text-red-900/80">Escolha como quer continuar sem refazer o pedido:</p>
    <div className="grid gap-2 sm:grid-cols-3">
      <Button type="button" className="rounded-xl" onClick={()=>{setRejected("");setNumber("");setCvv("")}}><RefreshCw className="mr-2 size-4"/>Outro cartão</Button>
      {onSwitchToPix&&<Button type="button" variant="outline" className="rounded-xl border-emerald-300 bg-white text-emerald-800" onClick={onSwitchToPix}><QrCode className="mr-2 size-4"/>Pagar com Pix</Button>}
      <a href={supportWhatsappUrl} target="_blank" rel="noreferrer"><Button type="button" variant="outline" className="w-full rounded-xl border-[#25D366]/40 bg-white text-[#128C4A]"><MessageCircle className="mr-2 size-4"/>Link pelo WhatsApp</Button></a>
    </div>
  </div>;

  if(pending) return <div className="space-y-4 rounded-3xl border bg-white p-5 shadow-sm">
    {method==="pix"?<><div className="text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><QrCode className="size-6"/></div><h3 className="mt-3 font-black">Pix Efí gerado</h3><p className="text-sm text-muted-foreground">Pague e aguarde a confirmação automática.</p></div>{pending.qrCodeUrl&&<img src={pending.qrCodeUrl} alt="QR Code Pix Efí" className="mx-auto size-56 rounded-2xl border bg-white p-2"/>}{pending.qrCode&&<div className="rounded-2xl bg-zinc-50 p-3"><p className="mb-2 text-xs font-bold text-zinc-500">Pix Copia e Cola</p><div className="flex gap-2"><Input readOnly value={pending.qrCode}/><Button type="button" variant="outline" onClick={()=>{navigator.clipboard.writeText(pending.qrCode||"");toast.success("Pix copiado")}}><Copy className="size-4"/></Button></div></div>}</>:<div className="text-center"><Loader2 className="mx-auto size-8 animate-spin"/><h3 className="mt-3 font-black">Confirmando seu cartão</h3><p className="text-sm text-muted-foreground">Normalmente leva poucos segundos.</p></div>}
    <Button type="button" variant="outline" className="w-full rounded-xl" onClick={manualCheck} disabled={checking}>{checking?<Loader2 className="mr-2 size-4 animate-spin"/>:<RefreshCw className="mr-2 size-4"/>}Verificar pagamento</Button>
  </div>;

  return <div className="space-y-4 rounded-3xl border bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-black">{method==="pix"?"Pagar com Pix":"Pagar com cartão"}</h3><p className="text-xs text-muted-foreground">Pagamento processado com segurança pela Efí.</p></div><ShieldCheck className="size-5 text-emerald-600"/></div>
    {method==="card"&&<>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>E-mail</Label><Input value={email} onChange={e=>setEmail(e.target.value)} inputMode="email"/></div><div><Label>CPF</Label><Input value={document} onChange={e=>setDocument(digits(e.target.value).slice(0,11))} inputMode="numeric"/></div></div>
      <div><Label>Número do cartão</Label><Input value={number} onChange={e=>setNumber(cardNumberMask(e.target.value))} inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000"/></div>
      <div><Label>Nome no cartão</Label><Input value={holder} onChange={e=>setHolder(e.target.value)} autoComplete="cc-name"/></div>
      <div className="grid grid-cols-3 gap-3"><div><Label>Validade</Label><Input value={expiry} onChange={e=>setExpiry(e.target.value.replace(/[^0-9/]/g,"").slice(0,7))} placeholder="MM/AA" autoComplete="cc-exp"/></div><div><Label>CVV</Label><Input value={cvv} onChange={e=>setCvv(digits(e.target.value).slice(0,4))} inputMode="numeric" autoComplete="cc-csc"/></div><div><Label>Parcelas</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={installments} onChange={e=>setInstallments(Number(e.target.value))}>{installmentOptions.map(n=><option key={n} value={n}>{n}x</option>)}</select></div></div>
      {needsBillingFields&&<div className="grid gap-3 rounded-2xl bg-zinc-50 p-4 sm:grid-cols-2"><div className="sm:col-span-2 text-xs font-black uppercase text-zinc-500">Endereço de cobrança</div><Input placeholder="Rua" value={billing.street} onChange={e=>setBilling({...billing,street:e.target.value})}/><Input placeholder="Número" value={billing.number} onChange={e=>setBilling({...billing,number:e.target.value})}/><Input placeholder="Bairro" value={billing.neighborhood} onChange={e=>setBilling({...billing,neighborhood:e.target.value})}/><Input placeholder="CEP" value={billing.cep} onChange={e=>setBilling({...billing,cep:digits(e.target.value).slice(0,8)})}/></div>}
    </>}
    <Button type="button" className="w-full rounded-xl" onClick={pay} disabled={loading}>{loading?<Loader2 className="mr-2 size-4 animate-spin"/>:method==="pix"?<QrCode className="mr-2 size-4"/>:<CreditCard className="mr-2 size-4"/>}{method==="pix"?"Gerar Pix":`Pagar R$ ${amount.toFixed(2).replace(".",",")}`}</Button>
    <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>Voltar</Button>
    <p className="text-center text-[11px] text-muted-foreground">Os dados do cartão são tokenizados pela biblioteca oficial da Efí e não ficam armazenados na HotBox.</p>
  </div>;
}

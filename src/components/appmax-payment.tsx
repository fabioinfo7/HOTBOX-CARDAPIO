import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, CreditCard, Loader2, QrCode, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAppmaxPayment, checkAppmaxPayment } from "@/lib/appmax.functions";

const APPMAX_JS="https://scripts.appmax.com.br/appmax.min.js";

declare global {
  interface Window {
    AppmaxScripts?: {
      init:(
        onSuccess:(data:{ip?:string;token?:string})=>void,
        onError:(error:any)=>void,
        externalId?:string,
        onUpdate?:(...args:any[])=>any,
        onAuthorize?:(...args:any[])=>any,
      )=>void;
    };
  }
}

type Props={
  checkoutId:string;
  amount:number;
  externalId:string;
  maxInstallments?:number;
  customerName:string;
  customerEmail?:string|null;
  supportWhatsappUrl:string;
  onPaid:(orderId?:string|null)=>void;
  onCancel:()=>void;
};

type PixState={qrCode?:string|null;emvCode?:string|null;expiresAt?:string|null};

function loadAppmaxJs(){
  return new Promise<void>((resolve,reject)=>{
    if(window.AppmaxScripts)return resolve();
    const existing=document.querySelector(`script[src="${APPMAX_JS}"]`) as HTMLScriptElement|null;
    if(existing){
      existing.addEventListener("load",()=>resolve(),{once:true});
      existing.addEventListener("error",()=>reject(new Error("Falha ao carregar Appmax JS.")),{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src=APPMAX_JS;
    script.async=true;
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error("Falha ao carregar Appmax JS."));
    document.head.appendChild(script);
  });
}
function digits(v:string){return v.replace(/\D/g,"");}

export function AppmaxPayment({
  checkoutId,amount,externalId,maxInstallments=1,customerName,customerEmail,supportWhatsappUrl,onPaid,onCancel,
}:Props){
  const [ready,setReady]=useState(false);
  const [ip,setIp]=useState("");
  const [email,setEmail]=useState(customerEmail || "");
  const [document,setDocument]=useState("");
  const [holderName,setHolderName]=useState(customerName || "");
  const [mode,setMode]=useState<"card"|"pix">("card");
  const [submitting,setSubmitting]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [pix,setPix]=useState<PixState|null>(null);
  const lastToken=useRef("");
  const live=useRef(true);
  const ipRef=useRef("");
  const emailRef=useRef(customerEmail || "");
  const documentRef=useRef("");
  const holderNameRef=useRef(customerName || "");
  const maxParcels=useMemo(()=>Math.max(1,Math.min(12,Number(maxInstallments || 1))),[maxInstallments]);

  useEffect(()=>{
    live.current=true;
    loadAppmaxJs().then(()=>{
      if(!window.AppmaxScripts)throw new Error("Appmax JS indisponível.");
      try{
        window.AppmaxScripts.init(
          async(data)=>{
            if(!live.current)return;
            if(data?.ip){const nextIp=String(data.ip);setIp(nextIp);ipRef.current=nextIp;}
            const token=String(data?.token || "").trim();
            if(!token || token===lastToken.current){setReady(true);return;}
            lastToken.current=token;
            setSubmitting(true);setError("");
            try{
              const result:any=await createAppmaxPayment({data:{
                checkoutId,method:"card",ip:String(data.ip || ipRef.current),email:emailRef.current,document:documentRef.current,
                cardToken:token,holderName:holderNameRef.current,installments:1,
              }});
              if(!result?.ok){setError(result?.error || "Pagamento não autorizado.");return;}
              if(result.approved){onPaid(result.order_id || null);return;}
              setPending(true);
              toast.success(result.message || "Pagamento enviado para análise.");
            }finally{if(live.current)setSubmitting(false);}
          },
          (err)=>{console.error("[appmax-js]",err);if(live.current){setError("Não foi possível carregar a segurança do cartão.");setReady(false);}},
          externalId,
        );
        setReady(true);
      }catch(err){console.error(err);setError("Não foi possível inicializar a Appmax.");}
    }).catch(err=>{console.error(err);setError("Não foi possível carregar a Appmax agora.");});
    return()=>{live.current=false;};
  },[checkoutId,externalId]);

  useEffect(()=>{
    if(!pending && !pix)return;
    const timer=window.setInterval(async()=>{
      const result:any=await checkAppmaxPayment({data:{checkoutId}}).catch(()=>null);
      if(result?.approved){window.clearInterval(timer);onPaid(result.order_id || null);}
    },4500);
    return()=>window.clearInterval(timer);
  },[pending,pix,checkoutId,onPaid]);

  async function createPix(){
    if(!email.trim())return toast.error("Informe seu e-mail.");
    if(![11,14].includes(digits(document).length))return toast.error("Informe um CPF ou CNPJ válido.");
    if(!ip)return toast.error("Aguarde alguns segundos enquanto carregamos a segurança da Appmax.");
    setSubmitting(true);setError("");
    try{
      const result:any=await createAppmaxPayment({data:{checkoutId,method:"pix",ip,email,document,installments:1}});
      if(!result?.ok){setError(result?.error || "Não foi possível gerar o Pix.");return;}
      if(result.approved){onPaid(result.order_id || null);return;}
      setPix({qrCode:result.qrCode || null,emvCode:result.emvCode || null,expiresAt:result.expiresAt || null});
      setPending(true);
    }finally{setSubmitting(false);}
  }

  async function manualCheck(){
    setSubmitting(true);
    try{
      const result:any=await checkAppmaxPayment({data:{checkoutId}});
      if(result?.approved)onPaid(result.order_id || null);
      else toast.info("Pagamento ainda aguardando confirmação da Appmax.");
    }finally{setSubmitting(false);}
  }

  if(pix){
    return <div className="space-y-4 rounded-3xl border bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-black">Pix Appmax</p><p className="mt-1 text-xs text-muted-foreground">A confirmação é automática após a aprovação.</p></div>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={onCancel}><X className="size-4"/></Button>
      </div>
      {pix.qrCode && <img src={pix.qrCode} alt="QR Code Pix Appmax" className="mx-auto size-56 max-w-full rounded-2xl border bg-white object-contain p-2"/>}
      {pix.emvCode && <div className="rounded-2xl border bg-muted/25 p-3">
        <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Pix copia e cola</p>
        <p className="mt-2 break-all text-xs">{pix.emvCode}</p>
        <Button variant="outline" className="mt-3 w-full rounded-xl" onClick={()=>navigator.clipboard.writeText(String(pix.emvCode)).then(()=>toast.success("Código Pix copiado"))}>
          <Copy className="mr-2 size-4"/> Copiar código Pix
        </Button>
      </div>}
      <Button className="w-full rounded-xl" variant="outline" onClick={manualCheck} disabled={submitting}>
        {submitting?<Loader2 className="mr-2 size-4 animate-spin"/>:<CheckCircle2 className="mr-2 size-4"/>} Já paguei
      </Button>
    </div>;
  }

  return <div className="w-full max-w-full space-y-4 overflow-hidden rounded-3xl border bg-white p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-emerald-600"/><p className="font-black">Pagamento seguro Appmax</p></div>
        <p className="mt-1 text-xs text-muted-foreground">O Appmax JS tokeniza o cartão; os dados sensíveis não passam pelo servidor da Hotbox.</p>
      </div>
      <Button variant="ghost" size="icon" className="rounded-full" onClick={onCancel}><X className="size-4"/></Button>
    </div>

    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/35 p-1">
      <button type="button" className={`rounded-xl px-3 py-2 text-sm font-black ${mode==="card"?"bg-white shadow-sm":""}`} onClick={()=>setMode("card")}><CreditCard className="mr-1 inline size-4"/> Cartão</button>
      <button type="button" className={`rounded-xl px-3 py-2 text-sm font-black ${mode==="pix"?"bg-white shadow-sm":""}`} onClick={()=>setMode("pix")}><QrCode className="mr-1 inline size-4"/> Pix</button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label>E-mail</Label><Input type="email" value={email} onChange={e=>{setEmail(e.target.value);emailRef.current=e.target.value;}} placeholder="seuemail@exemplo.com"/></div>
      <div><Label>CPF/CNPJ</Label><Input inputMode="numeric" value={document} onChange={e=>{setDocument(e.target.value);documentRef.current=e.target.value;}} placeholder="Somente números"/></div>
    </div>

    {mode==="pix" ? (
      <Button className="w-full rounded-xl bg-emerald-600 py-6 font-black hover:bg-emerald-700" onClick={createPix} disabled={submitting || !ready}>
        {submitting?<Loader2 className="mr-2 size-4 animate-spin"/>:<QrCode className="mr-2 size-4"/>} Gerar Pix • R$ {amount.toFixed(2).replace(".",",")}
      </Button>
    ) : (
      <form data-appmax-checkout className="space-y-3">
        <div><Label>Nome no cartão</Label><Input appmax-form-element="holder_name" name="holder_name" value={holderName} onChange={e=>{setHolderName(e.target.value);holderNameRef.current=e.target.value;}} autoComplete="cc-name" required/></div>
        <div><Label>Número do cartão</Label><Input appmax-form-element="number" name="card_number" inputMode="numeric" autoComplete="cc-number" required/></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Mês</Label><Input appmax-form-element="expiration_month" name="expiration_month" inputMode="numeric" placeholder="MM" autoComplete="cc-exp-month" required/></div>
          <div><Label>Ano</Label><Input appmax-form-element="expiration_year" name="expiration_year" inputMode="numeric" placeholder="AA" autoComplete="cc-exp-year" required/></div>
          <div><Label>CVV</Label><Input appmax-form-element="cvv" name="cvv" inputMode="numeric" placeholder="123" autoComplete="cc-csc" required/></div>
        </div>
        {maxParcels>1 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
          Parcelamento acima de 1x está preparado na configuração, mas fica bloqueado até a tabela oficial de parcelas/taxas Appmax ser conectada.
        </div>}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        {pending && <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">Pagamento em análise. A confirmação será automática.</p>}
        <Button type="submit" className="w-full rounded-xl py-6 font-black" disabled={submitting || !ready || !email.trim() || ![11,14].includes(digits(document).length)}>
          {submitting?<Loader2 className="mr-2 size-4 animate-spin"/>:<CreditCard className="mr-2 size-4"/>} Pagar R$ {amount.toFixed(2).replace(".",",")}
        </Button>
      </form>
    )}

    {error && <a href={supportWhatsappUrl} className="block text-center text-xs font-bold text-emerald-700">Precisa de ajuda? Falar com a Hotbox no WhatsApp</a>}
    <p className="text-center text-[10px] text-muted-foreground">Appmax • confirmação automática por webhook.</p>
  </div>;
}

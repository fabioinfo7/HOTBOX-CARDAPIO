import { createServerFn } from "@tanstack/react-start";

export type AppmaxConfig = {
  enabled: boolean;
  environment: "sandbox" | "production";
  merchantClientId: string;
  merchantClientSecret: string;
  externalId: string;
  maxInstallments: number;
  softDescriptor: string;
};

function cents(value: unknown) {
  return Math.round(Number(value || 0) * 100);
}
function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}
function splitName(value: string) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const first = parts.shift() || "Cliente";
  return { first, last: parts.join(" ") || "Hotbox" };
}
function apiBase(environment: "sandbox" | "production") {
  return environment === "production" ? "https://api.appmax.com.br" : "https://api.sandboxappmax.com.br";
}
function authBase(environment: "sandbox" | "production") {
  return environment === "production" ? "https://auth.appmax.com.br" : "https://auth.sandboxappmax.com.br";
}

export async function loadAppmaxConfig(supabaseAdmin: any): Promise<AppmaxConfig> {
  const { data } = await (supabaseAdmin as any)
    .from("store_config")
    .select("appmax_enabled,appmax_environment,appmax_merchant_client_id,appmax_merchant_client_secret,appmax_external_id,appmax_max_installments,appmax_soft_descriptor")
    .eq("id",1)
    .maybeSingle();
  return {
    enabled: data?.appmax_enabled === true,
    environment: data?.appmax_environment === "production" ? "production" : "sandbox",
    merchantClientId: String(data?.appmax_merchant_client_id || "").trim(),
    merchantClientSecret: String(data?.appmax_merchant_client_secret || "").trim(),
    externalId: String(data?.appmax_external_id || "").trim(),
    maxInstallments: Math.max(1,Math.min(12,Number(data?.appmax_max_installments || 1))),
    softDescriptor: String(data?.appmax_soft_descriptor || "HOTBOX").replace(/[^A-Za-z0-9 ]/g,"").slice(0,13) || "HOTBOX",
  };
}

async function appmaxAccessToken(cfg: AppmaxConfig) {
  if (!cfg.merchantClientId || !cfg.merchantClientSecret) return null;
  const body=new URLSearchParams({
    grant_type:"client_credentials",
    client_id:cfg.merchantClientId,
    client_secret:cfg.merchantClientSecret,
  });
  const response=await fetch(`${authBase(cfg.environment)}/oauth2/token`,{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
    body,
  });
  if (!response.ok) return null;
  const json:any=await response.json().catch(()=>({}));
  return String(json?.access_token || "").trim() || null;
}

async function appmaxFetch(cfg:AppmaxConfig,token:string,path:string,init:RequestInit={}) {
  return fetch(`${apiBase(cfg.environment)}${path}`,{
    ...init,
    headers:{
      Authorization:`Bearer ${token}`,
      Accept:"application/json",
      ...(init.body?{"Content-Type":"application/json"}:{}),
      ...(init.headers || {}),
    },
  });
}

function orderFrom(body:any) {
  return body?.data?.order || body?.order || null;
}
function paymentFrom(body:any) {
  return body?.data?.payment || body?.payment || null;
}

export async function fetchAppmaxOrder(cfg:AppmaxConfig,orderId:string|number) {
  const token=await appmaxAccessToken(cfg);
  if (!token) return {response:new Response(null,{status:401}),body:{}};
  const response=await appmaxFetch(cfg,token,`/v1/orders/${encodeURIComponent(String(orderId))}`);
  return {response,body:await response.json().catch(()=>({}))};
}

async function loadCheckout(supabaseAdmin:any,checkoutId:string) {
  const {data,error}=await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .select("id,status,total,subtotal,delivery_fee,coupon_discount,customer_name,customer_phone,order_data,items,expires_at,order_id,payment_provider,payment_kind,appmax_customer_id,appmax_order_id,appmax_status,appmax_payment_method,appmax_installments,appmax_pix_qr_code,appmax_pix_emv_code,appmax_pix_expires_at")
    .eq("id",checkoutId)
    .maybeSingle();
  return error?null:data;
}

export async function storeAppmaxSnapshot(supabaseAdmin:any,checkoutId:string,verification:any,webhookPayload?:any) {
  const order=orderFrom(verification) || {};
  const payment=paymentFrom(verification) || {};
  const paidCents=Number(order?.total_paid ?? 0);
  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      appmax_order_id:order?.id!=null?Number(order.id):undefined,
      appmax_status:String(order?.status || "") || null,
      appmax_payment_method:String(payment?.method || "") || null,
      appmax_installments:payment?.installments!=null?Number(payment.installments):null,
      appmax_total_paid_cents:Number.isFinite(paidCents)?paidCents:null,
      appmax_verified_at:new Date().toISOString(),
      appmax_verification_payload:verification,
      ...(webhookPayload!==undefined?{appmax_webhook_payload:webhookPayload}:{}),
      updated_at:new Date().toISOString(),
    })
    .eq("id",checkoutId);
}

export async function finalizeAppmaxIfApproved(supabaseAdmin:any,checkout:any,verification:any) {
  const order=orderFrom(verification);
  if (!order) return {ok:false,error:"Pedido Appmax não encontrado na verificação."} as const;

  const providerOrderId=String(order.id || "");
  if (!providerOrderId || String(checkout.appmax_order_id || "")!==providerOrderId) {
    return {ok:false,validation:true,error:"Pedido Appmax não pertence a este checkout."} as const;
  }

  const status=String(order.status || "").toLowerCase();
  // "autorizado" ainda está em análise antifraude. Só libera depois de aprovado.
  if (!["aprovado","integrado","pendente_integracao"].includes(status)) {
    return {ok:false,pending:true,status} as const;
  }

  const expected=cents(checkout.total);
  const paid=Math.round(Number(order.total_paid ?? 0));
  if (!paid || paid!==expected) {
    return {ok:false,validation:true,error:"Valor confirmado pela Appmax não confere com o checkout."} as const;
  }
  if (checkout.order_id) return {ok:true,order_id:String(checkout.order_id),already_created:true} as const;

  const payment=paymentFrom(verification) || {};
  const method=String(payment.method || checkout.appmax_payment_method || "").toLowerCase();
  const paymentKind=method.includes("pix")?"appmax_pix":"appmax_card";

  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      payment_provider:"appmax",
      payment_kind:paymentKind,
      appmax_status:status,
      appmax_payment_method:method || null,
      appmax_installments:payment?.installments!=null?Number(payment.installments):checkout.appmax_installments,
      appmax_total_paid_cents:paid,
      appmax_verified_at:new Date().toISOString(),
      appmax_verification_payload:verification,
      status:"payment_pending",
      updated_at:new Date().toISOString(),
    })
    .eq("id",checkout.id);

  const {data:finalized,error}=await (supabaseAdmin as any).rpc("finalize_site_checkout_paid",{
    p_checkout_id:checkout.id,
    p_confirmed_by:"appmax",
    p_provider_ref:providerOrderId,
    p_stripe_session_id:null,
  });
  if (error || !finalized?.ok) {
    return {ok:false,transient:true,error:error?.message || finalized?.error || "Falha ao gerar pedido."} as const;
  }

  try {
    const {notifyPaidSiteOrder}=await import("@/lib/site-checkout-notify.server");
    if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin,finalized.order_id);
  } catch(error) {
    console.error("[appmax] pedido criado; aviso WhatsApp falhou",error);
  }
  return {ok:true,order_id:finalized.order_id} as const;
}

async function ensureCustomerAndOrder(
  supabaseAdmin:any,
  cfg:AppmaxConfig,
  token:string,
  checkout:any,
  security:{ip:string;email:string;document:string},
) {
  const currentStatus=String(checkout.appmax_status || "").toLowerCase();
  if (
    checkout.appmax_customer_id &&
    checkout.appmax_order_id &&
    !["cancelado","estornado","recusado_por_risco"].includes(currentStatus)
  ) {
    return {customerId:Number(checkout.appmax_customer_id),orderId:Number(checkout.appmax_order_id)};
  }

  const {first,last}=splitName(String(checkout.customer_name || ""));
  const address=checkout.order_data || {};
  const customer:any={
    first_name:first,
    last_name:last,
    email:security.email,
    phone:onlyDigits(checkout.customer_phone),
    ip:security.ip,
    document_number:security.document,
  };
  if (String(address.delivery_mode || "delivery")==="delivery") {
    customer.address={
      postcode:onlyDigits(address.address_cep),
      street:String(address.address_street || ""),
      number:String(address.address_number || ""),
      complement:String(address.address_complement || ""),
      district:String(address.address_neighborhood || ""),
      city:String(address.address_city || "Duque de Caxias"),
      state:"RJ",
    };
  }

  const customerResponse=await appmaxFetch(cfg,token,"/v1/customers",{
    method:"POST",
    body:JSON.stringify(customer),
  });
  const customerBody:any=await customerResponse.json().catch(()=>({}));
  if (!customerResponse.ok) {
    throw new Error(customerBody?.error?.message || customerBody?.message || "A Appmax não aceitou os dados do cliente.");
  }
  const customerId=Number(customerBody?.data?.customer?.id ?? customerBody?.data?.id ?? 0);
  if (!customerId) throw new Error("A Appmax não retornou o ID do cliente.");

  const products=(checkout.items || []).map((item:any,index:number)=>({
    sku:String(item.product_id || `HB-${index+1}`).slice(0,80),
    name:String(item.product_name || "Item Hotbox").slice(0,180),
    quantity:Math.max(1,Math.floor(Number(item.qty || 1))),
    unit_value:cents(item.unit_price),
    type:"physical",
  }));

  const orderResponse=await appmaxFetch(cfg,token,"/v1/orders",{
    method:"POST",
    body:JSON.stringify({
      customer_id:customerId,
      products,
      shipping_value:cents(checkout.delivery_fee),
      discount_value:cents(checkout.coupon_discount),
    }),
  });
  const orderBody:any=await orderResponse.json().catch(()=>({}));
  if (!orderResponse.ok) {
    throw new Error(orderBody?.error?.message || orderBody?.message || "A Appmax não conseguiu criar o pedido.");
  }
  const orderId=Number(orderBody?.data?.order?.id ?? orderBody?.data?.id ?? 0);
  if (!orderId) throw new Error("A Appmax não retornou o ID do pedido.");

  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      appmax_customer_id:customerId,
      appmax_order_id:orderId,
      appmax_status:String(orderBody?.data?.order?.status || "pendente"),
      status:"payment_pending",
      updated_at:new Date().toISOString(),
    })
    .eq("id",checkout.id);

  return {customerId,orderId};
}

export const createAppmaxPayment=createServerFn({method:"POST"})
  .inputValidator((data:{
    checkoutId:string;
    method:"card"|"pix";
    ip:string;
    email:string;
    document:string;
    cardToken?:string|null;
    holderName?:string|null;
    installments?:number|null;
  })=>data)
  .handler(async({data})=>{
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const cfg=await loadAppmaxConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.merchantClientId || !cfg.merchantClientSecret || !cfg.externalId) {
      return {ok:false,error:"Appmax ainda não está completamente configurada."} as const;
    }

    const checkout=await loadCheckout(supabaseAdmin,data.checkoutId);
    if (!checkout) return {ok:false,error:"Checkout não encontrado."} as const;
    if (checkout.payment_provider!=="appmax") return {ok:false,error:"Este checkout pertence a outro provedor."} as const;
    if (checkout.order_id) return {ok:true,approved:true,order_id:checkout.order_id} as const;
    if (!["created","payment_pending"].includes(String(checkout.status))) return {ok:false,error:"Checkout indisponível."} as const;
    if (new Date(checkout.expires_at).getTime()<Date.now()) return {ok:false,error:"Checkout expirado. Refaça o pedido."} as const;

    const ip=String(data.ip || "").trim();
    const email=String(data.email || "").trim().toLowerCase();
    const document=onlyDigits(data.document);
    if (!ip) return {ok:false,error:"A Appmax ainda está coletando os dados de segurança. Aguarde alguns segundos."} as const;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return {ok:false,error:"Informe um e-mail válido."} as const;
    if (![11,14].includes(document.length)) return {ok:false,error:"Informe um CPF ou CNPJ válido."} as const;

    const token=await appmaxAccessToken(cfg);
    if (!token) return {ok:false,error:"Não foi possível autenticar na Appmax. Confira as credenciais do merchant."} as const;

    try {
      const remote=await ensureCustomerAndOrder(supabaseAdmin,cfg,token,checkout,{ip,email,document});

      if (data.method==="pix") {
        if (checkout.appmax_pix_emv_code) {
          return {
            ok:true,pending:true,method:"pix",orderId:remote.orderId,
            qrCode:checkout.appmax_pix_qr_code,
            emvCode:checkout.appmax_pix_emv_code,
            expiresAt:checkout.appmax_pix_expires_at,
          } as const;
        }

        const response=await appmaxFetch(cfg,token,"/v1/payments/pix",{
          method:"POST",
          body:JSON.stringify({
            order_id:remote.orderId,
            payment_data:{pix:{document_number:document}},
          }),
        });
        const body:any=await response.json().catch(()=>({}));
        if (!response.ok) return {ok:false,error:body?.error?.message || body?.message || "Não foi possível gerar o Pix Appmax."} as const;
        const pix=body?.data?.pix || {};
        await (supabaseAdmin as any).from("site_checkout_sessions").update({
          payment_kind:"appmax_pix",
          payment_provider:"appmax",
          appmax_payment_method:"pix",
          appmax_status:String(body?.data?.order?.status || "pendente"),
          appmax_pix_qr_code:pix.qr_code || null,
          appmax_pix_emv_code:pix.emv_code || null,
          appmax_pix_expires_at:pix.expires_at || null,
          updated_at:new Date().toISOString(),
        }).eq("id",checkout.id);

        return {
          ok:true,pending:true,method:"pix",orderId:remote.orderId,
          qrCode:pix.qr_code || null,emvCode:pix.emv_code || null,expiresAt:pix.expires_at || null,
        } as const;
      }

      const cardToken=String(data.cardToken || "").trim();
      if (!cardToken) return {ok:false,error:"Token seguro do cartão não recebido. Tente novamente."} as const;
      const installments=Math.max(1,Math.min(cfg.maxInstallments,Number(data.installments || 1)));
      if (installments>1) {
        return {ok:false,error:"Parcelamento Appmax acima de 1x está preparado, mas deve ser liberado depois de configurar o cálculo oficial de parcelas/taxas."} as const;
      }

      const response=await appmaxFetch(cfg,token,"/v1/payments/credit-card",{
        method:"POST",
        body:JSON.stringify({
          order_id:remote.orderId,
          customer_id:remote.customerId,
          payment_data:{credit_card:{
            token:cardToken,
            holder_document_number:document,
            holder_name:String(data.holderName || checkout.customer_name || "").trim(),
            installments,
            soft_descriptor:cfg.softDescriptor,
          }},
        }),
      });
      const body:any=await response.json().catch(()=>({}));
      if (!response.ok) {
        return {ok:false,rejected:true,error:body?.error?.message || body?.message || "Pagamento não autorizado pela Appmax."} as const;
      }

      await (supabaseAdmin as any).from("site_checkout_sessions").update({
        payment_provider:"appmax",
        payment_kind:"appmax_card",
        appmax_payment_method:"creditcard",
        appmax_installments:installments,
        appmax_status:String(body?.data?.order?.status || "autorizado"),
        status:"payment_pending",
        updated_at:new Date().toISOString(),
      }).eq("id",checkout.id);

      // "autorizado" ainda não cria pedido. Tenta uma verificação imediata;
      // webhook/polling concluirão quando mudar para "aprovado".
      const verified=await fetchAppmaxOrder(cfg,remote.orderId);
      if (verified.response.ok) {
        await storeAppmaxSnapshot(supabaseAdmin,checkout.id,verified.body);
        const fresh=await loadCheckout(supabaseAdmin,checkout.id);
        const final=fresh?await finalizeAppmaxIfApproved(supabaseAdmin,fresh,verified.body):null;
        if (final?.ok) return {ok:true,approved:true,order_id:final.order_id} as const;
      }

      return {ok:true,pending:true,method:"card",orderId:remote.orderId,message:"Pagamento autorizado e em análise. A confirmação será automática."} as const;
    } catch(error:any) {
      return {ok:false,error:String(error?.message || "Falha ao iniciar pagamento na Appmax.")} as const;
    }
  });

export const checkAppmaxPayment=createServerFn({method:"POST"})
  .inputValidator((data:{checkoutId:string})=>data)
  .handler(async({data})=>{
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const cfg=await loadAppmaxConfig(supabaseAdmin);
    const checkout=await loadCheckout(supabaseAdmin,data.checkoutId);
    if (!checkout) return {ok:false,error:"Checkout não encontrado."} as const;
    if (checkout.order_id) return {ok:true,approved:true,order_id:checkout.order_id,checkout_id:checkout.id,total:checkout.total} as const;
    if (!checkout.appmax_order_id) return {ok:true,pending:true,status:"aguardando_pagamento"} as const;

    const verified=await fetchAppmaxOrder(cfg,checkout.appmax_order_id);
    if (!verified.response.ok) return {ok:false,error:"Não foi possível consultar a Appmax agora."} as const;
    await storeAppmaxSnapshot(supabaseAdmin,checkout.id,verified.body);
    const fresh=await loadCheckout(supabaseAdmin,checkout.id);
    const final=fresh?await finalizeAppmaxIfApproved(supabaseAdmin,fresh,verified.body):null;
    if (final?.ok) {
      return {ok:true,approved:true,order_id:final.order_id,checkout_id:checkout.id,total:checkout.total,payment_method:fresh?.appmax_payment_method || "appmax"} as const;
    }
    const order=orderFrom(verified.body) || {};
    return {ok:true,pending:true,status:String(order.status || "pendente"),checkout_id:checkout.id,total:checkout.total} as const;
  });

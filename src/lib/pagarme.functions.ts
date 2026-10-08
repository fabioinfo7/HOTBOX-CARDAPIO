import { createServerFn } from "@tanstack/react-start";

export type PagarmeMethod = "pix" | "card";

type BillingAddressInput = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
  complement?: string | null;
};

export async function loadPagarmeConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("pagarme_enabled,pagarme_public_key,pagarme_secret_key,pagarme_webhook_token,pagarme_max_installments")
    .eq("id", 1)
    .maybeSingle();

  return {
    enabled: data?.pagarme_enabled === true,
    publicKey: String(data?.pagarme_public_key || "").trim(),
    secretKey: String(data?.pagarme_secret_key || "").trim(),
    webhookToken: String(data?.pagarme_webhook_token || "").trim(),
    maxInstallments: Math.min(12, Math.max(1, Number(data?.pagarme_max_installments || 1))),
  };
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(email) ? email : "";
}

function phoneParts(value: unknown) {
  let d = digits(value);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  const areaCode = d.slice(0, 2);
  const number = d.slice(2);
  return { areaCode, number };
}

function basicAuth(secretKey: string) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

async function pagarmeFetch(secretKey: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.pagar.me/core/v5${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(secretKey),
      "User-Agent": "hotbox-delivery/1.0",
      ...(init?.headers || {}),
    },
  });
  const body: any = await response.json().catch(() => ({}));
  return { response, body };
}

function getCharge(order: any) {
  return Array.isArray(order?.charges) ? order.charges[0] : null;
}

function getTransaction(order: any) {
  const charge = getCharge(order);
  return charge?.last_transaction || null;
}

function orderPaid(order: any) {
  const charge = getCharge(order);
  return String(order?.status || "") === "paid" || String(charge?.status || "") === "paid";
}

function orderRejected(order: any) {
  const charge = getCharge(order);
  const status = String(order?.status || charge?.status || "").toLowerCase();
  return ["failed", "canceled", "cancelled"].includes(status);
}

function rejectionMessage(order: any) {
  const tx = getTransaction(order);
  const gatewayMessage =
    tx?.gateway_response?.errors?.[0]?.message ||
    tx?.acquirer_message ||
    tx?.status_reason ||
    getCharge(order)?.last_transaction?.status_reason ||
    "";
  return gatewayMessage
    ? `O cartão não foi aprovado: ${String(gatewayMessage)}`
    : "O cartão não foi aprovado. Tente outro cartão, pague com Pix ou solicite um link pelo WhatsApp.";
}

function buildAddress(input: BillingAddressInput) {
  const cep = digits(input.cep).slice(0, 8);
  return {
    line_1: `${String(input.number || "S/N").trim()}, ${String(input.street || "").trim()}, ${String(input.neighborhood || "").trim()}`,
    line_2: String(input.complement || "").trim() || undefined,
    zip_code: cep,
    city: String(input.city || "").trim(),
    state: String(input.state || "RJ").trim().toUpperCase().slice(0, 2),
    country: "BR",
  };
}

function normalizePagarmeSnapshot(order: any) {
  const charge = getCharge(order);
  const tx = getTransaction(order);
  return {
    pagarme_order_id: order?.id ? String(order.id) : null,
    pagarme_status: String(order?.status || charge?.status || ""),
    pagarme_charge_id: charge?.id ? String(charge.id) : null,
    pagarme_transaction_id: tx?.id ? String(tx.id) : null,
    pagarme_qr_code: tx?.qr_code ? String(tx.qr_code) : null,
    pagarme_qr_code_url: tx?.qr_code_url ? String(tx.qr_code_url) : null,
    pagarme_verified_at: new Date().toISOString(),
    pagarme_verification_payload: order,
    updated_at: new Date().toISOString(),
  };
}

export async function storePagarmeSnapshot(supabaseAdmin: any, checkoutId: string, order: any, webhookPayload?: any) {
  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      ...normalizePagarmeSnapshot(order),
      ...(webhookPayload !== undefined ? { pagarme_webhook_payload: webhookPayload } : {}),
      status: orderPaid(order) ? "payment_pending" : orderRejected(order) ? "payment_failed" : "payment_pending",
    })
    .eq("id", checkoutId);
}

export async function finalizePagarmeIfPaid(
  supabaseAdmin: any,
  checkout: any,
  order: any,
  onFinalized?: (orderId: string) => Promise<void>,
) {
  const expectedCents = Math.round(Number(checkout.total || 0) * 100);
  const paidCents = Number(order?.amount || 0);
  const reference = String(order?.code || order?.metadata?.checkout_id || "").trim();
  if (reference !== String(checkout.id)) return { ok: false, error: "Referência do Pagar.me não confere com o checkout." } as const;
  if (paidCents !== expectedCents) return { ok: false, error: "Valor confirmado pelo Pagar.me não confere com o pedido." } as const;
  if (String(order?.currency || "BRL").toUpperCase() !== "BRL") return { ok: false, error: "Moeda do pagamento inválida." } as const;
  if (!orderPaid(order)) return { ok: false, pending: !orderRejected(order), rejected: orderRejected(order), error: orderRejected(order) ? rejectionMessage(order) : undefined } as const;
  if (checkout.order_id) return { ok: true, order_id: String(checkout.order_id), already_created: true } as const;

  const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
    p_checkout_id: checkout.id,
    p_confirmed_by: "pagarme",
    p_provider_ref: String(order?.id || ""),
    p_stripe_session_id: null,
  });
  if (error || !finalized?.ok) return { ok: false, error: error?.message || finalized?.error || "Falha ao gerar pedido." } as const;

  if (finalized.order_id && onFinalized) {
    try {
      await onFinalized(String(finalized.order_id));
    } catch (e) {
      console.error("[pagarme] pagamento confirmado, mas aviso WhatsApp falhou", e);
    }
  }
  return { ok: true, order_id: finalized.order_id } as const;
}

export const createPagarmePayment = createServerFn({ method: "POST" })
  .inputValidator((data: {
    checkoutId: string;
    method: PagarmeMethod;
    cardToken?: string | null;
    email: string;
    document: string;
    installments?: number;
    billingAddress?: BillingAddressInput | null;
  }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadPagarmeConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.publicKey || !cfg.secretKey) {
      return { ok: false, error: "Pagar.me não está configurado corretamente." } as const;
    }

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,total,subtotal,coupon_discount,customer_name,customer_phone,order_data,items,delivery_fee,expires_at,order_id,payment_provider,payment_kind,pagarme_order_id,pagarme_attempt_no")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.payment_provider !== "pagarme") return { ok: false, error: "Este checkout pertence a outro provedor de pagamento." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;
    if (!["created", "payment_pending", "payment_failed"].includes(String(checkout.status))) return { ok: false, error: "Este checkout não está mais disponível." } as const;
    if (new Date(checkout.expires_at).getTime() < Date.now()) return { ok: false, error: "Este checkout expirou. Refaça o pedido." } as const;

    const kind = String(checkout.payment_kind || "");
    const expectedMethod = kind.endsWith("_pix") ? "pix" : kind.endsWith("_card") ? "card" : null;
    if (expectedMethod && data.method !== expectedMethod) return { ok: false, error: "Forma de pagamento diferente da selecionada." } as const;

    const email = normalizeEmail(data.email);
    const document = digits(data.document);
    if (!email) return { ok: false, error: "Informe um e-mail válido." } as const;
    if (document.length !== 11 && document.length !== 14) return { ok: false, error: "Informe um CPF/CNPJ válido para o pagamento." } as const;

    const items = Array.isArray(checkout.items) ? checkout.items : [];
    let pagarmeItems: Array<{ amount: number; description: string; quantity: number; code?: string }>;
    if (Number(checkout.coupon_discount || 0) > 0) {
      pagarmeItems = [{ amount: Math.round(Number(checkout.total) * 100), description: "Pedido HotBox Delivery — desconto aplicado", quantity: 1, code: String(checkout.id).slice(0, 52) }];
    } else {
      pagarmeItems = items.map((item: any) => ({
        amount: Math.round(Number(item.unit_price || 0) * 100),
        description: String(item.product_name || "Produto HotBox").slice(0, 255),
        quantity: Math.max(1, Number(item.qty || 1)),
        code: String(item.product_id || "produto").slice(0, 52),
      }));
      if (Number(checkout.delivery_fee || 0) > 0) {
        pagarmeItems.push({ amount: Math.round(Number(checkout.delivery_fee) * 100), description: "Taxa de entrega", quantity: 1, code: "delivery_fee" });
      }
    }

    const phone = phoneParts(checkout.customer_phone);
    const customer: any = {
      name: String(checkout.customer_name || "Cliente HotBox"),
      email,
      type: document.length === 14 ? "company" : "individual",
      document,
    };
    if (phone.areaCode && phone.number) {
      customer.phones = {
        mobile_phone: {
          country_code: "55",
          area_code: phone.areaCode,
          number: phone.number,
        },
      };
    }

    const payment: any = data.method === "pix"
      ? { payment_method: "pix", pix: { expires_in: 20 * 60 } }
      : {
          payment_method: "credit_card",
          credit_card: {
            installments: Math.min(cfg.maxInstallments, Math.max(1, Number(data.installments || 1))),
            statement_descriptor: "HOTBOX",
            card_token: String(data.cardToken || ""),
            billing_address: data.billingAddress ? buildAddress(data.billingAddress) : undefined,
          },
        };

    if (data.method === "card") {
      if (!data.cardToken) return { ok: false, error: "Token do cartão não foi gerado. Tente novamente." } as const;
      if (!data.billingAddress || digits(data.billingAddress.cep).length !== 8) return { ok: false, error: "Informe o endereço de cobrança do cartão." } as const;
    }

    const body = {
      code: String(checkout.id).slice(0, 52),
      items: pagarmeItems,
      customer,
      payments: [payment],
      closed: true,
      metadata: { checkout_id: String(checkout.id), source: "hotbox_cardapio" },
    };

    const created = await pagarmeFetch(cfg.secretKey, "/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!created.response.ok || !created.body?.id) {
      const apiMessage = created.body?.message || created.body?.errors?.[0]?.message || created.body?.errors?.[0]?.parameter || "Não foi possível processar o pagamento.";
      return { ok: false, rejected: data.method === "card", error: String(apiMessage) } as const;
    }

    await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .update({
        status: orderRejected(created.body) ? "payment_failed" : "payment_pending",
        pagarme_attempt_no: ((Number((checkout as any).pagarme_attempt_no || 0) || 0) + 1),
        ...normalizePagarmeSnapshot(created.body),
      })
      .eq("id", checkout.id);

    const finalized = await finalizePagarmeIfPaid(supabaseAdmin, checkout, created.body, async (orderId: string) => {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
      await notifyPaidSiteOrder(supabaseAdmin, orderId);
    });

    if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, pagarmeOrderId: String(created.body.id) } as const;
    if (finalized.rejected) {
      return { ok: false, rejected: true, error: finalized.error || rejectionMessage(created.body), pagarmeOrderId: String(created.body.id) } as const;
    }

    const tx = getTransaction(created.body);
    return {
      ok: true,
      approved: false,
      pending: true,
      pagarmeOrderId: String(created.body.id),
      status: String(created.body.status || getCharge(created.body)?.status || "pending"),
      qrCode: tx?.qr_code ? String(tx.qr_code) : null,
      qrCodeUrl: tx?.qr_code_url ? String(tx.qr_code_url) : null,
      message: data.method === "pix" ? "Pix gerado. Aguardando pagamento." : "Pagamento em processamento.",
    } as const;
  });

export const checkPagarmePayment = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadPagarmeConfig(supabaseAdmin);
    if (!cfg.secretKey) return { ok: false, error: "Pagar.me não configurado." } as const;

    const { data: checkout } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,total,order_id,status,payment_provider,payment_kind,pagarme_order_id")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (!checkout || checkout.payment_provider !== "pagarme") return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;
    if (!checkout.pagarme_order_id) return { ok: false, error: "Pagamento ainda não iniciado." } as const;

    const fetched = await pagarmeFetch(cfg.secretKey, `/orders/${encodeURIComponent(String(checkout.pagarme_order_id))}`, { method: "GET" });
    if (!fetched.response.ok || !fetched.body?.id) return { ok: false, error: "Não foi possível consultar o pagamento agora." } as const;

    await storePagarmeSnapshot(supabaseAdmin, checkout.id, fetched.body);
    const finalized = await finalizePagarmeIfPaid(supabaseAdmin, checkout, fetched.body, async (orderId: string) => {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
      await notifyPaidSiteOrder(supabaseAdmin, orderId);
    });
    if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id } as const;
    if (finalized.rejected) return { ok: true, approved: false, rejected: true, message: finalized.error || rejectionMessage(fetched.body) } as const;

    const tx = getTransaction(fetched.body);
    return {
      ok: true,
      approved: false,
      pending: true,
      status: String(fetched.body.status || getCharge(fetched.body)?.status || "pending"),
      qrCode: tx?.qr_code ? String(tx.qr_code) : null,
      qrCodeUrl: tx?.qr_code_url ? String(tx.qr_code_url) : null,
    } as const;
  });

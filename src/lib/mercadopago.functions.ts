import { createServerFn } from "@tanstack/react-start";

export type MercadoPagoPublicConfig = {
  provider: "mercadopago" | "infinitepay";
  paymentAvailable: boolean;
  mercadopagoEnabled: boolean;
  infinitepayEnabled: boolean;
  mercadopagoPublicKey: string;
  maxInstallments: number;
  environment: "test" | "production";
};

export async function loadMercadoPagoConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("digital_payment_provider,mercadopago_enabled,mercadopago_public_key,mercadopago_access_token,mercadopago_webhook_token,mercadopago_max_installments,mercadopago_environment")
    .eq("id", 1)
    .maybeSingle();

  return {
    provider: String(data?.digital_payment_provider || "infinitepay") as "mercadopago" | "infinitepay",
    enabled: data?.mercadopago_enabled === true,
    publicKey: String(data?.mercadopago_public_key || "").trim(),
    accessToken: String(data?.mercadopago_access_token || "").trim(),
    webhookToken: String(data?.mercadopago_webhook_token || "").trim(),
    maxInstallments: Math.min(12, Math.max(1, Number(data?.mercadopago_max_installments || 1))),
    environment: data?.mercadopago_environment === "production" ? "production" : "test",
  };
}

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(email) ? email : "";
}

function firstPayment(order: any) {
  return Array.isArray(order?.transactions?.payments) ? order.transactions.payments[0] || null : null;
}

export function mercadoPagoOrderState(order: any) {
  const payment = firstPayment(order) || {};
  const orderStatus = String(order?.status || "");
  const orderDetail = String(order?.status_detail || "");
  const paymentStatus = String(payment?.status || "");
  const paymentDetail = String(payment?.status_detail || "");
  const approved =
    orderStatus === "processed" &&
    (paymentStatus === "processed" || paymentStatus === "approved" || paymentDetail === "accredited" || orderDetail === "accredited");
  const rejected = ["failed", "canceled", "cancelled"].includes(orderStatus) || ["failed", "rejected", "canceled", "cancelled"].includes(paymentStatus);
  const pending = !approved && !rejected && orderStatus !== "refunded";
  return { orderStatus, orderDetail, paymentStatus, paymentDetail, approved, rejected, pending };
}

function statusMessage(order: any) {
  const state = mercadoPagoOrderState(order);
  if (state.approved) return "Pagamento aprovado.";
  if (state.orderStatus === "refunded") return "Pagamento estornado.";
  if (state.paymentDetail === "pending_challenge") return "Seu banco precisa confirmar esta compra.";
  if (state.pending) return "Pagamento aguardando confirmação. Não envie novamente.";
  const detail = state.paymentDetail || state.orderDetail;
  const map: Record<string, string> = {
    cc_rejected_bad_filled_card_number: "Confira o número do cartão.",
    cc_rejected_bad_filled_date: "Confira a validade do cartão.",
    cc_rejected_bad_filled_security_code: "Confira o código de segurança do cartão.",
    cc_rejected_insufficient_amount: "O cartão não possui limite disponível para esta compra.",
    cc_rejected_call_for_authorize: "O banco pediu autorização. Entre em contato com o emissor ou tente outro cartão.",
    cc_rejected_card_disabled: "O cartão está temporariamente bloqueado. Use outro cartão ou fale com o banco.",
    cc_rejected_duplicated_payment: "Este pagamento já foi enviado. Aguarde a confirmação antes de tentar novamente.",
    cc_rejected_high_risk: "O pagamento não pôde ser aprovado pela análise de segurança. Tente outro cartão ou Pix.",
    cc_rejected_3ds_challenge: "Não foi possível confirmar a autenticação do banco. Tente novamente ou use outro meio de pagamento.",
  };
  return map[detail] || "O pagamento não foi aprovado. Você pode tentar novamente ou escolher outro meio de pagamento.";
}

export async function fetchMercadoPagoOrder(accessToken: string, orderId: string) {
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const body: any = await response.json().catch(() => ({}));
    return { response, body };
  } catch {
    return { response: { ok: false, status: 503 } as any, body: {} as any };
  }
}

function orderPaymentInfo(order: any) {
  const payment = firstPayment(order) || {};
  const method = payment?.payment_method || {};
  const amount = Number(payment?.paid_amount ?? payment?.amount ?? order?.total_amount ?? 0);
  return {
    orderId: order?.id != null ? String(order.id) : "",
    paymentId: payment?.id != null ? String(payment.id) : "",
    amount,
    paymentMethodId: String(method?.id || ""),
    paymentTypeId: String(method?.type || ""),
    installments: Math.max(1, Number(method?.installments || payment?.installments || 1)),
    qrCode: method?.qr_code ? String(method.qr_code) : null,
    qrCodeBase64: method?.qr_code_base64 ? String(method.qr_code_base64) : null,
    ticketUrl: method?.ticket_url ? String(method.ticket_url) : null,
    challengeUrl: method?.three_ds?.external_resource_url || payment?.three_ds_info?.external_resource_url || null,
    challengeCreq: method?.three_ds?.creq || payment?.three_ds_info?.creq || null,
  };
}

export async function storeMercadoPagoSnapshot(supabaseAdmin: any, checkoutId: string, order: any, webhookPayload?: any) {
  const info = orderPaymentInfo(order);
  const state = mercadoPagoOrderState(order);
  const kind = info.paymentMethodId === "pix" || info.paymentTypeId === "bank_transfer" ? "mercadopago_pix" : "mercadopago_card";
  const { data: current } = await (supabaseAdmin as any).from("site_checkout_sessions").select("status").eq("id", checkoutId).maybeSingle();
  const checkoutStatus = String(current?.status || "");

  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      payment_provider: "mercadopago",
      payment_kind: kind,
      mercadopago_order_id: info.orderId || null,
      mercadopago_payment_id: info.paymentId || null,
      mercadopago_order_status: state.orderStatus || null,
      mercadopago_order_status_detail: state.orderDetail || null,
      mercadopago_status: state.paymentStatus || state.orderStatus || null,
      mercadopago_status_detail: state.paymentDetail || state.orderDetail || null,
      mercadopago_payment_method_id: info.paymentMethodId || null,
      mercadopago_payment_type_id: info.paymentTypeId || null,
      mercadopago_installments: info.installments,
      mercadopago_transaction_amount: info.amount || null,
      mercadopago_qr_code: info.qrCode,
      mercadopago_qr_code_base64: info.qrCodeBase64,
      mercadopago_ticket_url: info.ticketUrl,
      mercadopago_verified_at: new Date().toISOString(),
      mercadopago_verification_payload: order,
      ...(webhookPayload !== undefined ? { mercadopago_webhook_payload: webhookPayload } : {}),
      status: checkoutStatus === "paid" ? "paid" : "payment_pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutId);

  return { kind, ...info, ...state };
}

export async function finalizeIfApproved(
  supabaseAdmin: any,
  checkout: any,
  order: any,
  onFinalized?: (orderId: string) => Promise<void>,
) {
  const state = mercadoPagoOrderState(order);
  const info = orderPaymentInfo(order);
  const expected = Number(Number(checkout.total || 0).toFixed(2));
  const paid = Number(Number(info.amount || 0).toFixed(2));
  const reference = String(order?.external_reference || "");

  if (reference !== String(checkout.id)) return { ok: false, validation: true, error: "Referência da order não confere com o checkout." } as const;
  if (paid !== expected) return { ok: false, validation: true, error: "Valor confirmado pelo Mercado Pago não confere com o pedido." } as const;
  if (String(order?.currency || order?.currency_id || "BRL").toUpperCase() !== "BRL") return { ok: false, validation: true, error: "Moeda do pagamento inválida." } as const;
  if (!state.approved) return { ok: false, pending: state.pending, rejected: state.rejected } as const;

  if (checkout.order_id) return { ok: true, order_id: String(checkout.order_id), already_created: true } as const;

  const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
    p_checkout_id: checkout.id,
    p_confirmed_by: "mercadopago",
    p_provider_ref: info.orderId || info.paymentId,
    p_stripe_session_id: null,
  });
  if (error || !finalized?.ok) return { ok: false, transient: true, error: error?.message || finalized?.error || "Falha ao gerar pedido." } as const;

  if (finalized.order_id && onFinalized) {
    try {
      await onFinalized(String(finalized.order_id));
    } catch (e) {
      console.error("[mercadopago] pagamento confirmado, mas aviso WhatsApp falhou", e);
    }
  }
  return { ok: true, order_id: finalized.order_id } as const;
}

function paymentResult(order: any) {
  const info = orderPaymentInfo(order);
  const state = mercadoPagoOrderState(order);
  return {
    orderId: info.orderId,
    paymentId: info.paymentId,
    status: state.paymentStatus || state.orderStatus || "pending",
    statusDetail: state.paymentDetail || state.orderDetail || "",
    message: statusMessage(order),
    qrCode: info.qrCode,
    qrCodeBase64: info.qrCodeBase64,
    ticketUrl: info.ticketUrl,
    challengeUrl: info.challengeUrl ? String(info.challengeUrl) : null,
    challengeCreq: info.challengeCreq ? String(info.challengeCreq) : null,
    approved: state.approved,
    rejected: state.rejected,
    pending: state.pending,
  };
}

export const createMercadoPagoPayment = createServerFn({ method: "POST" })
  .inputValidator((data: {
    checkoutId: string;
    origin: string;
    formData: any;
    deviceId?: string | null;
    attemptId: string;
  }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const notifyPaid = async (orderId: string) => {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
      await notifyPaidSiteOrder(supabaseAdmin, orderId);
    };
    const cfg = await loadMercadoPagoConfig(supabaseAdmin);
    if (!cfg.publicKey || !cfg.accessToken) return { ok: false, error: "Mercado Pago não está configurado corretamente." } as const;

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,total,customer_name,customer_phone,order_data,items,expires_at,order_id,payment_provider,mercadopago_order_id,mercadopago_payment_id,mercadopago_status,mercadopago_attempt_no")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.payment_provider !== "mercadopago") return { ok: false, error: "Este checkout pertence a outro provedor de pagamento." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id, checkout_id: String(checkout.id), total: Number(checkout.total || 0), payment_method: "mercadopago" } as const;
    if (!["created", "payment_pending"].includes(String(checkout.status))) return { ok: false, error: "Este checkout não está mais disponível." } as const;
    // A expiração impede iniciar uma NOVA cobrança. Uma order já criada continua podendo ser confirmada depois.
    if (!checkout.mercadopago_order_id && new Date(checkout.expires_at).getTime() < Date.now()) return { ok: false, error: "Este checkout expirou. Refaça o pedido." } as const;

    if (checkout.mercadopago_order_id) {
      const existing = await fetchMercadoPagoOrder(cfg.accessToken, String(checkout.mercadopago_order_id));
      if (existing.response.ok) {
        await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, existing.body);
        const finalized = await finalizeIfApproved(supabaseAdmin, checkout, existing.body, notifyPaid);
        const result = paymentResult(existing.body);
        if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, orderId: result.orderId, paymentId: result.paymentId } as const;
        if (!result.rejected) return { ok: true, ...result } as const;
      }
    }

    const fd = data.formData || {};
    const paymentMethodId = String(fd.payment_method_id || fd.paymentMethodId || "").trim();
    if (!paymentMethodId) return { ok: false, error: "Selecione Pix ou cartão para continuar." } as const;
    const isPix = paymentMethodId === "pix";
    const payer = fd.payer || {};
    const submittedEmail = normalizeEmail(payer.email);
    const email =
      cfg.environment === "test"
        ? (isPix ? "test_user_br@testuser.com" : "test@testuser.com")
        : submittedEmail;
    if (!email) return { ok: false, error: "Informe um e-mail válido para o pagamento." } as const;
    const installments = Math.min(cfg.maxInstallments, Math.max(1, Number(fd.installments || 1)));

    const paymentMethod: any = isPix
      ? { id: "pix", type: "bank_transfer" }
      : {
          id: paymentMethodId,
          type: "credit_card",
          token: String(fd.token || "").trim(),
          installments,
        };
    if (!isPix && !paymentMethod.token) return { ok: false, error: "Os dados do cartão não foram tokenizados. Tente novamente." } as const;

    const body: any = {
      type: "online",
      processing_mode: "automatic",
      total_amount: Number(checkout.total).toFixed(2),
      external_reference: String(checkout.id),
      payer: { email },
      metadata: {
        checkout_id: String(checkout.id),
        hotbox_environment: cfg.environment,
      },
      transactions: {
        payments: [{ amount: Number(checkout.total).toFixed(2), payment_method: paymentMethod }],
      },
    };

    const attemptNo = Math.max(1, Number(checkout.mercadopago_attempt_no || 1));
    const idempotencyKey = `hotbox-order-${checkout.id}-${attemptNo}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Idempotency-Key": idempotencyKey,
    };
    if (data.deviceId) headers["X-meli-session-id"] = String(data.deviceId).slice(0, 200);

    let response: Response;
    let created: any;
    try {
      response = await fetch("https://api.mercadopago.com/v1/orders", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      created = await response.json().catch(() => ({}));
    } catch {
      return { ok: false, error: "O Mercado Pago não respondeu agora. Aguarde alguns segundos e tente novamente; a proteção contra cobrança duplicada será mantida." } as const;
    }

    if (!response.ok || !created?.id) {
      const errors = Array.isArray(created?.errors) ? created.errors.map((x: any) => x?.message || x?.code).filter(Boolean).join(" · ") : "";
      const cause = errors || created?.message || created?.error;
      const rawMessage = String(cause || "Não foi possível iniciar a order pelo Mercado Pago.");
      const environmentHint =
        cfg.environment === "test" && /Unauthorized use of live credentials/i.test(rawMessage)
          ? " O Mercado Pago recusou a credencial no ambiente de teste. Confirme se Public Key e Access Token vieram da mesma tela 'Credenciais de teste' desta aplicação."
          : "";
      return { ok: false, error: `${rawMessage}${environmentHint}` } as const;
    }

    await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, created);
    const verified = await fetchMercadoPagoOrder(cfg.accessToken, String(created.id));
    const order = verified.response.ok ? verified.body : created;
    if (verified.response.ok) await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, order);

    const finalized = await finalizeIfApproved(supabaseAdmin, checkout, order, notifyPaid);
    const result = paymentResult(order);
    if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, orderId: result.orderId, paymentId: result.paymentId } as const;

    if (result.rejected) {
      await (supabaseAdmin as any).from("site_checkout_sessions")
        .update({ mercadopago_attempt_no: attemptNo + 1, updated_at: new Date().toISOString() })
        .eq("id", checkout.id);
      return { ok: false, rejected: true, orderId: result.orderId, paymentId: result.paymentId, status: result.status, statusDetail: result.statusDetail, error: result.message } as const;
    }

    return { ok: true, ...result } as const;
  });

export const checkMercadoPagoPayment = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; orderId?: string | null; paymentId?: string | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const notifyPaid = async (orderId: string) => {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
      await notifyPaidSiteOrder(supabaseAdmin, orderId);
    };
    const cfg = await loadMercadoPagoConfig(supabaseAdmin);
    if (!cfg.accessToken) return { ok: false, error: "Mercado Pago não está configurado corretamente." } as const;

    const { data: checkout } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,total,order_id,payment_provider,mercadopago_order_id,mercadopago_payment_id,mercadopago_status,mercadopago_attempt_no")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (!checkout || checkout.payment_provider !== "mercadopago") return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;

    const orderId = String(data.orderId || checkout.mercadopago_order_id || "");
    if (!orderId) return { ok: false, error: "Pagamento ainda não iniciado." } as const;
    const verified = await fetchMercadoPagoOrder(cfg.accessToken, orderId);
    if (!verified.response.ok) return { ok: false, error: "Não foi possível consultar a order agora." } as const;

    const previousStatus = String(checkout.mercadopago_status || "");
    await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, verified.body);
    const finalized = await finalizeIfApproved(supabaseAdmin, checkout, verified.body, notifyPaid);
    const result = paymentResult(verified.body);
    if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, checkout_id: String(checkout.id), total: Number(checkout.total || 0), payment_method: "mercadopago", orderId: result.orderId, paymentId: result.paymentId } as const;

    if (result.rejected && previousStatus !== "rejected" && previousStatus !== "cancelled") {
      await (supabaseAdmin as any).from("site_checkout_sessions")
        .update({ mercadopago_attempt_no: Math.max(1, Number(checkout.mercadopago_attempt_no || 1)) + 1, updated_at: new Date().toISOString() })
        .eq("id", checkout.id);
    }

    return { ok: true, ...result } as const;
  });

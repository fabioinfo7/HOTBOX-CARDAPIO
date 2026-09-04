import { createServerFn } from "@tanstack/react-start";

export type MercadoPagoPublicConfig = {
  provider: "mercadopago" | "infinitepay";
  paymentAvailable: boolean;
  mercadopagoEnabled: boolean;
  infinitepayEnabled: boolean;
  mercadopagoPublicKey: string;
  maxInstallments: number;
};

export async function loadMercadoPagoConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("digital_payment_provider,mercadopago_enabled,mercadopago_public_key,mercadopago_access_token,mercadopago_webhook_token,mercadopago_max_installments")
    .eq("id", 1)
    .maybeSingle();

  return {
    provider: String(data?.digital_payment_provider || "infinitepay") as "mercadopago" | "infinitepay",
    enabled: data?.mercadopago_enabled === true,
    publicKey: String(data?.mercadopago_public_key || "").trim(),
    accessToken: String(data?.mercadopago_access_token || "").trim(),
    webhookToken: String(data?.mercadopago_webhook_token || "").trim(),
    maxInstallments: Math.min(12, Math.max(1, Number(data?.mercadopago_max_installments || 1))),
  };
}

function digits(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(email) ? email : "";
}

function statusMessage(status: string, detail: string) {
  if (status === "approved") return "Pagamento aprovado.";
  if (detail === "pending_challenge") return "Seu banco precisa confirmar esta compra.";
  if (status === "pending" || status === "in_process") return "Pagamento em análise. Aguarde alguns instantes.";
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

async function fetchPayment(accessToken: string, paymentId: string) {
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body: any = await response.json().catch(() => ({}));
    return { response, body };
  } catch {
    return { response: { ok: false, status: 503 } as any, body: {} as any };
  }
}

function extractFee(body: any) {
  const fromFeeDetails = Array.isArray(body?.fee_details)
    ? body.fee_details.reduce((sum: number, fee: any) => sum + Math.abs(Number(fee?.amount || 0)), 0)
    : 0;
  const gross = Number(body?.transaction_amount || 0);
  const net = Number(body?.transaction_details?.net_received_amount || 0);
  if (fromFeeDetails > 0) return Number(fromFeeDetails.toFixed(2));
  if (gross > 0 && net > 0 && gross >= net) return Number((gross - net).toFixed(2));
  return 0;
}

export async function storeMercadoPagoSnapshot(supabaseAdmin: any, checkoutId: string, payment: any, webhookPayload?: any) {
  const paymentMethodId = String(payment?.payment_method_id || "");
  const paymentTypeId = String(payment?.payment_type_id || "");
  const kind = paymentMethodId === "pix" || paymentTypeId === "bank_transfer" ? "mercadopago_pix" : "mercadopago_card";
  const tx = payment?.point_of_interaction?.transaction_data || {};
  await (supabaseAdmin as any)
    .from("site_checkout_sessions")
    .update({
      payment_provider: "mercadopago",
      payment_kind: kind,
      mercadopago_payment_id: payment?.id != null ? String(payment.id) : null,
      mercadopago_status: String(payment?.status || ""),
      mercadopago_status_detail: String(payment?.status_detail || ""),
      mercadopago_payment_method_id: paymentMethodId || null,
      mercadopago_payment_type_id: paymentTypeId || null,
      mercadopago_installments: Math.max(1, Number(payment?.installments || 1)),
      mercadopago_transaction_amount: Number(payment?.transaction_amount || 0) || null,
      mercadopago_net_received_amount: Number(payment?.transaction_details?.net_received_amount || 0) || null,
      mercadopago_fee_amount: extractFee(payment) || 0,
      mercadopago_qr_code: tx?.qr_code ? String(tx.qr_code) : null,
      mercadopago_qr_code_base64: tx?.qr_code_base64 ? String(tx.qr_code_base64) : null,
      mercadopago_ticket_url: tx?.ticket_url ? String(tx.ticket_url) : null,
      mercadopago_verified_at: new Date().toISOString(),
      mercadopago_verification_payload: payment,
      ...(webhookPayload !== undefined ? { mercadopago_webhook_payload: webhookPayload } : {}),
      status: payment?.status === "approved" ? "payment_pending" : "payment_pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutId);

  return kind;
}

export async function finalizeIfApproved(supabaseAdmin: any, checkout: any, payment: any) {
  const expected = Number(Number(checkout.total || 0).toFixed(2));
  const paid = Number(Number(payment?.transaction_amount || 0).toFixed(2));
  const reference = String(payment?.external_reference || payment?.metadata?.checkout_id || "");
  if (reference !== String(checkout.id)) return { ok: false, error: "Referência do pagamento não confere com o checkout." } as const;
  if (paid !== expected) return { ok: false, error: "Valor confirmado pelo Mercado Pago não confere com o pedido." } as const;
  if (String(payment?.currency_id || "BRL").toUpperCase() !== "BRL") return { ok: false, error: "Moeda do pagamento inválida." } as const;
  if (String(payment?.status || "") !== "approved") return { ok: false, pending: true } as const;

  if (checkout.order_id) return { ok: true, order_id: String(checkout.order_id), already_created: true } as const;

  const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
    p_checkout_id: checkout.id,
    p_confirmed_by: "mercadopago",
    p_provider_ref: String(payment.id || ""),
    p_stripe_session_id: null,
  });
  if (error || !finalized?.ok) return { ok: false, error: error?.message || finalized?.error || "Falha ao gerar pedido." } as const;

  try {
    const { notifyPaidSiteOrder } = await import("@/lib/site-checkout.functions");
    if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin, finalized.order_id);
  } catch (e) {
    console.error("[mercadopago] pagamento confirmado, mas aviso WhatsApp falhou", e);
  }
  return { ok: true, order_id: finalized.order_id } as const;
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
    const cfg = await loadMercadoPagoConfig(supabaseAdmin);
    if (!cfg.publicKey || !cfg.accessToken) {
      return { ok: false, error: "Mercado Pago não está configurado corretamente." } as const;
    }

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,total,customer_name,customer_phone,order_data,items,expires_at,order_id,payment_provider,mercadopago_payment_id,mercadopago_status,mercadopago_attempt_no")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.payment_provider !== "mercadopago") return { ok: false, error: "Este checkout pertence a outro provedor de pagamento." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;
    if (!["created", "payment_pending"].includes(String(checkout.status))) return { ok: false, error: "Este checkout não está mais disponível." } as const;
    if (new Date(checkout.expires_at).getTime() < Date.now()) return { ok: false, error: "Este checkout expirou. Refaça o pedido." } as const;

    if (checkout.mercadopago_payment_id && ["pending", "in_process", "approved"].includes(String(checkout.mercadopago_status || ""))) {
      const existing = await fetchPayment(cfg.accessToken, String(checkout.mercadopago_payment_id));
      if (existing.response.ok) {
        await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, existing.body);
        const finalized = await finalizeIfApproved(supabaseAdmin, checkout, existing.body);
        if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, paymentId: String(existing.body.id) } as const;
        const tx = existing.body?.point_of_interaction?.transaction_data || {};
        return {
          ok: true,
          approved: false,
          pending: true,
          paymentId: String(existing.body.id),
          status: String(existing.body.status || "pending"),
          statusDetail: String(existing.body.status_detail || ""),
          qrCode: tx?.qr_code ? String(tx.qr_code) : null,
          qrCodeBase64: tx?.qr_code_base64 ? String(tx.qr_code_base64) : null,
          ticketUrl: tx?.ticket_url ? String(tx.ticket_url) : null,
          challengeUrl: existing.body?.three_ds_info?.external_resource_url ? String(existing.body.three_ds_info.external_resource_url) : null,
          challengeCreq: existing.body?.three_ds_info?.creq ? String(existing.body.three_ds_info.creq) : null,
        } as const;
      }
    }

    const fd = data.formData || {};
    const paymentMethodId = String(fd.payment_method_id || fd.paymentMethodId || "").trim();
    if (!paymentMethodId) return { ok: false, error: "Selecione Pix ou cartão para continuar." } as const;
    const isPix = paymentMethodId === "pix";
    const payer = fd.payer || {};
    const email = normalizeEmail(payer.email);
    if (!email) return { ok: false, error: "Informe um e-mail válido para o pagamento." } as const;

    const identificationType = String(payer?.identification?.type || "").trim();
    const identificationNumber = digits(payer?.identification?.number);
    const installments = Math.min(cfg.maxInstallments, Math.max(1, Number(fd.installments || 1)));
    const safeOrigin = new URL(data.origin).origin;
    const notificationUrl = `${safeOrigin}/api/public/webhooks/mercadopago?token=${encodeURIComponent(cfg.webhookToken)}`;
    const od = checkout.order_data || {};

    const body: any = {
      transaction_amount: Number(Number(checkout.total).toFixed(2)),
      description: "Pedido HotBox Delivery",
      payment_method_id: paymentMethodId,
      external_reference: String(checkout.id),
      notification_url: notificationUrl,
      metadata: { checkout_id: String(checkout.id), source: "hotbox_cardapio" },
      payer: {
        email,
        first_name: String(checkout.customer_name || "").trim().split(/\s+/)[0] || undefined,
        identification: identificationType && identificationNumber ? { type: identificationType, number: identificationNumber } : undefined,
      },
      additional_info: {
        items: (Array.isArray(checkout.items) ? checkout.items : []).map((item: any) => ({
          id: String(item.product_id || ""),
          title: String(item.product_name || "Produto HotBox").slice(0, 120),
          description: String(item.notes || "").slice(0, 250) || undefined,
          category_id: "food",
          quantity: Math.max(1, Number(item.qty || 1)),
          unit_price: Number(item.unit_price || 0),
        })),
        payer: {
          first_name: String(checkout.customer_name || "").trim().split(/\s+/)[0] || undefined,
          last_name: String(checkout.customer_name || "").trim().split(/\s+/).slice(1).join(" ") || undefined,
          phone: { area_code: digits(checkout.customer_phone).slice(0, 2), number: digits(checkout.customer_phone).slice(2) },
          address: od?.delivery_mode === "delivery" ? {
            zip_code: digits(od.address_cep),
            street_name: od.address_street || undefined,
            street_number: od.address_number || undefined,
          } : undefined,
        },
        shipments: od?.delivery_mode === "delivery" ? {
          receiver_address: {
            zip_code: digits(od.address_cep),
            street_name: od.address_street || undefined,
            street_number: od.address_number || undefined,
            floor: od.address_complement || undefined,
            apartment: od.address_complement || undefined,
          },
        } : undefined,
      },
    };

    if (!isPix) {
      body.token = String(fd.token || "").trim();
      body.installments = installments;
      body.issuer_id = fd.issuer_id || fd.issuerId || undefined;
      body.three_d_secure_mode = "optional";
      body.capture = true;
      body.binary_mode = false;
      if (!body.token) return { ok: false, error: "Os dados do cartão não foram tokenizados. Tente novamente." } as const;
    }

    // Idempotência por checkout + número da tentativa. Dois cliques simultâneos usam a MESMA chave.
    // Só avançamos a tentativa depois de uma recusa confirmada pelo próprio Mercado Pago.
    const attemptNo = Math.max(1, Number(checkout.mercadopago_attempt_no || 1));
    const idempotencyKey = `hotbox-${checkout.id}-${attemptNo}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    };
    if (data.deviceId) headers["X-meli-session-id"] = String(data.deviceId).slice(0, 200);

    let response: Response;
    let created: any;
    try {
      response = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      created = await response.json().catch(() => ({}));
    } catch {
      return { ok: false, error: "O Mercado Pago não respondeu agora. Aguarde alguns segundos e tente novamente; a proteção contra cobrança duplicada será mantida." } as const;
    }
    if (!response.ok || !created?.id) {
      const cause = created?.cause?.[0]?.description || created?.message || created?.error;
      return { ok: false, error: String(cause || "Não foi possível iniciar o pagamento pelo Mercado Pago.") } as const;
    }

    await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, created);

    // Segunda confirmação servidor-servidor antes de liberar um pedido aprovado.
    const verified = await fetchPayment(cfg.accessToken, String(created.id));
    const payment = verified.response.ok ? verified.body : created;
    if (verified.response.ok) await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, payment);

    const finalized = await finalizeIfApproved(supabaseAdmin, checkout, payment);
    if (finalized.ok) {
      return { ok: true, approved: true, order_id: finalized.order_id, paymentId: String(payment.id) } as const;
    }

    const status = String(payment?.status || "");
    const statusDetail = String(payment?.status_detail || "");
    if (status === "rejected" || status === "cancelled") {
      await (supabaseAdmin as any).from("site_checkout_sessions")
        .update({ mercadopago_attempt_no: attemptNo + 1, updated_at: new Date().toISOString() })
        .eq("id", checkout.id);
      return { ok: false, rejected: true, paymentId: String(payment.id), status, statusDetail, error: statusMessage(status, statusDetail) } as const;
    }

    const tx = payment?.point_of_interaction?.transaction_data || {};
    return {
      ok: true,
      approved: false,
      pending: true,
      paymentId: String(payment.id),
      status,
      statusDetail,
      message: statusMessage(status, statusDetail),
      qrCode: tx?.qr_code ? String(tx.qr_code) : null,
      qrCodeBase64: tx?.qr_code_base64 ? String(tx.qr_code_base64) : null,
      ticketUrl: tx?.ticket_url ? String(tx.ticket_url) : null,
      challengeUrl: payment?.three_ds_info?.external_resource_url ? String(payment.three_ds_info.external_resource_url) : null,
      challengeCreq: payment?.three_ds_info?.creq ? String(payment.three_ds_info.creq) : null,
    } as const;
  });

export const checkMercadoPagoPayment = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; paymentId?: string | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadMercadoPagoConfig(supabaseAdmin);
    if (!cfg.accessToken) return { ok: false, error: "Mercado Pago não está configurado corretamente." } as const;

    const { data: checkout } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,total,order_id,payment_provider,mercadopago_payment_id,mercadopago_status,mercadopago_attempt_no")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (!checkout || checkout.payment_provider !== "mercadopago") return { ok: false, error: "Checkout não encontrado." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;

    const paymentId = String(data.paymentId || checkout.mercadopago_payment_id || "");
    if (!paymentId) return { ok: false, error: "Pagamento ainda não iniciado." } as const;
    const verified = await fetchPayment(cfg.accessToken, paymentId);
    if (!verified.response.ok) return { ok: false, error: "Não foi possível consultar o pagamento agora." } as const;
    const previousStatus = String(checkout.mercadopago_status || "");
    await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, verified.body);
    const finalized = await finalizeIfApproved(supabaseAdmin, checkout, verified.body);
    if (finalized.ok) return { ok: true, approved: true, order_id: finalized.order_id, paymentId } as const;

    const status = String(verified.body?.status || "");
    const statusDetail = String(verified.body?.status_detail || "");
    if ((status === "rejected" || status === "cancelled") && previousStatus !== "rejected" && previousStatus !== "cancelled") {
      await (supabaseAdmin as any).from("site_checkout_sessions")
        .update({ mercadopago_attempt_no: Math.max(1, Number(checkout.mercadopago_attempt_no || 1)) + 1, updated_at: new Date().toISOString() })
        .eq("id", checkout.id);
    }
    const tx = verified.body?.point_of_interaction?.transaction_data || {};
    return {
      ok: true,
      approved: false,
      pending: status === "pending" || status === "in_process",
      rejected: status === "rejected" || status === "cancelled",
      paymentId,
      status,
      statusDetail,
      message: statusMessage(status, statusDetail),
      qrCode: tx?.qr_code ? String(tx.qr_code) : null,
      qrCodeBase64: tx?.qr_code_base64 ? String(tx.qr_code_base64) : null,
      challengeUrl: verified.body?.three_ds_info?.external_resource_url ? String(verified.body.three_ds_info.external_resource_url) : null,
      challengeCreq: verified.body?.three_ds_info?.creq ? String(verified.body.three_ds_info.creq) : null,
    } as const;
  });

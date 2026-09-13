import { createServerFn } from "@tanstack/react-start";

export type EfiMethod = "pix" | "card";

type BillingAddressInput = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
  complement?: string | null;
};

const PUBLIC_APP_URL = "https://hotbox.up.railway.app";

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}
function money(value: unknown) {
  return Number(value || 0).toFixed(2);
}
function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /\S+@\S+\.\S+/.test(email) ? email : "";
}
function efiChargeBase(environment: string) {
  return environment === "production" ? "https://cobrancas.api.efipay.com.br" : "https://cobrancas-h.api.efipay.com.br";
}
function efiPixBase(environment: string) {
  return environment === "production" ? "https://pix.api.efipay.com.br" : "https://pix-h.api.efipay.com.br";
}

export async function loadEfiConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("store_config")
    .select("efi_enabled,efi_environment,efi_client_id,efi_client_secret,efi_payee_code,efi_pix_key,efi_pix_certificate_base64,efi_pix_certificate_password,efi_webhook_token,efi_max_installments")
    .eq("id", 1)
    .maybeSingle();
  return {
    enabled: data?.efi_enabled === true,
    environment: data?.efi_environment === "production" ? "production" : "sandbox",
    clientId: String(data?.efi_client_id || "").trim(),
    clientSecret: String(data?.efi_client_secret || "").trim(),
    payeeCode: String(data?.efi_payee_code || "").trim(),
    pixKey: String(data?.efi_pix_key || "").trim(),
    certificateBase64: String(data?.efi_pix_certificate_base64 || "").trim(),
    certificatePassword: String(data?.efi_pix_certificate_password || ""),
    webhookToken: String(data?.efi_webhook_token || "").trim(),
    maxInstallments: Math.min(12, Math.max(1, Number(data?.efi_max_installments || 1))),
  };
}

async function chargeAccessToken(cfg: any) {
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const response = await fetch(`${efiChargeBase(cfg.environment)}/v1/authorize`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error(body?.error_description || body?.message || "Não foi possível autenticar na Efí.");
  return String(body.access_token);
}

async function chargeApi(cfg: any, path: string, init: RequestInit = {}) {
  const token = await chargeAccessToken(cfg);
  const response = await fetch(`${efiChargeBase(cfg.environment)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body: any = await response.json().catch(() => ({}));
  return { response, body };
}

function certificateBuffer(raw: string) {
  const clean = String(raw || "").replace(/^data:.*?;base64,/, "").replace(/\s+/g, "");
  return Buffer.from(clean, "base64");
}

async function pixHttpsRequest(cfg: any, path: string, method: string, body?: any, bearer?: string) {
  const https = await import("node:https");
  const url = new URL(`${efiPixBase(cfg.environment)}${path}`);
  const payload = body === undefined ? null : JSON.stringify(body);
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method,
      pfx: certificateBuffer(cfg.certificateBase64),
      passphrase: cfg.certificatePassword || undefined,
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: any = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        resolve({ status: Number(res.statusCode || 0), body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pixAccessToken(cfg: any) {
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const https = await import("node:https");
  const url = new URL(`${efiPixBase(cfg.environment)}/oauth/token`);
  const payload = JSON.stringify({ grant_type: "client_credentials" });
  return await new Promise<string>((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      pfx: certificateBuffer(cfg.certificateBase64),
      passphrase: cfg.certificatePassword || undefined,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: any = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        if ((res.statusCode || 500) >= 300 || !parsed?.access_token) return reject(new Error(parsed?.mensagem || parsed?.error_description || "Não foi possível autenticar o Pix Efí."));
        resolve(String(parsed.access_token));
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function cardPaid(charge: any) { return String(charge?.status || "").toLowerCase() === "paid"; }
function cardRejected(charge: any) { return ["unpaid", "canceled", "cancelled", "refunded"].includes(String(charge?.status || "").toLowerCase()); }

async function finalizeIfPaid(supabaseAdmin: any, checkout: any, providerRef: string, confirmedBy: string) {
  if (checkout.order_id) return { ok: true, order_id: String(checkout.order_id), already_created: true } as const;
  const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
    p_checkout_id: checkout.id,
    p_confirmed_by: confirmedBy,
    p_provider_ref: providerRef,
    p_stripe_session_id: null,
  });
  if (error || !finalized?.ok) return { ok: false, error: error?.message || finalized?.error || "Falha ao gerar pedido." } as const;
  if (finalized.order_id) {
    try {
      const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
      await notifyPaidSiteOrder(supabaseAdmin, String(finalized.order_id));
    } catch (e) { console.error("[efi] aviso do pedido pago falhou", e); }
  }
  return { ok: true, order_id: finalized.order_id } as const;
}

export const createEfiPayment = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string; method: EfiMethod; paymentToken?: string | null; email: string; document: string; installments?: number; billingAddress?: BillingAddressInput | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadEfiConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) return { ok: false, error: "Efí não está configurada corretamente." } as const;
    const { data: checkout } = await (supabaseAdmin as any).from("site_checkout_sessions")
      .select("id,status,total,customer_name,customer_phone,items,delivery_fee,coupon_discount,expires_at,order_id,payment_provider,payment_kind,efi_charge_id,efi_txid,efi_attempt_no")
      .eq("id", data.checkoutId).maybeSingle();
    if (!checkout || checkout.payment_provider !== "efi") return { ok: false, error: "Checkout Efí não encontrado." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;
    if (new Date(checkout.expires_at).getTime() < Date.now()) return { ok: false, error: "Este checkout expirou. Refaça o pedido." } as const;
    const kind = String(checkout.payment_kind || "");
    const expectedMethod = kind.endsWith("_pix") ? "pix" : kind.endsWith("_card") ? "card" : null;
    if (expectedMethod && data.method !== expectedMethod) return { ok: false, error: "Forma de pagamento diferente da selecionada." } as const;

    if (data.method === "pix") {
      if (!cfg.pixKey || !cfg.certificateBase64) return { ok: false, error: "Pix Efí precisa da chave Pix e do certificado P12 configurados." } as const;
      try {
        const token = await pixAccessToken(cfg);
        const created = await pixHttpsRequest(cfg, "/v2/cob", "POST", {
          calendario: { expiracao: 20 * 60 },
          valor: { original: money(checkout.total) },
          chave: cfg.pixKey,
          solicitacaoPagador: `Pedido HotBox ${String(checkout.id).slice(0, 8)}`,
          infoAdicionais: [{ nome: "checkout_id", valor: String(checkout.id) }],
        }, token);
        if (created.status >= 300 || !created.body?.txid || !created.body?.loc?.id) {
          return { ok: false, error: created.body?.mensagem || "Não foi possível gerar o Pix Efí." } as const;
        }
        const qr = await pixHttpsRequest(cfg, `/v2/loc/${encodeURIComponent(String(created.body.loc.id))}/qrcode`, "GET", undefined, token);
        const qrCode = qr.body?.qrcode ? String(qr.body.qrcode) : null;
        const qrCodeUrl = qr.body?.imagemQrcode ? String(qr.body.imagemQrcode) : null;
        await (supabaseAdmin as any).from("site_checkout_sessions").update({
          status: "payment_pending",
          efi_txid: String(created.body.txid),
          efi_status: String(created.body.status || "ATIVA"),
          efi_qr_code: qrCode,
          efi_qr_code_url: qrCodeUrl,
          efi_attempt_no: Number(checkout.efi_attempt_no || 0) + 1,
          efi_verified_at: new Date().toISOString(),
          efi_verification_payload: { charge: created.body, qrcode: qr.body },
          updated_at: new Date().toISOString(),
        }).eq("id", checkout.id);
        return { ok: true, pending: true, qrCode, qrCodeUrl, txid: String(created.body.txid), status: String(created.body.status || "ATIVA") } as const;
      } catch (e: any) {
        return { ok: false, error: String(e?.message || "Não foi possível gerar o Pix Efí.") } as const;
      }
    }

    const email = normalizeEmail(data.email);
    const document = digits(data.document);
    if (!email) return { ok: false, error: "Informe um e-mail válido." } as const;
    if (document.length !== 11) return { ok: false, error: "Informe um CPF válido para o pagamento." } as const;
    if (!data.paymentToken) return { ok: false, error: "Token do cartão não foi gerado." } as const;
    if (!data.billingAddress || digits(data.billingAddress.cep).length !== 8) return { ok: false, error: "Informe o endereço de cobrança." } as const;

    const items = Number(checkout.coupon_discount || 0) > 0
      ? [{ name: "Pedido HotBox Delivery — desconto aplicado", value: Math.round(Number(checkout.total) * 100), amount: 1 }]
      : [
          ...(Array.isArray(checkout.items) ? checkout.items.map((item: any) => ({ name: String(item.product_name || "Produto HotBox").slice(0, 255), value: Math.round(Number(item.unit_price || 0) * 100), amount: Math.max(1, Number(item.qty || 1)) })) : []),
          ...(Number(checkout.delivery_fee || 0) > 0 ? [{ name: "Taxa de entrega", value: Math.round(Number(checkout.delivery_fee) * 100), amount: 1 }] : []),
        ];
    const addr = data.billingAddress;
    const phone = digits(checkout.customer_phone).replace(/^55/, "").slice(0, 11);
    const notificationUrl = `${PUBLIC_APP_URL}/api/public/webhooks/efi?token=${encodeURIComponent(cfg.webhookToken)}`;
    const body = {
      items,
      metadata: { custom_id: String(checkout.id), notification_url: notificationUrl },
      payment: { credit_card: {
        customer: { name: String(checkout.customer_name || "Cliente HotBox"), cpf: document, email, phone_number: phone },
        installments: Math.min(cfg.maxInstallments, Math.max(1, Number(data.installments || 1))),
        payment_token: String(data.paymentToken),
        billing_address: {
          street: String(addr.street || "").slice(0, 255), number: String(addr.number || "S/N").slice(0, 55), neighborhood: String(addr.neighborhood || "").slice(0, 255),
          zipcode: digits(addr.cep).slice(0, 8), city: String(addr.city || "").slice(0, 255), complement: String(addr.complement || "").slice(0, 255), state: String(addr.state || "RJ").toUpperCase().slice(0, 2),
        },
      } },
    };
    const created = await chargeApi(cfg, "/v1/charge/one-step", { method: "POST", body: JSON.stringify(body) });
    const charge = created.body?.data || created.body;
    if (!created.response.ok || !charge?.charge_id) {
      const msg = charge?.error_description || charge?.message || charge?.reason || "Cartão não aprovado.";
      return { ok: false, rejected: true, error: String(msg) } as const;
    }
    const status = String(charge.status || "").toLowerCase();
    await (supabaseAdmin as any).from("site_checkout_sessions").update({
      status: cardRejected(charge) ? "payment_failed" : "payment_pending",
      efi_charge_id: String(charge.charge_id), efi_status: status,
      efi_attempt_no: Number(checkout.efi_attempt_no || 0) + 1,
      efi_verified_at: new Date().toISOString(), efi_verification_payload: created.body,
      updated_at: new Date().toISOString(),
    }).eq("id", checkout.id);
    if (cardPaid(charge)) {
      const finalized = await finalizeIfPaid(supabaseAdmin, checkout, String(charge.charge_id), "efi_card");
      return finalized.ok ? { ok: true, approved: true, order_id: finalized.order_id } as const : { ok: false, error: finalized.error } as const;
    }
    if (cardRejected(charge)) return { ok: false, rejected: true, error: String(charge.reason || "O cartão não foi aprovado. Tente outro cartão, Pix ou solicite um link pelo WhatsApp.") } as const;
    return { ok: true, pending: true, status, chargeId: String(charge.charge_id) } as const;
  });

export const checkEfiPayment = createServerFn({ method: "POST" })
  .inputValidator((data: { checkoutId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadEfiConfig(supabaseAdmin);
    const { data: checkout } = await (supabaseAdmin as any).from("site_checkout_sessions")
      .select("id,total,order_id,payment_provider,payment_kind,efi_charge_id,efi_txid")
      .eq("id", data.checkoutId).maybeSingle();
    if (!checkout || checkout.payment_provider !== "efi") return { ok: false, error: "Checkout Efí não encontrado." } as const;
    if (checkout.order_id) return { ok: true, approved: true, order_id: checkout.order_id } as const;
    if (String(checkout.payment_kind || "").endsWith("_pix")) {
      if (!checkout.efi_txid) return { ok: false, error: "Pix ainda não iniciado." } as const;
      try {
        const token = await pixAccessToken(cfg);
        const fetched = await pixHttpsRequest(cfg, `/v2/cob/${encodeURIComponent(String(checkout.efi_txid))}`, "GET", undefined, token);
        if (fetched.status >= 300) return { ok: false, error: "Não foi possível consultar o Pix agora." } as const;
        const status = String(fetched.body?.status || "").toUpperCase();
        await (supabaseAdmin as any).from("site_checkout_sessions").update({ efi_status: status, efi_verified_at: new Date().toISOString(), efi_verification_payload: fetched.body, updated_at: new Date().toISOString() }).eq("id", checkout.id);
        if (status === "CONCLUIDA") {
          if (money(fetched.body?.valor?.original) !== money(checkout.total)) return { ok: false, error: "Valor Pix confirmado pela Efí não confere com o pedido." } as const;
          const finalized = await finalizeIfPaid(supabaseAdmin, checkout, String(checkout.efi_txid), "efi_pix");
          return finalized.ok ? { ok: true, approved: true, order_id: finalized.order_id } as const : { ok: false, error: finalized.error } as const;
        }
        return { ok: true, approved: false, pending: true, status } as const;
      } catch (e: any) { return { ok: false, error: String(e?.message || "Falha ao consultar Pix Efí.") } as const; }
    }
    if (!checkout.efi_charge_id) return { ok: false, error: "Pagamento ainda não iniciado." } as const;
    const fetched = await chargeApi(cfg, `/v1/charge/${encodeURIComponent(String(checkout.efi_charge_id))}`, { method: "GET" });
    const charge = fetched.body?.data || fetched.body;
    if (!fetched.response.ok || !charge?.charge_id) return { ok: false, error: "Não foi possível consultar o cartão agora." } as const;
    await (supabaseAdmin as any).from("site_checkout_sessions").update({ efi_status: String(charge.status || ""), efi_verified_at: new Date().toISOString(), efi_verification_payload: fetched.body, updated_at: new Date().toISOString() }).eq("id", checkout.id);
    if (Number(charge.total || 0) !== Math.round(Number(checkout.total) * 100)) return { ok: false, error: "Valor confirmado pela Efí não confere com o pedido." } as const;
    if (cardPaid(charge)) {
      const finalized = await finalizeIfPaid(supabaseAdmin, checkout, String(charge.charge_id), "efi_card");
      return finalized.ok ? { ok: true, approved: true, order_id: finalized.order_id } as const : { ok: false, error: finalized.error } as const;
    }
    if (cardRejected(charge)) return { ok: true, approved: false, rejected: true, message: String(charge.reason || "Cartão não aprovado.") } as const;
    return { ok: true, approved: false, pending: true, status: String(charge.status || "waiting") } as const;
  });

export const configureEfiPixWebhook = createServerFn({ method: "POST" })
  .inputValidator((data: { origin?: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cfg = await loadEfiConfig(supabaseAdmin);
    if (!cfg.enabled || !cfg.pixKey || !cfg.certificateBase64 || !cfg.webhookToken) return { ok: false, error: "Complete a configuração Pix da Efí primeiro." } as const;
    try {
      const token = await pixAccessToken(cfg);
      const origin = String(data.origin || PUBLIC_APP_URL).startsWith("https://") ? String(data.origin || PUBLIC_APP_URL) : PUBLIC_APP_URL;
      const webhookUrl = `${origin.replace(/\/$/, "")}/api/public/webhooks/efi?ignorar=&token=${encodeURIComponent(cfg.webhookToken)}`;
      const result = await pixHttpsRequest(cfg, `/v2/webhook/${encodeURIComponent(cfg.pixKey)}`, "PUT", { webhookUrl }, token);
      if (result.status >= 300) return { ok: false, error: result.body?.mensagem || "A Efí não aceitou o webhook Pix." } as const;
      return { ok: true, webhookUrl } as const;
    } catch (e: any) { return { ok: false, error: String(e?.message || "Falha ao configurar webhook Pix.") } as const; }
  });

export async function processEfiWebhook(supabaseAdmin: any, payload: any, token: string) {
  const cfg = await loadEfiConfig(supabaseAdmin);
  if (!cfg.webhookToken || token !== cfg.webhookToken) return { ok: false, unauthorized: true } as const;
  const txids = Array.isArray(payload?.pix) ? payload.pix.map((p: any) => String(p?.txid || "")).filter(Boolean) : [];
  for (const txid of txids) {
    const { data: checkout } = await (supabaseAdmin as any).from("site_checkout_sessions").select("id,total,order_id,payment_provider,payment_kind,efi_txid").eq("efi_txid", txid).maybeSingle();
    if (!checkout || checkout.payment_provider !== "efi") continue;
    const tokenPix = await pixAccessToken(cfg);
    const fetched = await pixHttpsRequest(cfg, `/v2/cob/${encodeURIComponent(txid)}`, "GET", undefined, tokenPix);
    if (fetched.status < 300 && String(fetched.body?.status || "").toUpperCase() === "CONCLUIDA" && money(fetched.body?.valor?.original) === money(checkout.total)) {
      await (supabaseAdmin as any).from("site_checkout_sessions").update({ efi_status: "CONCLUIDA", efi_webhook_payload: payload, efi_verification_payload: fetched.body, efi_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", checkout.id);
      await finalizeIfPaid(supabaseAdmin, checkout, txid, "efi_pix_webhook");
    }
  }
  return { ok: true } as const;
}

export async function processEfiChargeNotification(supabaseAdmin: any, notificationToken: string, webhookToken: string) {
  const cfg = await loadEfiConfig(supabaseAdmin);
  if (!cfg.webhookToken || webhookToken !== cfg.webhookToken) return { ok: false, unauthorized: true } as const;
  const fetched = await chargeApi(cfg, `/v1/notification/${encodeURIComponent(notificationToken)}`, { method: "GET" });
  if (!fetched.response.ok) return { ok: false } as const;
  const notifications = Array.isArray(fetched.body?.data) ? fetched.body.data : [];
  const chargeId = [...notifications].reverse().map((n: any) => n?.identifiers?.charge_id).find(Boolean);
  if (!chargeId) return { ok: true, ignored: true } as const;
  const { data: checkout } = await (supabaseAdmin as any).from("site_checkout_sessions").select("id,total,order_id,payment_provider,efi_charge_id").eq("efi_charge_id", String(chargeId)).maybeSingle();
  if (!checkout) return { ok: true, ignored: true } as const;
  const chargeRes = await chargeApi(cfg, `/v1/charge/${encodeURIComponent(String(chargeId))}`, { method: "GET" });
  const charge = chargeRes.body?.data || chargeRes.body;
  await (supabaseAdmin as any).from("site_checkout_sessions").update({ efi_status: String(charge?.status || ""), efi_webhook_payload: fetched.body, efi_verification_payload: chargeRes.body, efi_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", checkout.id);
  if (cardPaid(charge) && Number(charge.total || 0) === Math.round(Number(checkout.total) * 100)) await finalizeIfPaid(supabaseAdmin, checkout, String(chargeId), "efi_card_webhook");
  return { ok: true } as const;
}

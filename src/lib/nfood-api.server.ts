// Toda a lógica de comunicação com a API da 99Food mora aqui, num lugar só —
// espelha o mesmo padrão do ifood-api.server.ts, mas 100% independente dele:
// nenhuma função, tabela, coluna ou import é compartilhado com a integração
// da iFood. Se algo aqui quebrar, a iFood não é afetada, e vice-versa.
//
// IMPORTANTE — leia antes de configurar:
// A 99Food não tem uma API própria: ela adota o padrão aberto "Open Delivery"
// (o mesmo que a Keeta usa). A documentação oficial da 99Food
// (developer-food.99app.com) exige login e JavaScript pra abrir, então os
// nomes de endpoint abaixo seguem a CONVENÇÃO GERAL do padrão Open Delivery
// — confirme os caminhos exatos com o suporte técnico da 99Food
// (99FoodTechSupport@didiglobal.com) ou no primeiro payload real que chegar
// no seu webhook (fica tudo registrado em /loja/logs). Por isso a URL base
// e a URL de autenticação são CAMPOS DE CONFIGURAÇÃO (preenchidos em
// /loja/config), não valores fixos no código — assim, se a 99Food usar um
// domínio diferente do esperado, basta corrigir no painel, sem precisar
// mexer em código.

import { createHmac } from "node:crypto";
import { logApi } from "./api-log.server";

// ============================================================
// OAuth2 — client credentials, com cache do token no banco
// ============================================================

export async function getNfoodAccessToken(supabaseAdmin: any, forceRefresh = false): Promise<string | null> {
  const { data: cfg } = await supabaseAdmin
    .from("store_config")
    .select("nfood_client_id, nfood_client_secret, nfood_oauth_token_url, nfood_access_token, nfood_token_expires_at")
    .maybeSingle();

  if (!cfg?.nfood_client_id || !cfg?.nfood_client_secret || !cfg?.nfood_oauth_token_url) {
    await logApi(supabaseAdmin, {
      source: "nfood_auth",
      direction: "out",
      error_message: "Client ID / Client Secret / URL de autenticação não configurados em /loja/config",
    });
    return null;
  }

  if (!forceRefresh && cfg.nfood_access_token && cfg.nfood_token_expires_at) {
    const expiresAt = new Date(cfg.nfood_token_expires_at).getTime();
    if (expiresAt - Date.now() > 5 * 60_000) return cfg.nfood_access_token;
  }

  let res: Response;
  try {
    res = await fetch(cfg.nfood_oauth_token_url, {
      method: "POST",
      headers: { accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.nfood_client_id,
        client_secret: cfg.nfood_client_secret,
      }),
    });
  } catch (err: any) {
    await logApi(supabaseAdmin, {
      source: "nfood_auth",
      direction: "out",
      error_message: `Falha de rede ao chamar a URL de autenticação configurada: ${String(err?.message ?? err)}`,
    });
    return null;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[99food] falha na autenticação:", res.status, detail);
    await logApi(supabaseAdmin, {
      source: "nfood_auth",
      direction: "out",
      response_status: res.status,
      response_body: detail,
      error_message: "Falha ao obter token OAuth — confira client_id/client_secret/URL em /loja/config",
    });
    return null;
  }

  const json: any = await res.json();
  // aceita os dois formatos mais comuns de resposta OAuth2 (access_token é o
  // padrão RFC 6749; accessToken aparece em algumas implementações, como a
  // própria iFood usa no seu lado — deixado defensivo até confirmar com a 99Food)
  const token = json?.access_token ?? json?.accessToken;
  const expiresInSeconds = Number(json?.expires_in ?? json?.expiresIn ?? 3600);
  if (!token) {
    await logApi(supabaseAdmin, {
      source: "nfood_auth",
      direction: "out",
      response_status: res.status,
      response_body: JSON.stringify(json),
      error_message: "Resposta OK mas sem access_token no corpo",
    });
    return null;
  }

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await supabaseAdmin
    .from("store_config")
    .update({ nfood_access_token: token, nfood_token_expires_at: expiresAt })
    .eq("id", 1);

  await logApi(supabaseAdmin, { source: "nfood_auth", direction: "out", response_status: 200 });
  return token;
}

// ============================================================
// Verificação de assinatura do webhook (X-App-Signature)
// ============================================================
// Padrão Open Delivery: SHA256 do corpo da requisição, usando o client
// secret como chave (documentado publicamente na implementação da Keeta,
// que usa o mesmo padrão da 99Food) — HMAC-SHA256(body, client_secret) em hex.
export function verifyNfoodSignature(rawBody: string, signatureHeader: string | null, clientSecret: string): boolean {
  if (!signatureHeader || !clientSecret) return false;
  try {
    const expected = createHmac("sha256", clientSecret).update(rawBody).digest("hex");
    return expected === signatureHeader.trim();
  } catch {
    return false;
  }
}

// ============================================================
// Criação de pedido a partir do payload da 99Food (Open Delivery)
// ============================================================
// Os nomes de campo abaixo seguem a convenção geral do padrão Open Delivery.
// Deixei leitura defensiva (vários nomes alternativos por campo) porque não
// consegui confirmar 100% o schema exato da 99Food sem acesso à doc real —
// o primeiro pedido de teste que chegar vai ficar salvo por completo em
// /loja/logs (api_logs), então dá pra ajustar rapidinho se algum campo vier
// com nome diferente do esperado aqui.
export type NfoodOrderPayload = Record<string, any>;

function pick(obj: any, paths: string[]): any {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export async function createOrderFromNfoodPayload(supabaseAdmin: any, payload: NfoodOrderPayload) {
  const externalId = pick(payload, ["id", "orderId", "order.id"]);
  if (!externalId) return { ignored: "no_order_id" as const };

  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_id", String(externalId))
    .maybeSingle();
  if (existing) return { already_exists: true as const, order_id: existing.id };

  const rawItems: any[] = pick(payload, ["items", "order.items"]) ?? [];
  const nfoodItemIds = rawItems.map((it) => pick(it, ["id", "itemId"])).filter(Boolean) as string[];
  const mapRows = nfoodItemIds.length
    ? ((
        await supabaseAdmin
          .from("nfood_product_map")
          .select("nfood_item_id, product_id")
          .in("nfood_item_id", nfoodItemIds)
      ).data ?? [])
    : [];
  const mapByNfoodId = new Map(mapRows.map((r: any) => [r.nfood_item_id, r.product_id]));

  const { data: localProducts } = await supabaseAdmin.from("products").select("id, name").eq("active", true);
  const byName = new Map((localProducts ?? []).map((p: any) => [String(p.name).toLowerCase().trim(), p.id]));

  for (const it of rawItems) {
    const itemId = pick(it, ["id", "itemId"]);
    const itemName = String(pick(it, ["name", "productName"]) ?? "");
    if (itemId && !mapByNfoodId.has(itemId)) {
      await supabaseAdmin
        .from("nfood_product_map")
        .upsert(
          {
            nfood_item_id: itemId,
            nfood_item_name: itemName,
            product_id: byName.get(itemName.toLowerCase().trim()) ?? null,
          },
          { onConflict: "nfood_item_id", ignoreDuplicates: true },
        );
    }
  }

  const items = rawItems.map((it) => {
    const itemId = pick(it, ["id", "itemId"]);
    const itemName = String(pick(it, ["name", "productName"]) ?? "Item sem nome");
    return {
      product_id: (itemId ? mapByNfoodId.get(itemId) : null) ?? byName.get(itemName.toLowerCase().trim()) ?? null,
      product_name: itemName,
      quantity: Math.max(1, Math.round(Number(pick(it, ["quantity", "qty"])) || 1)),
      unit_price: Number(pick(it, ["unitPrice", "price", "totalPrice.value"])) || 0,
      notes: pick(it, ["observations", "notes"]) ?? null,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const delivery_fee = Number(pick(payload, ["total.deliveryFee", "deliveryFee", "delivery.fee"])) || 0;
  const total = Number(pick(payload, ["total.orderAmount", "total.value", "totalAmount"])) || subtotal + delivery_fee;

  const orderType = String(pick(payload, ["orderType", "type"]) ?? "DELIVERY").toUpperCase();
  const isTakeout = orderType === "TAKEOUT" || orderType === "INDOOR" || orderType === "PICKUP";

  const address = pick(payload, ["delivery.deliveryAddress", "deliveryAddress"]) ?? {};
  const customer = pick(payload, ["customer"]) ?? {};
  const customerPhone = String(pick(customer, ["phone.number", "phone"]) ?? "").replace(/\D/g, "");

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      source: "99food",
      external_id: String(externalId),
      customer_name: pick(customer, ["name"]) ?? "Cliente 99Food",
      customer_phone: customerPhone || "00000000000",
      delivery_mode: isTakeout ? "pickup" : "delivery",
      address_street: isTakeout ? null : (pick(address, ["streetName", "street"]) ?? null),
      address_number: isTakeout ? null : (pick(address, ["streetNumber", "number"]) ?? null),
      address_complement: isTakeout ? null : (pick(address, ["complement"]) ?? null),
      address_neighborhood: isTakeout ? null : (pick(address, ["neighborhood"]) ?? null),
      address_city: isTakeout ? null : (pick(address, ["city"]) ?? null),
      address_reference: isTakeout ? null : (pick(address, ["reference"]) ?? null),
      address_cep: isTakeout ? null : (pick(address, ["postalCode", "zipCode"]) ?? null),
      external_display_id: String(
        pick(payload, ["displayId", "shortId"]) ?? String(externalId).slice(-8).toUpperCase(),
      ),
      payment_method: "pix", // pagamento é resolvido pela própria plataforma; ajuste aqui se a 99Food mandar o método usado
      payment_status: "paid",
      subtotal,
      delivery_fee: isTakeout ? 0 : delivery_fee,
      total,
      status: "pending", // igual à iFood: pedido de plataforma não passa pela revisão da IA, vai direto pra fila de aceitar
    })
    .select("id, order_number")
    .single();

  if (error || !order) {
    console.error("[99food] falha ao criar pedido:", error);
    await logApi(supabaseAdmin, {
      source: "nfood_order_create",
      direction: "in",
      error_message: String(error?.message ?? "erro desconhecido"),
      request_payload: payload as any,
    });
    return { error: String(error?.message ?? "erro desconhecido") };
  }

  if (items.length) {
    await supabaseAdmin.from("order_items").insert(items.map((i) => ({ ...i, order_id: order.id })));
  }

  await logApi(supabaseAdmin, {
    source: "nfood_order_create",
    direction: "in",
    response_status: 200,
    response_body: `Pedido #${order.order_number} criado — subtotal ${subtotal}, entrega ${delivery_fee}, total ${total}`,
    request_payload: payload as any,
  });
  return { ok: true as const, order_id: order.id, order_number: order.order_number };
}

// ============================================================
// Push de status (loja -> 99Food)
// ============================================================

const NFOOD_STATUS_ACTION: Record<string, string> = {
  preparing: "confirm",
  ready_pickup: "readyForPickup",
  out_for_delivery: "dispatch",
  cancelled: "cancel",
};

export async function pushNfoodOrderStatus(
  supabaseAdmin: any,
  orderId: string,
  newStatus: string,
): Promise<{ ok: boolean; skipped?: string }> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("external_id, source, order_number")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.source !== "99food" || !order.external_id) return { ok: false, skipped: "not_99food_order" };

  const action = NFOOD_STATUS_ACTION[newStatus];
  if (!action) return { ok: false, skipped: "no_mapping_for_status" };

  const { data: cfg } = await supabaseAdmin.from("store_config").select("nfood_api_base_url").maybeSingle();
  if (!cfg?.nfood_api_base_url) {
    await logApi(supabaseAdmin, {
      source: "nfood_status_push",
      direction: "out",
      error_message: `URL base da API 99Food não configurada — não deu pra empurrar status "${newStatus}" do pedido #${order.order_number}`,
    });
    return { ok: false, skipped: "no_api_base_url" };
  }

  const token = await getNfoodAccessToken(supabaseAdmin);
  if (!token) {
    await logApi(supabaseAdmin, {
      source: "nfood_status_push",
      direction: "out",
      error_message: `Sem token pra empurrar status "${newStatus}" do pedido #${order.order_number}`,
    });
    return { ok: false, skipped: "no_token" };
  }

  try {
    const url = `${cfg.nfood_api_base_url.replace(/\/$/, "")}/order/${order.external_id}/${action}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: action === "cancel" ? JSON.stringify({ reason: "Cancelado pelo estabelecimento" }) : undefined,
    });
    const detail = await res.text().catch(() => "");

    if (!res.ok) {
      await logApi(supabaseAdmin, {
        source: "nfood_status_push",
        direction: "out",
        response_status: res.status,
        response_body: detail,
        error_message: `Falha ao empurrar status "${newStatus}" (ação "${action}") do pedido #${order.order_number}`,
      });
      return { ok: false, skipped: `http_${res.status}` };
    }

    await supabaseAdmin.from("orders").update({ nfood_last_pushed_status: newStatus }).eq("id", orderId);
    await logApi(supabaseAdmin, {
      source: "nfood_status_push",
      direction: "out",
      response_status: res.status,
      response_body: detail || `status "${newStatus}" (ação "${action}") empurrado com sucesso`,
    });
    return { ok: true };
  } catch (err: any) {
    await logApi(supabaseAdmin, {
      source: "nfood_status_push",
      direction: "out",
      error_message: String(err?.message ?? err),
    });
    return { ok: false, skipped: "exception" };
  }
}

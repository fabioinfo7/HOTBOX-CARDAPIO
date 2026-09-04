// Toda a lógica de comunicação com a API da iFood mora aqui, num lugar só,
// pra ser reaproveitada tanto pelo webhook de teste/homologação quanto pelo
// polling de produção — evita ter duas versões da mesma lógica que podem
// divergir com o tempo. Cada etapa registra log em api_logs (/loja/logs),
// pra nunca mais ficar no escuro quando algo não chegar ou falhar.

import { logApi } from "./api-log.server";

const IFOOD_AUTH_URL = "https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token";
const IFOOD_API_BASE = "https://merchant-api.ifood.com.br";

// ============================================================
// OAuth2 — client credentials, com cache do token no banco
// ============================================================

export async function getIfoodAccessToken(supabaseAdmin: any, forceRefresh = false): Promise<string | null> {
  const { data: cfg } = await supabaseAdmin
    .from("store_config")
    .select("ifood_client_id, ifood_client_secret, ifood_access_token, ifood_token_expires_at")
    .maybeSingle();

  if (!cfg?.ifood_client_id || !cfg?.ifood_client_secret) {
    await logApi(supabaseAdmin, {
      source: "ifood_auth",
      direction: "out",
      error_message: "Client ID/Secret não configurados em /loja/config",
    });
    return null;
  }

  if (!forceRefresh && cfg.ifood_access_token && cfg.ifood_token_expires_at) {
    const expiresAt = new Date(cfg.ifood_token_expires_at).getTime();
    if (expiresAt - Date.now() > 5 * 60_000) return cfg.ifood_access_token;
  }

  const res = await fetch(IFOOD_AUTH_URL, {
    method: "POST",
    headers: { accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "client_credentials",
      clientId: cfg.ifood_client_id,
      clientSecret: cfg.ifood_client_secret,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[ifood] falha na autenticação:", res.status, detail);
    await logApi(supabaseAdmin, {
      source: "ifood_auth",
      direction: "out",
      response_status: res.status,
      response_body: detail,
      error_message: "Falha ao obter token OAuth",
    });
    return null;
  }

  const json: any = await res.json();
  const token = json?.accessToken;
  const expiresInSeconds = Number(json?.expiresIn ?? 10800);
  if (!token) {
    await logApi(supabaseAdmin, {
      source: "ifood_auth",
      direction: "out",
      response_status: res.status,
      response_body: JSON.stringify(json),
      error_message: "Resposta OK mas sem accessToken no corpo",
    });
    return null;
  }

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await supabaseAdmin
    .from("store_config")
    .update({ ifood_access_token: token, ifood_token_expires_at: expiresAt })
    .eq("id", 1);

  await logApi(supabaseAdmin, {
    source: "ifood_auth",
    direction: "out",
    response_status: 200,
    response_body: `token renovado, expira em ${expiresInSeconds}s`,
  });
  return token;
}

// ============================================================
// Criação de pedido a partir do payload da iFood
// ============================================================

export type IfoodItem = {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  observations?: string;
};

export type IfoodBillingAddress = {
  streetName?: string;
  streetNumber?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
};

export type IfoodOrderPayload = {
  id: string;
  displayId?: string; // código curto que a iFood mostra pro lojista/cliente — é ESSE que deve aparecer no painel, não numeração própria
  orderType?: "DELIVERY" | "TAKEOUT" | string;
  orderTiming?: "IMMEDIATE" | "SCHEDULED" | string;
  schedule?: { deliveryDateTimeStart?: string; deliveryDateTimeEnd?: string };
  customer?: { name?: string; phone?: { number?: string }; billingAddress?: IfoodBillingAddress };
  // CONFIRMADO no payload real: o endereço de entrega vem aninhado dentro de
  // "delivery", não solto na raiz do pedido — isso estava lido do lugar
  // errado, então todo pedido de entrega salvava o endereço vazio.
  delivery?: {
    deliveredBy?: "MERCHANT" | "IFOOD" | string; // quem entrega — relevante pra decidir se empurra "dispatch" pra iFood
    pickupCode?: string;
    observations?: string;
    deliveryAddress?: {
      streetName?: string;
      streetNumber?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      reference?: string;
      postalCode?: string;
      coordinates?: { latitude?: number; longitude?: number };
    };
  };
  payments?: { methods?: { method?: string }[] };
  items?: IfoodItem[];
  total?: { orderAmount?: number; deliveryFee?: number };
};

/** Cria o pedido no banco a partir de um payload da iFood, com mapeamento de cardápio. Idempotente. */
export async function createOrderFromIfoodPayload(supabaseAdmin: any, payload: IfoodOrderPayload) {
  if (!payload?.id) return { ignored: "no_order_id" as const };

  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_id", payload.id)
    .maybeSingle();
  if (existing) return { already_exists: true as const, order_id: existing.id };

  const rawItems = payload.items ?? [];
  const ifoodItemIds = rawItems.map((it) => it.id).filter(Boolean) as string[];
  const mapRows = ifoodItemIds.length
    ? ((
        await supabaseAdmin
          .from("ifood_product_map")
          .select("ifood_item_id, product_id")
          .in("ifood_item_id", ifoodItemIds)
      ).data ?? [])
    : [];
  const mapByIfoodId = new Map(mapRows.map((r: any) => [r.ifood_item_id, r.product_id]));

  const { data: localProducts } = await supabaseAdmin.from("products").select("id, name").eq("active", true);
  const byName = new Map((localProducts ?? []).map((p: any) => [String(p.name).toLowerCase().trim(), p.id]));

  for (const it of rawItems) {
    if (it.id && !mapByIfoodId.has(it.id)) {
      await supabaseAdmin
        .from("ifood_product_map")
        .upsert(
          {
            ifood_item_id: it.id,
            ifood_item_name: it.name,
            product_id: byName.get(it.name.toLowerCase().trim()) ?? null,
          },
          { onConflict: "ifood_item_id", ignoreDuplicates: true },
        );
    }
  }

  const items = rawItems.map((it) => ({
    product_id: (it.id ? mapByIfoodId.get(it.id) : null) ?? byName.get(it.name.toLowerCase().trim()) ?? null,
    product_name: it.name,
    quantity: Math.max(1, Math.round(it.quantity || 1)),
    unit_price: Number(it.unitPrice || 0),
    notes: it.observations || null,
  }));

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const delivery_fee = Number(payload.total?.deliveryFee ?? 0);
  const total = Number(payload.total?.orderAmount ?? subtotal + delivery_fee);
  const methodRaw = (payload.payments?.methods?.[0]?.method ?? "").toUpperCase();
  const paymentMethod = methodRaw.includes("CREDIT") || methodRaw.includes("DEBIT") ? "card" : "pix";

  // TAKEOUT = retirada no local, DELIVERY = entrega (padrão se o campo não vier)
  const isTakeout = payload.orderType === "TAKEOUT";

  // ============ Ajuste SINIEF 9/26 — endereço de faturamento em pedidos TAKEOUT ============
  const billingAddress = payload.customer?.billingAddress ?? null;

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      source: "ifood",
      external_id: payload.id,
      customer_name: payload.customer?.name || "Cliente iFood",
      customer_phone: (payload.customer?.phone?.number || "").replace(/\D/g, "") || "00000000000",
      delivery_mode: isTakeout ? "pickup" : "delivery",
      address_street: isTakeout ? null : (payload.delivery?.deliveryAddress?.streetName ?? null),
      address_number: isTakeout ? null : (payload.delivery?.deliveryAddress?.streetNumber ?? null),
      address_complement: isTakeout ? null : (payload.delivery?.deliveryAddress?.complement ?? null),
      address_neighborhood: isTakeout ? null : (payload.delivery?.deliveryAddress?.neighborhood ?? null),
      address_city: isTakeout ? null : (payload.delivery?.deliveryAddress?.city ?? null),
      address_reference: isTakeout ? null : (payload.delivery?.deliveryAddress?.reference ?? null),
      address_cep: isTakeout ? null : (payload.delivery?.deliveryAddress?.postalCode ?? null),
      ifood_billing_address: billingAddress,
      external_display_id: payload.displayId || payload.id.slice(-8).toUpperCase(),
      order_timing: payload.orderTiming || "IMMEDIATE",
      scheduled_start_at: payload.schedule?.deliveryDateTimeStart || null,
      scheduled_end_at: payload.schedule?.deliveryDateTimeEnd || null,
      payment_method: paymentMethod,
      payment_status: "paid",
      subtotal,
      delivery_fee: isTakeout ? 0 : delivery_fee,
      total,
      status: "pending", // pedidos da iFood não passam pela IA — vai direto pra fila de aceitar, sem "revisar"
    })
    .select("id, order_number")
    .single();

  if (error || !order) {
    console.error("[ifood] falha ao criar pedido:", error);
    await logApi(supabaseAdmin, {
      source: "ifood_order_create",
      direction: "in",
      error_message: String(error?.message ?? "erro desconhecido"),
      request_payload: payload as any,
      order_id: payload.id,
      event_type: payload.orderType ?? "DELIVERY",
    });
    return { error: String(error?.message ?? "erro desconhecido") };
  }

  if (items.length) {
    await supabaseAdmin.from("order_items").insert(items.map((i) => ({ ...i, order_id: order.id })));
  }

  await logApi(supabaseAdmin, {
    source: "ifood_order_create",
    direction: "in",
    response_status: 200,
    response_body: `Pedido #${order.order_number} criado com sucesso — subtotal ${subtotal}, entrega ${delivery_fee}, total ${total} (total veio ${payload.total?.orderAmount != null ? "do payload da iFood" : "calculado por soma"})`,
    request_payload: payload as any,
    order_id: payload.id,
    event_type: payload.orderType ?? "DELIVERY",
  });
  return { ok: true as const, order_id: order.id, order_number: order.order_number };
}

// ============================================================
// Push de status (loja -> iFood)
// ============================================================

const IFOOD_STATUS_ACTION: Record<string, string> = {
  preparing: "confirm",
  ready_pickup: "readyToPickup",
  out_for_delivery: "dispatch",
  cancelled: "requestCancellation",
};

// mapeamento de reserva por palavra-chave — só usado quando a consulta de
// motivos válidos falha por completo e não temos nada real da iFood pra
// comparar. Cobre os motivos mais comuns do dia a dia.
const KEYWORD_FALLBACK_CODES: { keywords: string[]; code: string }[] = [
  { keywords: ["duplicado", "duplicidade", "repetido"], code: "502" },
  { keywords: ["indisponível", "indisponivel", "sem estoque", "acabou", "falta de"], code: "503" },
  { keywords: ["entregador", "sem motoboy", "sem motoqueiro"], code: "504" },
  { keywords: ["área de risco", "area de risco", "risco"], code: "511" },
  { keywords: ["promoção", "promocao", "cupom"], code: "523" },
  { keywords: ["cliente desistiu", "desistência", "desistencia", "cliente cancelou", "cliente pediu"], code: "501" },
];

/**
 * Escolhe o código de motivo de cancelamento certo pra mandar pra iFood na
 * requisição de CANCELAMENTO INICIADO PELA LOJA (POST .../requestCancellation
 * — essa é a única chamada de cancelamento que realmente existe na API deles
 * pra essa direção). Usa o texto que o admin digitou no popup de
 * cancelamento (window.prompt, em loja.pedido.$id.tsx) como pista:
 *
 *   1) compara o texto digitado contra a DESCRIÇÃO real de cada motivo que a
 *      própria iFood retorna pra esse pedido específico (mais confiável,
 *      sempre atualizado, nunca fica desatualizado como uma lista fixa);
 *   2) se a consulta falhar, tenta um mapeamento por palavra-chave conhecido;
 *   3) só em último caso usa o código genérico de reserva.
 */
async function getIfoodCancellationReasonCode(
  supabaseAdmin: any,
  token: string,
  externalOrderId: string,
  adminTypedReason?: string | null,
): Promise<string> {
  const FALLBACK_CODE = "501"; // "Erro no sistema" — só usado se nada mais funcionar
  const typed = (adminTypedReason || "").toLowerCase().trim();

  try {
    const res = await fetch(`${IFOOD_API_BASE}/order/v1.0/orders/${externalOrderId}/cancellationReasons`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      await logApi(supabaseAdmin, {
        source: "ifood_cancellation_reasons",
        direction: "out",
        response_status: res.status,
        error_message: "falha ao consultar motivos válidos — tentando mapeamento por palavra-chave",
        order_id: externalOrderId,
      });
      if (typed) {
        const match = KEYWORD_FALLBACK_CODES.find((k) => k.keywords.some((kw) => typed.includes(kw)));
        if (match) return match.code;
      }
      return FALLBACK_CODE;
    }

    const json: any = await res.json();
    const reasons: any[] = json?.reasons ?? json ?? [];

    // 1ª tentativa: compara o texto digitado com a descrição de cada motivo
    // real que a iFood devolveu pra esse pedido específico
    let chosen: any = null;
    if (typed && reasons.length) {
      chosen = reasons.find((r: any) => {
        const desc = String(r.description ?? "").toLowerCase();
        if (!desc) return false;
        if (desc.includes(typed) || typed.includes(desc)) return true;
        return KEYWORD_FALLBACK_CODES.some((k) => k.keywords.some((kw) => typed.includes(kw) && desc.includes(kw)));
      });
    }
    // 2ª tentativa: o código genérico de reserva, se estiver na lista válida pra esse pedido
    if (!chosen) chosen = reasons.find((r: any) => String(r.code) === FALLBACK_CODE) ?? reasons[0];

    await logApi(supabaseAdmin, {
      source: "ifood_cancellation_reasons",
      direction: "out",
      response_status: 200,
      response_body: JSON.stringify({ reasons, motivo_digitado: adminTypedReason || null, escolhido: chosen }),
      order_id: externalOrderId,
    });
    return chosen?.code ? String(chosen.code) : FALLBACK_CODE;
  } catch (err) {
    await logApi(supabaseAdmin, {
      source: "ifood_cancellation_reasons",
      direction: "out",
      error_message: String((err as any)?.message ?? err),
      order_id: externalOrderId,
    });
    if (typed) {
      const match = KEYWORD_FALLBACK_CODES.find((k) => k.keywords.some((kw) => typed.includes(kw)));
      if (match) return match.code;
    }
    return FALLBACK_CODE;
  }
}

export async function pushIfoodOrderStatus(
  supabaseAdmin: any,
  orderId: string,
  newStatus: string,
): Promise<{ ok: boolean; skipped?: string }> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("external_id, source, cancel_reason, order_number")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.source !== "ifood" || !order.external_id) return { ok: false, skipped: "not_ifood_order" };

  // NOTA (aprendido na homologação real): o despacho (dispatch) DEVE ser
  // enviado quando a loja clicar em "Saindo" — o cenário "Pedido Despachado
  // Imediato" da homologação usa logística MERCHANT e reprova sem isso
  // (0/10, confirmado em relatório). Quando é a iFood que entrega, o evento
  // DISPATCHED dela chega primeiro pelo polling e atualiza o status sozinho;
  // nesse caso o guard de idempotência (ifood_last_pushed_status) já impede
  // qualquer reenvio duplicado. Os dois caminhos coexistem sem conflito.

  const action = IFOOD_STATUS_ACTION[newStatus];
  if (!action) return { ok: false, skipped: "no_mapping_for_status" };

  const token = await getIfoodAccessToken(supabaseAdmin);
  if (!token) {
    await logApi(supabaseAdmin, {
      source: "ifood_status_push",
      direction: "out",
      error_message: `Sem token pra empurrar status "${newStatus}" do pedido #${order.order_number}`,
      order_id: order.external_id,
      event_type: action,
    });
    return { ok: false, skipped: "no_token" };
  }

  try {
    let body: string | undefined;
    if (action === "requestCancellation") {
      // essa É a chamada real de cancelamento iniciado pela loja — a única
      // direção em que a API de cancelamento realmente existe. Usa o motivo
      // que o admin digitou no popup (order.cancel_reason) pra escolher o
      // código certo, em vez de sempre mandar o mesmo código genérico.
      const reasonCode = await getIfoodCancellationReasonCode(
        supabaseAdmin,
        token,
        order.external_id,
        order.cancel_reason,
      );
      body = JSON.stringify({ reason: reasonCode, cancellationCode: reasonCode });
    }

    const res = await fetch(`${IFOOD_API_BASE}/order/v1.0/orders/${order.external_id}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });

    const detail = res.ok ? "" : await res.text().catch(() => "");
    await logApi(supabaseAdmin, {
      source: "ifood_status_push",
      direction: "out",
      request_payload: {
        order_number: order.order_number,
        action,
        newStatus,
        body: body ? JSON.parse(body) : undefined,
      },
      response_status: res.status,
      response_body:
        detail ||
        (res.status === 202 ? "202 = aceito pra processar; confirmação real só chega no próximo polling" : undefined),
      error_message: res.ok ? undefined : `push de status "${action}" falhou`,
      order_id: order.external_id,
      event_type: action,
    });

    if (!res.ok) {
      console.error(`[ifood] push de status falhou (${action}):`, res.status, detail);
      return { ok: false };
    }

    await supabaseAdmin.from("orders").update({ ifood_last_pushed_status: newStatus }).eq("id", orderId);
    return { ok: true };
  } catch (err) {
    console.error("[ifood] erro ao empurrar status:", err);
    await logApi(supabaseAdmin, {
      source: "ifood_status_push",
      direction: "out",
      error_message: String((err as any)?.message ?? err),
      order_id: order.external_id,
      event_type: action,
    });
    return { ok: false };
  }
}

/**
 * A iFood rejeitou um cancelamento que a gente pediu (ex: motivo inválido,
 * pedido em estado que não permite mais cancelar). Isso é grave porque o
 * pedido pode estar marcado "cancelado" no nosso painel mas continuar ATIVO
 * de verdade pra iFood/cliente — precisa de alguém olhar na hora.
 */
export async function handleIfoodCancellationFailure(
  supabaseAdmin: any,
  externalOrderId: string,
  ev: any,
): Promise<void> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status")
    .eq("external_id", externalOrderId)
    .maybeSingle();
  const reason = ev?.metadata?.reason || ev?.metadata?.message || "motivo não informado pela iFood";

  await logApi(supabaseAdmin, {
    source: "ifood_cancellation",
    direction: "in",
    response_status: 422,
    error_message: `iFood REJEITOU o cancelamento do pedido${order ? ` #${order.order_number}` : ""}: ${reason}`,
    request_payload: ev,
    order_id: externalOrderId,
    event_type: "CANCELLATION_REQUEST_FAILED",
  });

  await supabaseAdmin
    .rpc("record_system_alert", {
      _kind: "ifood_cancelamento_rejeitado",
      _message: `⚠️ A iFood recusou o cancelamento do pedido${order ? ` #${order.order_number}` : ` (${externalOrderId})`}: ${reason}. Esse pedido pode estar ATIVO ainda na iFood mesmo aparecendo cancelado aqui — confira manualmente.`,
      _severity: "error",
    })
    .catch(() => {});

  // NÃO reverte o status local sozinho — quem decide o que fazer (tentar de
  // novo, ligar pro suporte da iFood, reabrir o pedido) é o humano, avisado
  // pelo alerta acima. Reverter automaticamente poderia confundir mais.
}

/**
 * A iFood avisa via evento que o pedido foi despachado/concluído do lado
 * dela. Reflete isso automaticamente no status local, sem depender de
 * alguém clicar manualmente no painel.
 */
export async function handleIfoodConclusionEvent(
  supabaseAdmin: any,
  externalOrderId: string,
  code: string,
): Promise<void> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, external_display_id, status")
    .eq("external_id", externalOrderId)
    .maybeSingle();
  if (!order) {
    await logApi(supabaseAdmin, {
      source: "ifood_poll_event",
      direction: "in",
      error_message: `evento ${code} recebido mas nenhum pedido local encontrado com external_id=${externalOrderId}`,
      order_id: externalOrderId,
      event_type: code,
    });
    return;
  }
  if (order.status === "delivered" || order.status === "cancelled") {
    await logApi(supabaseAdmin, {
      source: "ifood_poll_event",
      direction: "in",
      response_status: 200,
      response_body: `Pedido ${order.external_display_id ?? externalOrderId} já estava em estado final ("${order.status}") — evento ${code} ignorado de propósito, não regride status.`,
      order_id: externalOrderId,
      event_type: code,
    });
    return;
  }

  const newStatus = code.includes("DISPATCH") || code === "DSP" ? "out_for_delivery" : "delivered";
  const { error, data: updated } = await supabaseAdmin
    .from("orders")
    .update({ status: newStatus })
    .eq("id", order.id)
    .select("id, status")
    .maybeSingle();

  if (error || !updated || updated.status !== newStatus) {
    // NUNCA mais afirma sucesso sem confirmar de verdade — isso já causou
    // um caso real onde o log dizia "atualizado" mas o pedido não mudava
    await logApi(supabaseAdmin, {
      source: "ifood_poll_event",
      direction: "in",
      response_status: error ? 500 : 200,
      error_message: `Evento ${code} recebido, mas a atualização de status FALHOU de verdade: ${error?.message ?? "o update não retornou o novo status esperado — confira RLS/permissões da service role nessa tabela"}`,
      order_id: externalOrderId,
      event_type: code,
    });
    return;
  }

  await logApi(supabaseAdmin, {
    source: "ifood_poll_event",
    direction: "in",
    response_status: 200,
    response_body: `Pedido ${order.external_display_id ?? externalOrderId} atualizado e CONFIRMADO no banco para "${newStatus}" (evento ${code} da iFood)`,
    order_id: externalOrderId,
    event_type: code,
  });
}

// ============================================================
// Classificação e processamento de eventos do polling
// ============================================================

export type IfoodEventCategory =
  | "new_order"
  | "cancellation_failed"
  | "cancellation_confirmed"
  | "cancellation_requested"
  | "driver_assigned"
  | "conclusion_or_dispatch"
  | "unknown";

/**
 * Decide o que um evento de polling da iFood significa, sem executar
 * nenhuma ação — só classifica. Extraída assim de propósito pra ser
 * reaproveitada tanto no polling de produção quanto no simulador de
 * homologação (/loja/config), garantindo que o teste local usa exatamente
 * a mesma lógica que roda de verdade.
 */
export function classifyIfoodEvent(ev: { code?: string; fullCode?: string }): {
  category: IfoodEventCategory;
  code: string;
  fullCode: string;
  combined: string;
} {
  const code = String(ev.code ?? "").toUpperCase();
  const fullCode = String(ev.fullCode ?? "").toUpperCase();
  const combined = `${code} ${fullCode}`;

  if (code === "PLC" || fullCode === "PLACED") return { category: "new_order", code, fullCode, combined };
  if (combined.includes("CANCELLATION_REQUEST_FAILED") || code === "CRF")
    return { category: "cancellation_failed", code, fullCode, combined };
  if (code === "CANCELLED" || code === "CAN" || fullCode === "CANCELLED")
    return { category: "cancellation_confirmed", code, fullCode, combined };
  if (combined.includes("CANCEL")) return { category: "cancellation_requested", code, fullCode, combined };
  if (combined.includes("ASSIGN_DRIVER") || combined.includes("ASSIGNDRIVER"))
    return { category: "driver_assigned", code, fullCode, combined };
  if (combined.includes("CONC") || code === "CON" || combined.includes("DISPATCH") || code === "DSP")
    return { category: "conclusion_or_dispatch", code, fullCode, combined };
  return { category: "unknown", code, fullCode, combined };
}

export async function processIfoodEvent(supabaseAdmin: any, token: string, ev: any): Promise<{ processed: boolean }> {
  const { category, code, fullCode } = classifyIfoodEvent(ev);

  await logApi(supabaseAdmin, {
    source: "ifood_poll_event",
    direction: "in",
    request_payload: ev,
    order_id: ev.orderId ?? null,
    event_type: fullCode || code || "desconhecido",
  });

  if (category === "new_order") {
    const orderRes = await fetch(`${IFOOD_API_BASE}/order/v1.0/orders/${ev.orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (orderRes.ok) {
      const orderPayload = await orderRes.json();
      await createOrderFromIfoodPayload(supabaseAdmin, { ...orderPayload, id: orderPayload.id ?? ev.orderId });
      return { processed: true };
    }
    await logApi(supabaseAdmin, {
      source: "ifood_poll",
      direction: "out",
      response_status: orderRes.status,
      error_message: `falha ao buscar detalhes do pedido ${ev.orderId}`,
      order_id: ev.orderId,
      event_type: fullCode || code,
    });
    return { processed: false };
  }

  if (category === "cancellation_failed") {
    await handleIfoodCancellationFailure(supabaseAdmin, ev.orderId, ev);
    return { processed: true };
  }

  if (category === "cancellation_confirmed") {
    const { data: cOrder } = await supabaseAdmin
      .from("orders")
      .select("id, status")
      .eq("external_id", ev.orderId)
      .maybeSingle();
    if (cOrder && cOrder.status !== "cancelled") {
      await supabaseAdmin
        .from("orders")
        .update({ status: "cancelled", ifood_last_pushed_status: "cancelled" })
        .eq("id", cOrder.id);
    }
    return { processed: true };
  }

  if (category === "cancellation_requested") {
    // IMPORTANTE: aqui já existiu uma chamada de rede pra "aceitar" esse
    // cancelamento (primeiro em /requestCancellation/accept, depois em
    // /cancellation/accept) — nenhuma das duas é um endpoint real da iFood
    // (confirmado por 404 "no Route matched" nos dois casos, em testes
    // reais). A documentação oficial confirma: quando o cancelamento não
    // parte da loja, a iFood processa sozinha e manda um evento
    // CAN/CANCELLED depois — já tratado acima em "cancellation_confirmed".
    // Esse evento CAR é só um aviso informativo; não precisa (e não tem
    // como) responder a ele via API.
    return { processed: true };
  }

  if (category === "driver_assigned") {
    const { data: dOrder } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, external_display_id")
      .eq("external_id", ev.orderId)
      .maybeSingle();
    if (dOrder) {
      await supabaseAdmin
        .from("orders")
        .update({ ifood_driver_assigned_at: new Date().toISOString() })
        .eq("id", dOrder.id);
      await logApi(supabaseAdmin, {
        source: "ifood_poll_event",
        direction: "in",
        response_status: 200,
        response_body: `Entregador da iFood designado pro pedido ${dOrder.external_display_id ?? ev.orderId} — a caminho da loja`,
        order_id: ev.orderId,
        event_type: fullCode || code,
      });
    }
    return { processed: true };
  }

  if (category === "conclusion_or_dispatch") {
    await handleIfoodConclusionEvent(supabaseAdmin, ev.orderId, fullCode || code);
    return { processed: true };
  }

  return { processed: false };
}

// ============================================================
// Polling de eventos (Events API) — chamado periodicamente pelo pg_cron
// ============================================================

export async function pollIfoodEvents(supabaseAdmin: any): Promise<{ processed: number; error?: string }> {
  const token = await getIfoodAccessToken(supabaseAdmin);
  if (!token) {
    await supabaseAdmin
      .from("store_config")
      .update({
        ifood_last_poll_at: new Date().toISOString(),
        ifood_last_poll_error: "sem token — verifique client_id/secret",
      })
      .eq("id", 1);
    return { processed: 0, error: "no_token" };
  }

  try {
    const res = await fetch(`${IFOOD_API_BASE}/events/v1.0/events:polling`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await supabaseAdmin
        .from("store_config")
        .update({
          ifood_last_poll_at: new Date().toISOString(),
          ifood_last_poll_error: `polling ${res.status}: ${detail.slice(0, 200)}`,
        })
        .eq("id", 1);
      await logApi(supabaseAdmin, {
        source: "ifood_poll",
        direction: "out",
        response_status: res.status,
        response_body: detail,
        error_message: "polling respondeu erro",
      });
      return { processed: 0, error: `http_${res.status}` };
    }

    // a iFood devolve 204 (sem corpo) quando não tem evento novo — isso é
    // normal e acontece na maioria das consultas, não é erro nenhum
    const rawBody = await res.text();
    if (res.status === 204 || !rawBody || !rawBody.trim().length) {
      await supabaseAdmin
        .from("store_config")
        .update({ ifood_last_poll_at: new Date().toISOString(), ifood_last_poll_error: null })
        .eq("id", 1);
      return { processed: 0 };
    }

    let events: any[] = [];
    try {
      events = JSON.parse(rawBody);
    } catch {
      await logApi(supabaseAdmin, {
        source: "ifood_poll",
        direction: "out",
        response_status: res.status,
        response_body: rawBody.slice(0, 500),
        error_message: "corpo da resposta não é JSON válido",
      });
      await supabaseAdmin
        .from("store_config")
        .update({ ifood_last_poll_at: new Date().toISOString(), ifood_last_poll_error: null })
        .eq("id", 1);
      return { processed: 0 };
    }

    let processed = 0;
    for (const ev of events ?? []) {
      const { processed: wasProcessed } = await processIfoodEvent(supabaseAdmin, token, ev);
      if (wasProcessed) processed++;
    }

    if (events?.length) {
      await fetch(`${IFOOD_API_BASE}/events/v1.0/events/acknowledgment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(events.map((e: any) => ({ id: e.id }))),
      });
      await logApi(supabaseAdmin, {
        source: "ifood_poll",
        direction: "out",
        response_status: 200,
        response_body: `${events.length} evento(s) recebido(s), ${processed} processado(s)`,
      });
    }

    await supabaseAdmin
      .from("store_config")
      .update({ ifood_last_poll_at: new Date().toISOString(), ifood_last_poll_error: null })
      .eq("id", 1);
    return { processed };
  } catch (err: any) {
    await supabaseAdmin
      .from("store_config")
      .update({ ifood_last_poll_at: new Date().toISOString(), ifood_last_poll_error: String(err?.message ?? err) })
      .eq("id", 1);
    await logApi(supabaseAdmin, { source: "ifood_poll", direction: "out", error_message: String(err?.message ?? err) });
    return { processed: 0, error: String(err?.message ?? err) };
  }
}

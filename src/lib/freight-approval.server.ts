export type FreightApprovalOutcome = {
  status: "bot_sent" | "operator_will_send" | "pending" | "failed";
  fee: number | null;
};

export type PartnerFreightQuoteOutcome = {
  status: "pending" | "resolved" | "failed";
  fee: number | null;
  created: boolean;
};

const WINDOW_MS = 25_000;
const POLL_MS = 1_000;

export function normalizeFreightAddressKey(address: string) {
  return String(address || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractManualFreightValue(text: string): number | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const looksLikeFreightMessage =
    /\b(taxa|frete|entrega)\b/.test(normalized) ||
    /^\s*(?:r\$\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*$/.test(normalized);

  if (!looksLikeFreightMessage) return null;

  const money = raw.match(/(?:r\$\s*)?(\d{1,3}(?:[.,]\d{1,2})?)/i);
  if (!money?.[1]) return null;
  const value = Number(money[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
}

export async function requestFreightApproval(
  supabaseAdmin: any,
  input: {
    conversationId: string;
    phone: string;
    customerName?: string | null;
    address: string;
    fee: number;
    distanceKm?: number | null;
    requireHuman?: boolean;
  },
): Promise<FreightApprovalOutcome> {
  const addressKey = normalizeFreightAddressKey(input.address);

  const { data: draft } = await (supabaseAdmin as any)
    .from("order_drafts")
    .select("freight_notification_status,freight_notification_value,freight_notification_address_key")
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  if (
    draft?.freight_notification_address_key === addressKey &&
    ["sent_by_bot", "sent_by_operator", "operator_will_send"].includes(
      String(draft?.freight_notification_status || ""),
    )
  ) {
    if (draft.freight_notification_status === "sent_by_bot") {
      return { status: "bot_sent", fee: Number(draft.freight_notification_value) };
    }
    return {
      status: "operator_will_send",
      fee: draft.freight_notification_value == null
        ? Number(input.fee)
        : Number(draft.freight_notification_value),
    };
  }

  let approvalId: string | null = null;

  try {
    const { data: existing } = await (supabaseAdmin as any)
      .from("pending_freight_approvals")
      .select("id,status,fee,address_key")
      .eq("conversation_id", input.conversationId)
      .eq("address_key", addressKey)
      .in("status", ["pending", "bot_sent", "operator_will_send"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.status === "bot_sent") {
      return { status: "bot_sent", fee: Number(existing.fee) };
    }
    if (existing?.status === "operator_will_send") {
      return { status: "operator_will_send", fee: Number(existing.fee) };
    }

    if (existing?.id) {
      approvalId = existing.id;
    } else {
      const { data, error } = await (supabaseAdmin as any)
        .from("pending_freight_approvals")
        .insert({
          conversation_id: input.conversationId,
          phone: input.phone,
          customer_name: input.customerName ?? null,
          address: input.address,
          address_key: addressKey,
          fee: Number(input.fee),
          distance_km: input.distanceKm ?? null,
          status: "pending",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("id")
        .single();

      if (error || !data?.id) return { status: "failed", fee: null };
      approvalId = String(data.id);
    }
  } catch (error) {
    console.error("[FREIGHT_APPROVAL] falha ao abrir popup:", error);
    return { status: "failed", fee: null };
  }

  const deadline = Date.now() + WINDOW_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const { data } = await (supabaseAdmin as any)
        .from("pending_freight_approvals")
        .select("status, fee")
        .eq("id", approvalId)
        .maybeSingle();

      const status = String(data?.status || "");
      if (status === "bot_sent") {
        return { status: "bot_sent", fee: Number(data?.fee ?? input.fee) };
      }
      if (status === "operator_will_send" || status === "operator_sent") {
        return { status: "operator_will_send", fee: Number(data?.fee ?? input.fee) };
      }
      if (status === "failed") return { status: "failed", fee: null };
    } catch {}
  }

  return { status: "pending", fee: null };
}

export async function captureOperatorFreightMessage(
  supabaseAdmin: any,
  input: { conversationId: string; text: string; commit?: boolean },
) {
  const { data: draft } = await (supabaseAdmin as any)
    .from("order_drafts")
    .select("freight_notification_status,freight_notification_value,freight_notification_address_key")
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  const status = String(draft?.freight_notification_status || "");
  const value = extractManualFreightValue(input.text);

  if (status === "sent_by_bot" && value != null) {
    return {
      blocked: true,
      error: "A taxa de entrega já foi enviada automaticamente ao cliente. Não envie outro valor para o mesmo endereço.",
    };
  }

  if (status === "sent_by_operator" && value != null) {
    return {
      blocked: true,
      error: "A taxa de entrega já foi informada manualmente para esse endereço. Para alterar, primeiro mude o endereço do pedido.",
    };
  }

  if (status !== "operator_will_send" || value == null) {
    return { blocked: false, captured: false, value };
  }

  if (input.commit === false) {
    return { blocked: false, captured: true, value };
  }

  const now = new Date().toISOString();
  await (supabaseAdmin as any)
    .from("order_drafts")
    .update({
      estimated_delivery_fee: value,
      freight_notification_status: "sent_by_operator",
      freight_notification_value: value,
      freight_notification_at: now,
      awaiting_final_confirmation: false,
      updated_at: now,
    })
    .eq("conversation_id", input.conversationId);

  await (supabaseAdmin as any)
    .from("pending_freight_approvals")
    .update({
      status: "operator_sent",
      fee: value,
      resolved_at: now,
    })
    .eq("conversation_id", input.conversationId)
    .in("status", ["pending", "operator_will_send"]);

  return { blocked: false, captured: true, value };
}


/**
 * Abre uma cotação obrigatória com motoboy parceiro.
 * Diferente do popup padrão, NÃO existe valor sugerido e NÃO existe opção
 * "eu vou informar". O operador consulta o parceiro, digita a taxa e autoriza
 * o sistema a enviar uma única vez ao cliente.
 */
export async function requestPartnerFreightQuote(
  supabaseAdmin: any,
  input: {
    conversationId: string;
    phone: string;
    customerName?: string | null;
    address: string;
  },
): Promise<PartnerFreightQuoteOutcome> {
  const addressKey = normalizeFreightAddressKey(input.address);

  const { data: draft } = await (supabaseAdmin as any)
    .from("order_drafts")
    .select("freight_notification_status,freight_notification_value,freight_notification_address_key")
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  if (
    draft?.freight_notification_address_key === addressKey &&
    ["sent_by_bot", "sent_by_operator"].includes(String(draft?.freight_notification_status || "")) &&
    Number(draft?.freight_notification_value) > 0
  ) {
    return {
      status: "resolved",
      fee: Number(draft.freight_notification_value),
      created: false,
    };
  }

  const { data: existing, error: existingError } = await (supabaseAdmin as any)
    .from("pending_freight_approvals")
    .select("id,status,fee,approval_kind")
    .eq("conversation_id", input.conversationId)
    .eq("address_key", addressKey)
    .eq("approval_kind", "partner_quote")
    .in("status", ["pending", "bot_sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("[PARTNER_FREIGHT] falha ao buscar cotação existente:", existingError);
    return { status: "failed", fee: null, created: false };
  }

  if (existing?.status === "bot_sent" && Number(existing.fee) > 0) {
    return { status: "resolved", fee: Number(existing.fee), created: false };
  }

  if (existing?.id) {
    await (supabaseAdmin as any)
      .from("order_drafts")
      .update({
        estimated_delivery_fee: null,
        freight_notification_status: "partner_quote_pending",
        freight_notification_value: null,
        freight_notification_address_key: addressKey,
        freight_notification_at: null,
        awaiting_final_confirmation: false,
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", input.conversationId);

    return { status: "pending", fee: null, created: false };
  }

  await (supabaseAdmin as any)
    .from("pending_freight_approvals")
    .update({ status: "failed", resolved_at: new Date().toISOString() })
    .eq("conversation_id", input.conversationId)
    .eq("address_key", addressKey)
    .eq("status", "pending")
    .neq("approval_kind", "partner_quote");

  const { data: inserted, error } = await (supabaseAdmin as any)
    .from("pending_freight_approvals")
    .insert({
      conversation_id: input.conversationId,
      phone: input.phone,
      customer_name: input.customerName ?? null,
      address: input.address,
      address_key: addressKey,
      fee: 0,
      distance_km: null,
      approval_kind: "partner_quote",
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error || !inserted?.id) {
    console.error("[PARTNER_FREIGHT] falha ao abrir cotação:", error);
    return { status: "failed", fee: null, created: false };
  }

  await (supabaseAdmin as any)
    .from("order_drafts")
    .update({
      estimated_delivery_fee: null,
      freight_notification_status: "partner_quote_pending",
      freight_notification_value: null,
      freight_notification_address_key: addressKey,
      freight_notification_at: null,
      awaiting_final_confirmation: false,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", input.conversationId);

  return { status: "pending", fee: null, created: true };
}

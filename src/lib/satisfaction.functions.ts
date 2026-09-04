import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function cleanName(name: string | null | undefined) {
  const value = String(name ?? "").trim();
  return value || "cliente";
}

function publicOrigin() {
  const request = getRequest();
  if (!request) return "";

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

async function requireStoreAdmin(context: any) {
  const { data: role } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "store_admin")
    .maybeSingle();
  return !!role;
}

async function resolveLead(supabaseAdmin: any, leadId?: string, phone?: string) {
  if (leadId) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id,name,phone,order_count")
      .eq("id", leadId)
      .maybeSingle();
    if (data) return data;
  }

  if (phone) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id,name,phone,order_count")
      .eq("phone", phone)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function feedbackStatusForLead(supabaseAdmin: any, lead: any) {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,external_display_id,status,created_at")
    .eq("customer_phone", lead.phone)
    .eq("status", "delivered")
    .order("created_at", { ascending: false });

  const deliveredOrders = orders ?? [];
  const orderIds = deliveredOrders.map((o: any) => o.id);
  const { data: feedbackRows } = orderIds.length
    ? await supabaseAdmin
        .from("customer_feedback")
        .select("id,order_id,sent_at,opened_at,submitted_at,created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
    : { data: [] as any[] };

  const byOrder = new Map<string, any>();
  for (const row of feedbackRows ?? []) {
    if (row.order_id && !byOrder.has(row.order_id)) byOrder.set(row.order_id, row);
  }

  const latestOrder = deliveredOrders[0] ?? null;
  const latestFeedback = latestOrder ? byOrder.get(latestOrder.id) ?? null : null;
  // Só o pedido entregue mais recente pode gerar um novo convite. Isso evita
  // que, ao ativar o recurso, pedidos antigos do histórico virem uma fila de spam.
  const eligibleOrder = latestOrder && !latestFeedback ? latestOrder : null;
  const lastFeedback = (feedbackRows ?? [])[0] ?? null;

  return {
    hasPurchase: deliveredOrders.length > 0,
    deliveredOrders: deliveredOrders.length,
    latestOrder: latestOrder
      ? {
          id: latestOrder.id,
          number: latestOrder.external_display_id || latestOrder.order_number || null,
          createdAt: latestOrder.created_at,
        }
      : null,
    latestOrderFeedback: latestFeedback
      ? {
          sentAt: latestFeedback.sent_at,
          openedAt: latestFeedback.opened_at,
          submittedAt: latestFeedback.submitted_at,
        }
      : null,
    eligibleOrder: eligibleOrder
      ? {
          id: eligibleOrder.id,
          number: eligibleOrder.external_display_id || eligibleOrder.order_number || null,
          createdAt: eligibleOrder.created_at,
        }
      : null,
    lastFeedback: lastFeedback
      ? {
          sentAt: lastFeedback.sent_at,
          openedAt: lastFeedback.opened_at,
          submittedAt: lastFeedback.submitted_at,
        }
      : null,
  };
}


export async function sendSatisfactionForOrder(params: {
  supabaseAdmin: any;
  orderId: string;
  origin: string;
  createdBy?: string | null;
}) {
  const { supabaseAdmin, orderId, origin, createdBy = null } = params;
  const { sendWhatsappText } = await import("@/lib/whatsapp-send.server");

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,external_display_id,status,customer_phone,customer_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "delivered") return { ok: false, error: "Pedido não elegível para avaliação." } as const;

  const phone = String(order.customer_phone ?? "").replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Pedido sem telefone do cliente." } as const;

  let { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id,name,phone")
    .eq("phone", order.customer_phone)
    .maybeSingle();

  if (!lead) {
    const fallbackName = cleanName(order.customer_name);
    const { data: createdLead } = await supabaseAdmin
      .from("leads")
      .upsert({
        phone: order.customer_phone,
        name: fallbackName === "cliente" ? order.customer_phone : fallbackName,
        order_count: 1,
        last_order_at: new Date().toISOString(),
      }, { onConflict: "phone" })
      .select("id,name,phone")
      .maybeSingle();
    lead = createdLead;
  }
  if (!lead) return { ok: false, error: "Não foi possível localizar o Lead do cliente." } as const;

  const { data: existing } = await supabaseAdmin
    .from("customer_feedback")
    .select("id,token,sent_at,opened_at,submitted_at")
    .eq("order_id", order.id)
    .maybeSingle();

  if (existing?.submitted_at) return { ok: true, state: "submitted", alreadySent: true } as const;
  if (existing?.sent_at) return { ok: true, state: existing.opened_at ? "opened" : "sent", alreadySent: true } as const;

  let feedbackId = existing?.id as string | undefined;
  let token = existing?.token as string | undefined;
  if (!feedbackId || !token) {
    const generatedToken = crypto.randomUUID();
    const { data: created, error } = await supabaseAdmin
      .from("customer_feedback")
      .insert({
        lead_id: lead.id,
        order_id: order.id,
        customer_name: cleanName(order.customer_name || lead.name),
        phone: lead.phone,
        token: generatedToken,
        sent_at: null,
        created_by: createdBy,
      })
      .select("id,token")
      .single();

    if (error || !created) {
      // Pode ter ocorrido corrida entre envio manual e automático. Releia o registro.
      const { data: raced } = await supabaseAdmin
        .from("customer_feedback")
        .select("id,token,sent_at,opened_at,submitted_at")
        .eq("order_id", order.id)
        .maybeSingle();
      if (raced?.submitted_at || raced?.sent_at) return { ok: true, state: raced.submitted_at ? "submitted" : raced.opened_at ? "opened" : "sent", alreadySent: true } as const;
      if (!raced?.id || !raced?.token) return { ok: false, error: "Não foi possível gerar o link de avaliação." } as const;
      feedbackId = raced.id;
      token = raced.token;
    } else {
      feedbackId = created.id;
      token = created.token || generatedToken;
    }
  }

  const base = String(origin || "").replace(/\/$/, "");
  if (!base) return { ok: false, error: "URL pública do sistema não configurada." } as const;
  const link = `${base}/avaliacao/${token}`;
  const firstName = cleanName(order.customer_name || lead.name).split(/\s+/)[0];
  const message =
    `Olá, ${firstName}! 😊 Obrigado por escolher a HotBox Delivery.\n\n` +
    `Você poderia separar só *20 segundos* para avaliar sua experiência com a nossa *batata recheada*? Sua avaliação nos ajuda a melhorar ainda mais nosso atendimento, entrega e produtos.\n\n` +
    `⭐ Avalie aqui: ${link}\n\n` +
    `É bem rapidinho. Muito obrigado pela confiança! ❤️`;

  const sent = await sendWhatsappText(supabaseAdmin, lead.phone, message);
  if (!sent.ok) return { ok: false, error: "Não foi possível enviar a mensagem pelo WhatsApp." } as const;

  const sentAt = new Date().toISOString();
  await supabaseAdmin
    .from("customer_feedback")
    .update({ sent_at: sentAt, whatsapp_message_id: sent.externalId ?? null })
    .eq("id", feedbackId);

  // Mantém a mensagem visível no histórico do Chat quando existir conversa do telefone.
  const { data: conversation } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone", lead.phone)
    .maybeSingle();
  if (conversation?.id) {
    await supabaseAdmin.from("whatsapp_messages").insert({
      conversation_id: conversation.id,
      direction: "out",
      sender_type: "bot",
      body: message,
      external_id: sent.externalId ?? null,
    });
    await supabaseAdmin.from("whatsapp_conversations").update({
      last_message_at: sentAt,
      last_message_preview: message.slice(0, 140),
    }).eq("id", conversation.id);
  }

  return { ok: true, state: "sent", link, orderId: order.id } as const;
}

export const getSatisfactionStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { leadId?: string; phone?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;

    const lead = await resolveLead(supabaseAdmin, data.leadId, data.phone);
    if (!lead) return { ok: true, found: false } as const;

    return {
      ok: true,
      found: true,
      leadId: lead.id,
      ...(await feedbackStatusForLead(supabaseAdmin, lead)),
    } as const;
  });

export const sendSatisfactionRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { leadId?: string; phone?: string; orderId?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." };

    const lead = await resolveLead(supabaseAdmin, data.leadId, data.phone);
    if (!lead) return { ok: false, error: "Cliente não encontrado no cadastro de Leads." };
    if (!lead.phone) return { ok: false, error: "Este contato não possui telefone." };

    let orderId = data.orderId;
    if (!orderId) {
      const status = await feedbackStatusForLead(supabaseAdmin, lead);
      if (!status.hasPurchase) return { ok: false, error: "A avaliação só pode ser enviada depois de um pedido entregue." };
      if (!status.eligibleOrder) return { ok: false, error: "Todos os pedidos entregues deste cliente já receberam convite de avaliação." };
      orderId = status.eligibleOrder.id;
    }

    const origin = publicOrigin();
    return sendSatisfactionForOrder({
      supabaseAdmin,
      orderId,
      origin,
      createdBy: context.userId,
    });
  });

export const getPublicFeedbackFn = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: feedback } = await supabaseAdmin
      .from("customer_feedback")
      .select("id,customer_name,submitted_at")
      .eq("token", data.token)
      .maybeSingle();

    if (!feedback) return { found: false as const };

    if (!feedback.submitted_at) {
      await supabaseAdmin
        .from("customer_feedback")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", feedback.id)
        .is("opened_at", null);
    }

    return {
      found: true as const,
      customerName: feedback.customer_name as string | null,
      submitted: !!feedback.submitted_at,
    };
  });

export const submitPublicFeedbackFn = createServerFn({ method: "POST" })
  .inputValidator((data: {
    token: string;
    serviceRating: number;
    deliveryRating: number;
    flavorRating: number;
    appearanceRating: number;
    comment?: string;
  }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ratings = [data.serviceRating, data.deliveryRating, data.flavorRating, data.appearanceRating];
    if (ratings.some((rating) => !Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return { ok: false, error: "Dê de 1 a 5 estrelas em todos os itens." };
    }

    const comment = String(data.comment ?? "").trim().slice(0, 1200) || null;
    const { data: existing } = await supabaseAdmin
      .from("customer_feedback")
      .select("id,submitted_at")
      .eq("token", data.token)
      .maybeSingle();

    if (!existing) return { ok: false, error: "Link de avaliação inválido." };
    if (existing.submitted_at) return { ok: true, alreadySubmitted: true };

    const { error } = await supabaseAdmin
      .from("customer_feedback")
      .update({
        service_rating: data.serviceRating,
        delivery_rating: data.deliveryRating,
        flavor_rating: data.flavorRating,
        appearance_rating: data.appearanceRating,
        comment,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .is("submitted_at", null);

    if (error) return { ok: false, error: "Não foi possível salvar sua avaliação. Tente novamente." };
    return { ok: true };
  });

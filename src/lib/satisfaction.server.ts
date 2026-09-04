
import { getRequest } from "@tanstack/react-start/server";
import { sendWhatsappText } from "@/lib/whatsapp-send.server";

function cleanName(name: string | null | undefined) {
  const value = String(name ?? "").trim();
  return value || "cliente";
}

export function publicOrigin() {
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

export async function sendSatisfactionForOrder(params: {
  supabaseAdmin: any;
  orderId: string;
  origin: string;
  createdBy?: string | null;
}) {
  const { supabaseAdmin, orderId, origin, createdBy = null } = params;

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

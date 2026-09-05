import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

    const { publicOrigin, sendSatisfactionForOrder } = await import("@/lib/satisfaction.server");
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

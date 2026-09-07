import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const resolveFreightApprovalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    approvalId: string;
    mode: "bot" | "operator";
    fee: number;
  }) => data)
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "store_admin")
      .maybeSingle();
    if (!role) return { ok: false, error: "Acesso não autorizado." } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsappText } = await import("@/lib/whatsapp-send.server");
    const { requestSilentHumanHandoff } = await import("@/lib/human-handoff.server");

    const fee = Number(data.fee);
    if (!Number.isFinite(fee) || fee <= 0) {
      return { ok: false, error: "Taxa inválida." } as const;
    }

    const { data: approval, error: approvalError } = await (supabaseAdmin as any)
      .from("pending_freight_approvals")
      .select("id,conversation_id,phone,customer_name,address,address_key,status,approval_kind")
      .eq("id", data.approvalId)
      .maybeSingle();

    if (approvalError || !approval) {
      return { ok: false, error: "Aprovação de taxa não encontrada." } as const;
    }

    if (!["pending", "operator_will_send"].includes(String(approval.status || ""))) {
      return { ok: false, error: "Essa taxa já foi resolvida." } as const;
    }

    const now = new Date().toISOString();
    const approvalKind = String((approval as any).approval_kind || "standard");

    if (approvalKind === "partner_quote" && data.mode === "operator") {
      return {
        ok: false,
        error: "Cotação de motoboy parceiro exige digitar o valor e autorizar o sistema a enviar.",
      } as const;
    }

    if (data.mode === "operator") {
      await (supabaseAdmin as any)
        .from("pending_freight_approvals")
        .update({ status: "operator_will_send", fee, resolved_at: now })
        .eq("id", approval.id);

      await (supabaseAdmin as any)
        .from("order_drafts")
        .update({
          estimated_delivery_fee: null,
          freight_notification_status: "operator_will_send",
          freight_notification_value: fee,
          freight_notification_address_key: approval.address_key ?? null,
          freight_notification_at: null,
          awaiting_final_confirmation: false,
          updated_at: now,
        })
        .eq("conversation_id", approval.conversation_id);

      return { ok: true, mode: "operator", fee } as const;
    }

    await (supabaseAdmin as any)
      .from("order_drafts")
      .update({
        estimated_delivery_fee: fee,
        freight_notification_status: "bot_authorized",
        freight_notification_value: fee,
        freight_notification_address_key: approval.address_key ?? null,
        freight_notification_at: null,
        awaiting_final_confirmation: false,
        updated_at: now,
      })
      .eq("conversation_id", approval.conversation_id);

    const firstName = String(approval.customer_name || "").trim().split(/\s+/)[0];
    const feeLabel = fee.toFixed(2).replace(".", ",");
    const message = `${firstName ? `${firstName}, ` : ""}a taxa de entrega para seu endereço é de R$ ${feeLabel}.`;

    const result = await sendWhatsappText(supabaseAdmin, approval.phone, message);
    if (!result?.ok) {
      await (supabaseAdmin as any)
        .from("pending_freight_approvals")
        .update({ status: "failed", resolved_at: now })
        .eq("id", approval.id);

      await requestSilentHumanHandoff(supabaseAdmin, {
        conversationId: approval.conversation_id,
        phone: approval.phone,
        customerName: approval.customer_name,
        reason: "Falha ao enviar a taxa de entrega autorizada. O cliente precisa de atendimento manual.",
        severity: "error",
      });

      return { ok: false, error: "Não foi possível enviar a taxa pelo WhatsApp." } as const;
    }

    await (supabaseAdmin as any)
      .from("whatsapp_messages")
      .insert({
        conversation_id: approval.conversation_id,
        direction: "out",
        sender_type: "bot",
        body: message,
        media_type: "system",
        external_id: result.externalId ?? null,
      });

    await (supabaseAdmin as any)
      .from("pending_freight_approvals")
      .update({ status: "bot_sent", fee, resolved_at: now })
      .eq("id", approval.id);

    await (supabaseAdmin as any)
      .from("order_drafts")
      .update({
        estimated_delivery_fee: fee,
        freight_notification_status: "sent_by_bot",
        freight_notification_value: fee,
        freight_notification_address_key: approval.address_key ?? null,
        freight_notification_at: now,
        awaiting_final_confirmation: false,
        updated_at: now,
      })
      .eq("conversation_id", approval.conversation_id);

    return { ok: true, mode: "bot", fee } as const;
  });

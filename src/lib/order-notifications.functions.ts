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

async function registerChatMessage(supabaseAdmin: any, phone: string, body: string, externalId?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const { data: conv } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("id")
    .or(`phone.eq.${digits},phone.eq.${local}`)
    .limit(1)
    .maybeSingle();
  if (!conv?.id) return;
  await supabaseAdmin.from("whatsapp_messages").insert({
    conversation_id: conv.id,
    direction: "out",
    sender_type: "admin",
    body,
    external_id: externalId ?? null,
  });
  await supabaseAdmin
    .from("whatsapp_conversations")
    .update({ last_message_at: new Date().toISOString(), last_message_preview: body.slice(0, 140) })
    .eq("id", conv.id);
}

export const sendOrderArrivalNoticeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsappText } = await import("@/lib/whatsapp-send.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,order_number,external_display_id,customer_name,customer_phone,delivery_mode,status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !order) return { ok: false, error: "Pedido não encontrado." } as const;
    if (!order.customer_phone) return { ok: false, error: "Pedido sem telefone do cliente." } as const;

    const firstName = String(order.customer_name || "cliente").trim().split(/\s+/)[0];
    const ref = order.external_display_id || order.order_number;
    const refText = ref ? ` #${String(ref).replace(/^#/, "")}` : "";
    const message = order.delivery_mode === "pickup"
      ? `Olá, ${firstName}! 📦 Seu pedido${refText} já está pronto para retirada. Pode vir buscar quando quiser. 😊`
      : `Olá, ${firstName}! 🛵 Seu pedido${refText} chegou! Pode sair para receber. Bom apetite e obrigado por escolher a HotBox Delivery! ❤️`;

    const sent = await sendWhatsappText(supabaseAdmin, order.customer_phone, message);
    if (!sent.ok) return { ok: false, error: "Não foi possível enviar a mensagem pelo WhatsApp." } as const;
    await registerChatMessage(supabaseAdmin, order.customer_phone, message, sent.externalId);
    return { ok: true } as const;
  });

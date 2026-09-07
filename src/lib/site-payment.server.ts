export async function activatePaidSiteOrder(
  supabaseAdmin: any,
  orderId: string,
  confirmedBy: string,
  providerRef?: string | null,
) {
  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,external_display_id,source,status,payment_status,payment_method,total,customer_name,customer_phone,delivery_mode")
    .eq("id", orderId)
    .maybeSingle();
  if (readError || !order) return { ok: false, error: readError?.message || "Pedido não encontrado" } as const;

  if (order.payment_status === "paid") return { ok: true, alreadyPaid: true, order } as const;

  const patch: any = {
    payment_status: "paid",
    payment_timing: "now",
    payment_confirmed_at: new Date().toISOString(),
    payment_confirmed_by: confirmedBy,
  };
  if (order.source === "site" && order.status === "pending_review") patch.status = "pending";
  if (providerRef) patch.payment_link = providerRef;

  const { data: updated, error } = await supabaseAdmin.from("orders").update(patch).eq("id", orderId).select("*").single();
  if (error) return { ok: false, error: error.message } as const;

  if (order.source === "site" && order.customer_phone) {
    const firstName = String(order.customer_name || "cliente").trim().split(/\s+/)[0];
    const ref = order.external_display_id || order.order_number;
    const refText = ref ? ` #${String(ref).replace(/^#/, "")}` : "";
    const method = order.payment_method === "card" ? "cartão" : order.payment_method === "pix" ? "Pix" : "dinheiro";
    const message = `✅ *HotBox Delivery*\n\nOlá, ${firstName}! Seu pagamento via ${method} foi confirmado e o pedido${refText} entrou no nosso sistema. 🍟🔥\n\nVamos avisar por aqui cada etapa até a entrega.`;
    try {
      const { sendWhatsappText } = await import("@/lib/whatsapp-send.server");
      const sent = await sendWhatsappText(supabaseAdmin, order.customer_phone, message);
      const phone = String(order.customer_phone).replace(/\D/g, "");
      const { data: conv } = await supabaseAdmin
        .from("whatsapp_conversations")
        .upsert({ phone, customer_name: order.customer_name || null, last_message_at: new Date().toISOString(), last_message_preview: message.slice(0, 140) }, { onConflict: "phone" })
        .select("id")
        .single();
      if (conv?.id) {
        await supabaseAdmin.from("whatsapp_messages").insert({
          conversation_id: conv.id,
          direction: "out",
          sender_type: "admin",
          body: message,
          external_id: sent.ok ? sent.externalId ?? null : null,
        });
      }
    } catch (notifyError) {
      console.error("[site-payment] pedido pago, mas aviso inicial no WhatsApp falhou", notifyError);
    }
  }

  return { ok: true, order: updated } as const;
}

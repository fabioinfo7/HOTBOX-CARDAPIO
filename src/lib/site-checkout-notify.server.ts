// HOTBOX_BUILD_20260905_SITE_CHECKOUT_NOTIFY_SERVER_ONLY
import { sendWhatsappText } from "@/lib/whatsapp-send.server";

export async function notifyPaidSiteOrder(supabaseAdmin: any, orderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,external_display_id,customer_name,customer_phone,payment_method,payment_confirmed_by")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.customer_phone) return;
  const firstName = String(order.customer_name || "cliente").trim().split(/\s+/)[0];
  const ref = order.external_display_id || order.order_number;
  const refText = ref ? ` #${String(ref).replace(/^#/, "")}` : "";
  const method = order.payment_method === "pix" ? "Pix" : "cartão";
  const provider = order.payment_confirmed_by === "infinitepay"
    ? "InfinitePay"
    : order.payment_confirmed_by === "mercadopago"
      ? "Mercado Pago"
      : order.payment_confirmed_by === "stripe"
        ? "Stripe"
        : "pagamento online";
  const message = `✅ *Pagamento confirmado via ${provider}*\n\nOlá, ${firstName}! O pagamento do pedido${refText} via ${method} foi confirmado. Seu pedido já entrou no sistema da Hotbox e seguirá para preparo. 🍟🔥\n\nVamos avisar por aqui cada etapa até a entrega.`;
  try {
    await sendWhatsappText(supabaseAdmin, order.customer_phone, message);
  } catch (e) {
    console.error("[site-checkout] pagamento confirmado, mas aviso WhatsApp falhou", e);
  }
}

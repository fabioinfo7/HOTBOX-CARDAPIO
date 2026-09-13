import { createFileRoute } from "@tanstack/react-router";
import { sendWhatsappText } from "@/lib/whatsapp-send.server";

// Chamado pelo trigger public.notify_customer_order_status() (banco) sempre
// que o status de um pedido muda. Existe só pra centralizar a decisão de
// QUAL provedor usar (Evolution ou Meta Cloud API) num lugar só — o SQL
// nunca mais monta URL de Evolution diretamente, só manda phone+texto pra
// cá, e o whatsapp-send.server.ts decide o resto.

export const Route = createFileRoute("/api/public/webhooks/whatsapp-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const { phone, text } = payload ?? {};
        if (!phone || !text) return Response.json({ ignored: "missing_fields" });

        await sendWhatsappText(supabaseAdmin, phone, text);
        return Response.json({ ok: true });
      },
    },
  },
});

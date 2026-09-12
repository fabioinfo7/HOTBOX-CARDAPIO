import { createFileRoute } from "@tanstack/react-router";
import { pushNfoodOrderStatus } from "@/lib/nfood-api.server";

// Chamada automaticamente pelo trigger public.push_nfood_status_change()
// toda vez que o status de um pedido com source='99food' muda — não importa
// se a mudança veio do painel, da tela de detalhe, ou de qualquer lugar
// futuro. Espelha webhooks.ifood-status-push.ts, mas 100% isolado dele.

export const Route = createFileRoute("/api/public/webhooks/nfood-status-push")({
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

        const { order_id, new_status } = payload ?? {};
        if (!order_id || !new_status) return Response.json({ ignored: "missing_fields" });

        const result = await pushNfoodOrderStatus(supabaseAdmin, order_id, new_status);
        return Response.json(result);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { pollIfoodEvents } from "@/lib/ifood-api.server";

// Chamada automaticamente pelo pg_cron (agendado via reschedule_ifood_polling()
// depois que você ativa "Polling automático" em /loja/config). Protegida por
// token pra ninguém de fora conseguir disparar isso.

export const Route = createFileRoute("/api/public/webhooks/ifood-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => await handle(request),
      GET: async ({ request }) => await handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const { data: cfg } = await supabaseAdmin.from("store_config").select("ifood_polling_token, ifood_polling_enabled").maybeSingle();
  if (!cfg?.ifood_polling_token || token !== cfg.ifood_polling_token) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!cfg.ifood_polling_enabled) {
    return Response.json({ skipped: "polling_disabled" });
  }

  const result = await pollIfoodEvents(supabaseAdmin);
  return Response.json(result);
}

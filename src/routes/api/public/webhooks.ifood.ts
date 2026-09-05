import { createFileRoute } from "@tanstack/react-router";
import { createOrderFromIfoodPayload, type IfoodOrderPayload } from "@/lib/ifood-api.server";
import { logApi } from "@/lib/api-log.server";

// Configure no Painel do Parceiro iFood (ou no seu integrador/middleware de homologação)
// a URL de webhook: /api/public/webhooks/ifood?token=SEU_TOKEN
// O token é gerado em /loja/config e deve bater com store_config.ifood_webhook_secret.
//
// IMPORTANTE: se o teste de pedido não estiver chegando, o motivo mais comum é a
// própria iFood não reenviar o parâmetro ?token= do jeito que a gente configurou
// (o campo de URL de alguns portais não aceita query string). Se aparecer no log
// (/loja/logs) uma linha "unauthorized" chegando de verdade — a comunicação está
// OK, só o token que está sendo cortado. Se não aparecer NADA no log, a iFood
// nem está tentando chegar até aqui (aí o problema é configuração do lado deles).

export const Route = createFileRoute("/api/public/webhooks/ifood")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let payload: any = null;
        let rawBody = "";
        try {
          rawBody = await request.text();
          payload = rawBody ? JSON.parse(rawBody) : null;
        } catch { /* corpo pode não ser JSON válido — loga do mesmo jeito abaixo */ }

        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";

        // loga a tentativa SEMPRE, mesmo antes de checar autenticação — é
        // justamente esse o ponto cego que fazia um teste "sumir" sem rastro
        await logApi(supabaseAdmin, {
          source: "ifood_webhook",
          direction: "in",
          request_payload: { url: request.url, has_token_param: !!token, headers: Object.fromEntries(request.headers.entries()), body: payload ?? rawBody?.slice(0, 2000) },
        });

        const { data: cfg } = await supabaseAdmin.from("store_config")
          .select("ifood_webhook_secret").maybeSingle();
        if (!cfg?.ifood_webhook_secret || token !== cfg.ifood_webhook_secret) {
          await logApi(supabaseAdmin, { source: "ifood_webhook", direction: "in", response_status: 401, error_message: "token da URL não bateu com o configurado (ou não veio nenhum token)" });
          return new Response("unauthorized", { status: 401 });
        }

        if (!payload) {
          await logApi(supabaseAdmin, { source: "ifood_webhook", direction: "in", response_status: 400, error_message: "corpo da requisição não é um JSON válido" });
          return new Response("bad json", { status: 400 });
        }

        try {
          const result = await createOrderFromIfoodPayload(supabaseAdmin, payload as IfoodOrderPayload);
          if ("error" in result) {
            await logApi(supabaseAdmin, { source: "ifood_webhook", direction: "in", response_status: 500, error_message: result.error });
            return new Response("db error", { status: 500 });
          }
          await logApi(supabaseAdmin, { source: "ifood_webhook", direction: "in", response_status: 200, response_body: JSON.stringify(result) });
          return Response.json(result);
        } catch (err: any) {
          await logApi(supabaseAdmin, { source: "ifood_webhook", direction: "in", response_status: 500, error_message: String(err?.message ?? err) });
          return new Response("internal error", { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { createOrderFromNfoodPayload, verifyNfoodSignature, type NfoodOrderPayload } from "@/lib/nfood-api.server";
import { logApi } from "@/lib/api-log.server";

// Configure no painel de integração da 99Food (ou no formulário de
// credenciamento Open Delivery) a URL de webhook:
//   /api/public/webhooks/nfood
//
// O padrão Open Delivery assina cada requisição com o header
// "X-App-Signature" (SHA256 do corpo, usando o Client Secret como chave) —
// verificado abaixo. Isso é diferente do esquema da iFood (token na query
// string): não são compatíveis nem compartilham nenhuma configuração.
//
// Se pedidos de teste não chegarem aqui, confira em /loja/logs: se aparecer
// alguma linha "nfood_webhook" com status 401, a 99Food está chegando mas a
// assinatura não bateu (client secret errado em /loja/config); se não
// aparecer NADA, a 99Food nem está tentando chamar essa URL (aí o problema
// é a configuração do lado deles / URL cadastrada errada).

export const Route = createFileRoute("/api/public/webhooks/nfood")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let rawBody = "";
        let payload: any = null;
        try {
          rawBody = await request.text();
          payload = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          /* corpo pode não ser JSON válido — loga do mesmo jeito abaixo */
        }

        const signature = request.headers.get("x-app-signature");

        // loga a tentativa SEMPRE, mesmo antes de checar autenticação — pra
        // nunca ficar sem rastro de um teste que "sumiu"
        await logApi(supabaseAdmin, {
          source: "nfood_webhook",
          direction: "in",
          request_payload: {
            url: request.url,
            has_signature_header: !!signature,
            headers: Object.fromEntries(request.headers.entries()),
            body: payload ?? rawBody?.slice(0, 2000),
          },
        });

        const { data: cfg } = await supabaseAdmin.from("store_config").select("nfood_client_secret").maybeSingle();
        if (!cfg?.nfood_client_secret) {
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 401,
            error_message: "nfood_client_secret não configurado em /loja/config — não dá pra verificar a assinatura",
          });
          return new Response("unauthorized", { status: 401 });
        }
        if (!verifyNfoodSignature(rawBody, signature, cfg.nfood_client_secret)) {
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 401,
            error_message: "X-App-Signature não bateu com o esperado pro client_secret configurado",
          });
          return new Response("unauthorized", { status: 401 });
        }

        if (!payload) {
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 400,
            error_message: "corpo da requisição não é um JSON válido",
          });
          return new Response("bad json", { status: 400 });
        }

        // Eventos que não são "novo pedido" (ex: notificação de autorização,
        // status change vindo de outro fluxo) são só logados e ignorados por
        // enquanto — o essencial pro dia a dia é o evento de pedido novo.
        const eventType = String(payload?.event ?? payload?.type ?? "").toUpperCase();
        if (eventType && !eventType.includes("PLACED") && !eventType.includes("ORDER")) {
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 200,
            response_body: `evento "${eventType}" recebido e ignorado (não é pedido novo)`,
          });
          return Response.json({ ignored: eventType });
        }

        try {
          const orderPayload: NfoodOrderPayload = payload.order ?? payload;
          const result = await createOrderFromNfoodPayload(supabaseAdmin, orderPayload);
          if ("error" in result) {
            await logApi(supabaseAdmin, {
              source: "nfood_webhook",
              direction: "in",
              response_status: 500,
              error_message: result.error,
            });
            return new Response("db error", { status: 500 });
          }
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 200,
            response_body: JSON.stringify(result),
          });
          return Response.json(result);
        } catch (err: any) {
          await logApi(supabaseAdmin, {
            source: "nfood_webhook",
            direction: "in",
            response_status: 500,
            error_message: String(err?.message ?? err),
          });
          return new Response("internal error", { status: 500 });
        }
      },
    },
  },
});

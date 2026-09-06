import { createFileRoute } from "@tanstack/react-router";

const WEBHOOK_VERSION = "HOTBOX_MP_WEBHOOK_V4_20260906";

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      // Diagnóstico simples: permite confirmar no navegador que a rota publicada é a correta.
      GET: async () => {
        return Response.json(
          {
            ok: true,
            service: "hotbox-mercadopago-webhook",
            version: WEBHOOK_VERSION,
            message: "Webhook Mercado Pago online",
          },
          { status: 200 },
        );
      },

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const payload: any = await request.json().catch(() => ({}));

        const eventType = String(
          payload?.type ||
          url.searchParams.get("type") ||
          "",
        ).toLowerCase();

        const action = String(payload?.action || "");

        /*
         * A aplicação Mercado Pago criada como Orders API pode enviar/simular
         * eventos type=order / action=order.processed.
         *
         * A HotBox atualmente CRIA pagamentos pela API legacy /v1/payments.
         * Portanto um data.id de Order NÃO pode ser consultado em /v1/payments.
         *
         * Para eventos "order" não fazemos nenhuma mutação e devolvemos 200,
         * evitando o 503 incorreto do código antigo.
         */
        if (eventType === "order" || action.startsWith("order.")) {
          console.info("[mercadopago-webhook]", WEBHOOK_VERSION, "order recebida", {
            action,
            orderId: String(payload?.data?.id || ""),
          });

          return Response.json(
            {
              ok: true,
              received: true,
              ignored: true,
              reason: "order_event_not_used_by_current_payments_api_flow",
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        // A partir daqui tratamos somente notificações da API de Payments.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          loadMercadoPagoConfig,
          storeMercadoPagoSnapshot,
          finalizeIfApproved,
        } = await import("@/lib/mercadopago.functions");

        const cfg = await loadMercadoPagoConfig(supabaseAdmin);
        const token = url.searchParams.get("token") || "";

        // Token próprio da HotBox na URL + confirmação servidor-servidor.
        if (!cfg.accessToken || !cfg.webhookToken || token !== cfg.webhookToken) {
          console.warn("[mercadopago-webhook]", WEBHOOK_VERSION, "token inválido");
          return Response.json(
            { ok: false, error: "unauthorized", version: WEBHOOK_VERSION },
            { status: 401 },
          );
        }

        const paymentId = String(
          payload?.data?.id ||
          payload?.id ||
          url.searchParams.get("data.id") ||
          "",
        ).trim();

        if (!paymentId) {
          return Response.json(
            {
              ok: true,
              ignored: true,
              reason: "payment_id_missing",
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        let verify: Response;
        try {
          verify = await fetch(
            `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
            {
              headers: {
                Authorization: `Bearer ${cfg.accessToken}`,
              },
            },
          );
        } catch (error) {
          console.error("[mercadopago-webhook]", WEBHOOK_VERSION, "falha de rede ao consultar payment", error);
          return Response.json(
            { ok: false, retry: true, version: WEBHOOK_VERSION },
            { status: 503 },
          );
        }

        const payment: any = await verify.json().catch(() => ({}));

        if (!verify.ok || !payment?.id) {
          console.error("[mercadopago-webhook]", WEBHOOK_VERSION, "payment não encontrado", {
            paymentId,
            status: verify.status,
          });

          /*
           * O Mercado Pago espera 200/201 para acusar recebimento do webhook.
           * Se o ID não corresponde a um payment válido, não há nada seguro
           * para finalizar. Respondemos 200 e registramos o caso no log.
           */
          return Response.json(
            {
              ok: true,
              received: true,
              ignored: true,
              reason: "payment_not_found",
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        const checkoutId = String(
          payment?.external_reference ||
          payment?.metadata?.checkout_id ||
          "",
        ).trim();

        if (!checkoutId) {
          return Response.json(
            {
              ok: true,
              ignored: true,
              reason: "checkout_reference_missing",
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        const { data: checkout } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", checkoutId)
          .maybeSingle();

        if (!checkout || checkout.payment_provider !== "mercadopago") {
          return Response.json(
            {
              ok: true,
              ignored: true,
              reason: "checkout_not_found_or_wrong_provider",
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        await storeMercadoPagoSnapshot(
          supabaseAdmin,
          checkout.id,
          payment,
          payload,
        );

        const result = await finalizeIfApproved(
          supabaseAdmin,
          checkout,
          payment,
          async (orderId: string) => {
            const { notifyPaidSiteOrder } = await import(
              "@/lib/site-checkout-notify.server"
            );
            await notifyPaidSiteOrder(supabaseAdmin, orderId);
          },
        );

        if (!result.ok && !result.pending) {
          console.error(
            "[mercadopago-webhook]",
            WEBHOOK_VERSION,
            "falha de validação/finalização",
            result,
          );

          return Response.json(
            {
              ok: true,
              received: true,
              processed: false,
              validation_error: true,
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        return Response.json(
          {
            ok: true,
            received: true,
            processed: true,
            version: WEBHOOK_VERSION,
          },
          { status: 200 },
        );
      },
    },
  },
});

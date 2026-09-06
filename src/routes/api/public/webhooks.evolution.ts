import { createFileRoute } from "@tanstack/react-router";

const WEBHOOK_VERSION = "HOTBOX_MP_WEBHOOK_V3_20260906";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "x-hotbox-webhook-version": WEBHOOK_VERSION,
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      // Diagnóstico público: permite confirmar no navegador que o domínio
      // está realmente apontando para ESTE deploy/arquivo.
      GET: async () => {
        return json({
          ok: true,
          service: "hotbox-mercadopago-webhook",
          version: WEBHOOK_VERSION,
          message: "Webhook Mercado Pago online",
        });
      },

      HEAD: async () => {
        return new Response(null, {
          status: 200,
          headers: {
            "x-hotbox-webhook-version": WEBHOOK_VERSION,
            "cache-control": "no-store",
          },
        });
      },

      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "allow": "GET, HEAD, POST, OPTIONS",
            "x-hotbox-webhook-version": WEBHOOK_VERSION,
          },
        });
      },

      POST: async ({ request }) => {
        const receivedAt = new Date().toISOString();
        let payload: any = {};

        try {
          const raw = await request.text();
          payload = raw ? JSON.parse(raw) : {};
        } catch (error) {
          console.error("[mercadopago-webhook-v3] payload inválido", error);
          // Webhooks devem ser reconhecidos rapidamente. Payload inválido não
          // deve derrubar o serviço nem produzir 503 do Railway.
          return json({ ok: true, ignored: true, reason: "invalid_json", version: WEBHOOK_VERSION });
        }

        const eventType = String(payload?.type || "").trim().toLowerCase();
        const action = String(payload?.action || "").trim().toLowerCase();

        console.log("[mercadopago-webhook-v3] recebido", {
          version: WEBHOOK_VERSION,
          receivedAt,
          type: eventType,
          action,
          dataId: payload?.data?.id || null,
        });

        // A aplicação criada no painel do Mercado Pago está enviando eventos
        // da Orders API. O projeto HotBox atual ainda cria pagamentos pela
        // API /v1/payments; portanto, eventos de Order são reconhecidos com
        // HTTP 200 e não são enviados para /v1/payments.
        if (eventType === "order" || action.startsWith("order.")) {
          return json({
            ok: true,
            received: true,
            ignored: true,
            event_type: eventType,
            action,
            reason: "orders_event_acknowledged",
            version: WEBHOOK_VERSION,
          });
        }

        // Eventos Payment do fluxo atualmente usado pelo checkout HotBox.
        if (eventType && eventType !== "payment" && !action.startsWith("payment.")) {
          return json({
            ok: true,
            received: true,
            ignored: true,
            reason: "unsupported_event_type",
            version: WEBHOOK_VERSION,
          });
        }

        const url = new URL(request.url);

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const {
          loadMercadoPagoConfig,
          storeMercadoPagoSnapshot,
          finalizeIfApproved,
        } = await import("@/lib/mercadopago.functions");

        const cfg = await loadMercadoPagoConfig(supabaseAdmin);
        const token = url.searchParams.get("token") || "";

        if (!cfg.accessToken || !cfg.webhookToken || token !== cfg.webhookToken) {
          console.warn("[mercadopago-webhook-v3] payment webhook não autorizado", {
            hasAccessToken: Boolean(cfg.accessToken),
            hasWebhookToken: Boolean(cfg.webhookToken),
            hasUrlToken: Boolean(token),
          });
          return json({ ok: false, error: "unauthorized", version: WEBHOOK_VERSION }, 401);
        }

        const paymentId = String(
          payload?.data?.id ||
            payload?.id ||
            url.searchParams.get("data.id") ||
            "",
        ).trim();

        if (!paymentId) {
          return json({ ok: true, ignored: true, reason: "missing_payment_id", version: WEBHOOK_VERSION });
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
          console.error("[mercadopago-webhook-v3] erro de rede ao consultar payment", error);
          return json({ ok: false, retry: true, stage: "payment_fetch", version: WEBHOOK_VERSION }, 503);
        }

        const payment: any = await verify.json().catch(() => ({}));

        if (!verify.ok || !payment?.id) {
          console.error("[mercadopago-webhook-v3] payment não validado", {
            paymentId,
            mercadoPagoStatus: verify.status,
          });
          return json({ ok: false, retry: true, stage: "payment_verify", version: WEBHOOK_VERSION }, 503);
        }

        const checkoutId = String(
          payment?.external_reference || payment?.metadata?.checkout_id || "",
        ).trim();

        if (!checkoutId) {
          return json({ ok: true, ignored: true, reason: "missing_checkout_reference", version: WEBHOOK_VERSION });
        }

        const { data: checkout } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", checkoutId)
          .maybeSingle();

        if (!checkout || checkout.payment_provider !== "mercadopago") {
          return json({ ok: true, ignored: true, reason: "checkout_not_applicable", version: WEBHOOK_VERSION });
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
          console.error("[mercadopago-webhook-v3] falha de finalização", result);
          return json({ ok: false, retry: true, version: WEBHOOK_VERSION }, 409);
        }

        return json({ ok: true, version: WEBHOOK_VERSION });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);

        // Leia o payload ANTES de carregar configuração/banco.
        // O simulador atual do Mercado Pago está enviando eventos da Orders API
        // mesmo quando a integração da HotBox usa a API clássica de Payments.
        const payload: any = await request.json().catch(() => ({}));
        const eventType = String(payload?.type || "").trim().toLowerCase();
        const action = String(payload?.action || "").trim().toLowerCase();

        // A HotBox atual processa pagamentos pela API /v1/payments.
        // Eventos order.* não devem ser consultados em /v1/payments porque
        // data.id é um ORDER ID, não um PAYMENT ID. Apenas acusamos recebimento.
        if (eventType === "order" || action.startsWith("order.")) {
          console.log("[mercadopago-webhook] order ignorada com 200", {
            type: eventType,
            action,
            orderId: payload?.data?.id || null,
          });

          return Response.json(
            {
              ok: true,
              ignored: true,
              reason: "order_event_not_used_by_payments_api",
            },
            { status: 200 },
          );
        }

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

        // Para eventos de pagamento reais, mantém a proteção por token.
        if (!cfg.accessToken || !cfg.webhookToken || token !== cfg.webhookToken) {
          return Response.json({ ok: false }, { status: 401 });
        }

        const paymentId = String(
          payload?.data?.id ||
            payload?.id ||
            url.searchParams.get("data.id") ||
            "",
        ).trim();

        if (!paymentId) {
          return Response.json({ ok: true, ignored: true }, { status: 200 });
        }

        let verify: Response;

        try {
          verify = await fetch(
            `https://api.mercadopago.com/v1/payments/${encodeURIComponent(
              paymentId,
            )}`,
            {
              headers: {
                Authorization: `Bearer ${cfg.accessToken}`,
              },
            },
          );
        } catch (error) {
          console.error(
            "[mercadopago-webhook] erro de rede ao consultar pagamento",
            error,
          );
          return Response.json(
            { ok: false, retry: true, stage: "payment_fetch" },
            { status: 503 },
          );
        }

        const payment: any = await verify.json().catch(() => ({}));

        if (!verify.ok || !payment?.id) {
          console.error(
            "[mercadopago-webhook] pagamento não localizado/validado",
            {
              paymentId,
              status: verify.status,
              response: payment,
            },
          );

          return Response.json(
            { ok: false, retry: true, stage: "payment_verify" },
            { status: 503 },
          );
        }

        const checkoutId = String(
          payment?.external_reference || payment?.metadata?.checkout_id || "",
        ).trim();

        if (!checkoutId) {
          return Response.json({ ok: true, ignored: true }, { status: 200 });
        }

        const { data: checkout } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", checkoutId)
          .maybeSingle();

        if (!checkout || checkout.payment_provider !== "mercadopago") {
          return Response.json({ ok: true, ignored: true }, { status: 200 });
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
            "[mercadopago-webhook] falha de validação/finalização",
            result,
          );
          return Response.json(
            { ok: false, retry: true },
            { status: 409 },
          );
        }

        return Response.json({ ok: true }, { status: 200 });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { logApi } = await import("@/lib/api-log.server");
        const { loadStripeConfig } = await import("@/lib/stripe.functions");
        const { activatePaidSiteOrder } = await import("@/lib/site-payment.server");
        const { notifyPaidSiteOrder } = await import("@/lib/site-checkout.functions");
        const cfg = await loadStripeConfig(supabaseAdmin);

        if (!cfg.enabled || !cfg.secretKey || !cfg.webhookSecret) {
          await logApi(supabaseAdmin, {
            source: "stripe_webhook",
            direction: "in",
            response_status: 500,
            error_message: "Stripe desativado ou credenciais incompletas em store_config",
          });
          return new Response("stripe not configured", { status: 500 });
        }

        const sig = request.headers.get("stripe-signature");
        if (!sig) return new Response("missing signature", { status: 400 });
        const body = await request.text();
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(cfg.secretKey);

        let event: any;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, cfg.webhookSecret);
        } catch (e: any) {
          await logApi(supabaseAdmin, {
            source: "stripe_webhook",
            direction: "in",
            response_status: 400,
            error_message: `assinatura inválida: ${e.message}`,
          });
          return new Response(`bad signature: ${e.message}`, { status: 400 });
        }

        const successEvents = new Set([
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ]);

        if (successEvents.has(event.type)) {
          const session = event.data.object as any;
          const checkoutId = session?.metadata?.checkout_id as string | undefined;
          const legacyOrderId = session?.metadata?.order_id as string | undefined;
          const isPaid = session.payment_status === "paid" || event.type === "checkout.session.async_payment_succeeded";

          if (checkoutId && isPaid) {
            const { data: checkout } = await (supabaseAdmin as any)
              .from("site_checkout_sessions")
              .select("id,total,order_id,status,payment_kind")
              .eq("id", checkoutId)
              .maybeSingle();
            if (!checkout) return new Response("checkout not found", { status: 404 });

            const expectedCents = Math.round(Number(checkout.total) * 100);
            const paidCents = Number(session.amount_total ?? 0);
            const currencyOk = String(session.currency || "").toLowerCase() === "brl";
            if (!currencyOk || paidCents !== expectedCents) {
              await logApi(supabaseAdmin, {
                source: "stripe_webhook",
                direction: "in",
                request_payload: { event_type: event.type, checkout_id: checkoutId, paid_cents: paidCents, expected_cents: expectedCents, currency: session.currency },
                response_status: 409,
                error_message: "Valor/moeda do Stripe não confere com o checkout Hotbox",
              });
              return new Response("amount mismatch", { status: 409 });
            }

            const providerRef = String(session.payment_intent || session.id || "");
            const { data: finalized, error: finalizeError } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
              p_checkout_id: checkoutId,
              p_confirmed_by: "stripe",
              p_provider_ref: providerRef,
              p_stripe_session_id: session.id,
            });
            if (finalizeError || !finalized?.ok) {
              await logApi(supabaseAdmin, {
                source: "stripe_webhook",
                direction: "in",
                request_payload: { event_type: event.type, checkout_id: checkoutId },
                response_status: 500,
                error_message: finalizeError?.message || finalized?.error || "Falha ao gerar pedido após pagamento",
              });
              return new Response("finalization failed", { status: 500 });
            }

            if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin, finalized.order_id);
            await logApi(supabaseAdmin, {
              source: "stripe_webhook",
              direction: "in",
              request_payload: { event_type: event.type, checkout_id: checkoutId, order_id: finalized.order_id, payment_kind: checkout.payment_kind },
              response_status: 200,
            });
          } else if (legacyOrderId && isPaid) {
            // Compatibilidade com checkouts antigos. Não muda o fluxo de pedidos do WhatsApp/manual.
            const result = await activatePaidSiteOrder(supabaseAdmin, legacyOrderId, "stripe", session.payment_intent || session.id);
            if (!result.ok) return new Response(result.error || "activation failed", { status: 500 });
          }
        }

        if (event.type === "payment_intent.succeeded") {
          const pi = event.data.object as any;
          const checkoutId = pi?.metadata?.checkout_id as string | undefined;
          if (checkoutId) {
            const { data: checkout } = await (supabaseAdmin as any)
              .from("site_checkout_sessions")
              .select("id,total,order_id,payment_kind")
              .eq("id", checkoutId)
              .maybeSingle();
            if (checkout && !checkout.order_id) {
              const expectedCents = Math.round(Number(checkout.total) * 100);
              const paidCents = Number(pi.amount_received ?? pi.amount ?? 0);
              if (String(pi.currency || "").toLowerCase() === "brl" && paidCents === expectedCents) {
                const { data: finalized, error: finalizeError } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
                  p_checkout_id: checkoutId,
                  p_confirmed_by: "stripe",
                  p_provider_ref: String(pi.id || ""),
                  p_stripe_session_id: null,
                });
                if (finalizeError || !finalized?.ok) return new Response("finalization failed", { status: 500 });
                if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin, finalized.order_id);
              }
            }
          }
        }

        if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
          const session = event.data.object as any;
          const checkoutId = session?.metadata?.checkout_id as string | undefined;
          if (checkoutId) {
            await (supabaseAdmin as any)
              .from("site_checkout_sessions")
              .update({ status: event.type === "checkout.session.expired" ? "expired" : "payment_failed", updated_at: new Date().toISOString() })
              .eq("id", checkoutId)
              .is("order_id", null);
          }
        }

        if (event.type === "payment_intent.payment_failed") {
          const pi = event.data.object as any;
          const checkoutId = pi?.metadata?.checkout_id as string | undefined;
          if (checkoutId) {
            await (supabaseAdmin as any)
              .from("site_checkout_sessions")
              .update({ status: "payment_failed", updated_at: new Date().toISOString() })
              .eq("id", checkoutId)
              .is("order_id", null);
          }
        }

        return new Response("ok");
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

const WEBHOOK_VERSION = "HOTBOX_MP_ORDERS_V5_20260906";

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, service: "hotbox-mercadopago-webhook", version: WEBHOOK_VERSION, mode: "orders-api" }),
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const payload: any = await request.json().catch(() => ({}));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadMercadoPagoConfig, fetchMercadoPagoOrder, storeMercadoPagoSnapshot, finalizeIfApproved } = await import("@/lib/mercadopago.functions");
        const cfg = await loadMercadoPagoConfig(supabaseAdmin);
        const token = url.searchParams.get("token") || "";

        if (!cfg.accessToken || !cfg.webhookToken || token !== cfg.webhookToken) {
          return Response.json({ ok: false, error: "unauthorized", version: WEBHOOK_VERSION }, { status: 401 });
        }

        const eventType = String(payload?.type || url.searchParams.get("type") || "").toLowerCase();
        const action = String(payload?.action || "");
        const orderId = String(payload?.data?.id || url.searchParams.get("data.id") || "").trim();

        if (eventType !== "order" && !action.startsWith("order.")) {
          return Response.json({ ok: true, ignored: true, reason: "not_order_event", version: WEBHOOK_VERSION }, { status: 200 });
        }
        if (!orderId) return Response.json({ ok: true, ignored: true, reason: "order_id_missing", version: WEBHOOK_VERSION }, { status: 200 });

        // O simulador do painel pode enviar um ID fictício como "123456". Confirmamos o recebimento sem tentar tratá-lo como order real.
        if (!/^ORD/i.test(orderId)) {
          console.info("[mercadopago-webhook] teste/simulação recebido", { action, orderId });
          return Response.json({ ok: true, simulated: true, version: WEBHOOK_VERSION }, { status: 200 });
        }

        const verified = await fetchMercadoPagoOrder(cfg.accessToken, orderId);
        if (!verified.response.ok) {
          if ([400, 404].includes(Number(verified.response.status))) {
            console.warn("[mercadopago-webhook] order inválida/não encontrada", { orderId, status: verified.response.status });
            return Response.json({ ok: true, ignored: true, reason: "order_not_found", version: WEBHOOK_VERSION }, { status: 200 });
          }
          return Response.json({ ok: false, retry: true, version: WEBHOOK_VERSION }, { status: 503 });
        }

        const order = verified.body;
        const checkoutId = String(order?.external_reference || "").trim();
        if (!checkoutId) return Response.json({ ok: true, ignored: true, reason: "checkout_reference_missing", version: WEBHOOK_VERSION }, { status: 200 });

        const { data: checkout, error } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", checkoutId)
          .maybeSingle();
        if (error) return Response.json({ ok: false, retry: true, version: WEBHOOK_VERSION }, { status: 503 });
        if (!checkout || checkout.payment_provider !== "mercadopago") return Response.json({ ok: true, ignored: true, reason: "checkout_not_found_or_wrong_provider", version: WEBHOOK_VERSION }, { status: 200 });

        await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, order, payload);

        // Reconciliamos também estornos que tenham mudado de processing -> processed.
        const providerRefunds = Array.isArray(order?.transactions?.refunds) ? order.transactions.refunds : [];
        if (providerRefunds.length) {
          const { data: localRefunds } = await (supabaseAdmin as any)
            .from("mercadopago_refunds")
            .select("id,mercadopago_refund_id,mercadopago_transaction_id,amount,status")
            .eq("checkout_id", checkout.id)
            .in("status", ["requested", "processing", "processed"]);
          for (const providerRefund of providerRefunds) {
            const providerRefundId = String(providerRefund?.id || "");
            const providerTxId = String(providerRefund?.transaction_id || "");
            const providerAmount = Number(providerRefund?.amount || 0);
            const local = (localRefunds || []).find((r: any) =>
              (providerRefundId && String(r.mercadopago_refund_id || "") === providerRefundId) ||
              (!r.mercadopago_refund_id && String(r.mercadopago_transaction_id || "") === providerTxId && Number(r.amount || 0) === providerAmount)
            );
            if (local?.id) {
              await (supabaseAdmin as any).rpc("finalize_mercadopago_refund", {
                p_refund_log_id: local.id,
                p_provider_refund_id: providerRefundId,
                p_provider_status: String(providerRefund?.status || order?.status_detail || order?.status || "processing"),
                p_response_payload: order,
              });
            }
          }
        }

        const result = await finalizeIfApproved(supabaseAdmin, checkout, order, async (orderDbId: string) => {
          const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
          await notifyPaidSiteOrder(supabaseAdmin, orderDbId);
        });

        if (!result.ok && (result as any).transient) {
          console.error("[mercadopago-webhook] falha temporária ao finalizar", result);
          return Response.json({ ok: false, retry: true, version: WEBHOOK_VERSION }, { status: 503 });
        }
        if (!result.ok && (result as any).validation) {
          console.error("[mercadopago-webhook] validação recusou a order", result);
          return Response.json({ ok: true, received: true, validation_error: true, version: WEBHOOK_VERSION }, { status: 200 });
        }

        return Response.json({ ok: true, received: true, processed: !!result.ok, version: WEBHOOK_VERSION }, { status: 200 });
      },
    },
  },
});

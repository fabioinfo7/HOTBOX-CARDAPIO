import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/pagarme")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadPagarmeConfig, storePagarmeSnapshot, finalizePagarmeIfPaid } = await import("@/lib/pagarme.functions");
        const cfg = await loadPagarmeConfig(supabaseAdmin);
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        if (!cfg.secretKey || !cfg.webhookToken || token !== cfg.webhookToken) {
          return Response.json({ ok: false }, { status: 401 });
        }

        const payload: any = await request.json().catch(() => ({}));
        const eventType = String(payload?.type || "");
        if (!["order.paid", "order.payment_failed", "charge.paid", "charge.payment_failed", "charge.pending", "order.updated"].includes(eventType)) {
          return Response.json({ ok: true, ignored: true });
        }

        const data = payload?.data || {};
        const orderId = String(data?.id || data?.order?.id || data?.order_id || "").trim();
        const checkoutCode = String(data?.code || data?.order?.code || data?.metadata?.checkout_id || "").trim();
        if (!orderId && !checkoutCode) return Response.json({ ok: true, ignored: true });

        let checkout: any = null;
        if (checkoutCode) {
          const result = await (supabaseAdmin as any)
            .from("site_checkout_sessions")
            .select("id,total,order_id,payment_provider,pagarme_order_id")
            .eq("id", checkoutCode)
            .maybeSingle();
          checkout = result.data;
        }
        if (!checkout && orderId) {
          const result = await (supabaseAdmin as any)
            .from("site_checkout_sessions")
            .select("id,total,order_id,payment_provider,pagarme_order_id")
            .eq("pagarme_order_id", orderId)
            .maybeSingle();
          checkout = result.data;
        }
        if (!checkout || checkout.payment_provider !== "pagarme") return Response.json({ ok: true, ignored: true });

        const targetOrderId = orderId || String(checkout.pagarme_order_id || "");
        if (!targetOrderId) return Response.json({ ok: true, ignored: true });
        const auth = `Basic ${btoa(`${cfg.secretKey}:`)}`;
        let verify: Response;
        try {
          verify = await fetch(`https://api.pagar.me/core/v5/orders/${encodeURIComponent(targetOrderId)}`, {
            headers: { Authorization: auth, "User-Agent": "hotbox-delivery/1.0" },
          });
        } catch {
          return Response.json({ ok: false, retry: true }, { status: 503 });
        }
        const order: any = await verify.json().catch(() => ({}));
        if (!verify.ok || !order?.id) return Response.json({ ok: false, retry: true }, { status: 503 });

        await storePagarmeSnapshot(supabaseAdmin, checkout.id, order, payload);
        const result = await finalizePagarmeIfPaid(supabaseAdmin, checkout, order, async (orderIdFinal: string) => {
          const { notifyPaidSiteOrder } = await import("@/lib/site-checkout-notify.server");
          await notifyPaidSiteOrder(supabaseAdmin, orderIdFinal);
        });
        if (!result.ok && !result.pending && !result.rejected) {
          return Response.json({ ok: false, retry: true }, { status: 409 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});

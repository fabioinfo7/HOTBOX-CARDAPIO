import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadMercadoPagoConfig, storeMercadoPagoSnapshot, finalizeIfApproved } = await import("@/lib/mercadopago.functions");
        const cfg = await loadMercadoPagoConfig(supabaseAdmin);
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";

        // Token próprio da HotBox na URL + consulta servidor-servidor do pagamento.
        // O payload do webhook nunca é usado sozinho para liberar pedido.
        if (!cfg.accessToken || !cfg.webhookToken || token !== cfg.webhookToken) {
          return Response.json({ ok: false }, { status: 401 });
        }

        const payload: any = await request.json().catch(() => ({}));
        const paymentId = String(payload?.data?.id || payload?.id || url.searchParams.get("data.id") || "").trim();
        if (!paymentId) return Response.json({ ok: true, ignored: true });

        let verify: Response;
        try {
          verify = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
            headers: { Authorization: `Bearer ${cfg.accessToken}` },
          });
        } catch {
          return Response.json({ ok: false, retry: true }, { status: 503 });
        }
        const payment: any = await verify.json().catch(() => ({}));
        if (!verify.ok || !payment?.id) return Response.json({ ok: false, retry: true }, { status: 503 });

        const checkoutId = String(payment?.external_reference || payment?.metadata?.checkout_id || "").trim();
        if (!checkoutId) return Response.json({ ok: true, ignored: true });

        const { data: checkout } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", checkoutId)
          .maybeSingle();
        if (!checkout || checkout.payment_provider !== "mercadopago") return Response.json({ ok: true, ignored: true });

        await storeMercadoPagoSnapshot(supabaseAdmin, checkout.id, payment, payload);
        const result = await finalizeIfApproved(supabaseAdmin, checkout, payment);
        if (!result.ok && !result.pending) {
          console.error("[mercadopago-webhook] falha de validação/finalização", result);
          return Response.json({ ok: false, retry: true }, { status: 409 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});

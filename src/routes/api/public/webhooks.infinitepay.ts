import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/infinitepay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadInfinitePayConfig } = await import("@/lib/infinitepay.functions");
        const cfg = await loadInfinitePayConfig(supabaseAdmin);
        const token = new URL(request.url).searchParams.get("token") || "";
        if (!cfg.handle || !cfg.webhookToken || token !== cfg.webhookToken) {
          return Response.json({ success: false, message: "unauthorized" }, { status: 400 });
        }

        const payload: any = await request.json().catch(() => null);
        if (!payload?.order_nsu || !payload?.transaction_nsu || !payload?.invoice_slug) {
          return Response.json({ success: false, message: "Pedido não encontrado" }, { status: 400 });
        }

        const { data: checkout } = await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .select("id,total,order_id,payment_provider")
          .eq("id", String(payload.order_nsu))
          .maybeSingle();
        if (!checkout) return Response.json({ success: false, message: "Pedido não encontrado" }, { status: 400 });
        if (checkout.payment_provider && checkout.payment_provider !== "infinitepay") return Response.json({ success: true, message: null });
        const alreadyCreated = Boolean(checkout.order_id);

        const verify = await fetch("https://api.checkout.infinitepay.io/payment_check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            handle: cfg.handle,
            order_nsu: String(payload.order_nsu),
            transaction_nsu: String(payload.transaction_nsu),
            slug: String(payload.invoice_slug),
          }),
        });
        const checked: any = await verify.json().catch(() => ({}));
        const expected = Math.round(Number(checkout.total) * 100);
        if (!verify.ok || checked?.success !== true || checked?.paid !== true || Number(checked?.amount) !== expected) {
          return Response.json({ success: false, message: "Pagamento não confirmado" }, { status: 400 });
        }

        const captureMethod = String(checked.capture_method || payload.capture_method || "");
        const paymentKind = captureMethod === "pix" ? "infinitepay_pix" : "infinitepay_card";
        await (supabaseAdmin as any)
          .from("site_checkout_sessions")
          .update({
            payment_kind: paymentKind,
            infinitepay_transaction_nsu: String(payload.transaction_nsu),
            infinitepay_invoice_slug: String(payload.invoice_slug),
            infinitepay_receipt_url: payload.receipt_url ? String(payload.receipt_url) : null,
            infinitepay_amount_cents: Number(checked.amount ?? payload.amount ?? expected),
            infinitepay_paid_amount_cents: Number(checked.paid_amount ?? payload.paid_amount ?? checked.amount ?? payload.amount ?? expected),
            infinitepay_installments: Math.max(1, Number(checked.installments ?? payload.installments ?? 1)),
            infinitepay_capture_method: captureMethod || null,
            infinitepay_verified_at: new Date().toISOString(),
            infinitepay_webhook_payload: payload,
            infinitepay_verification_payload: checked,
            updated_at: new Date().toISOString(),
          })
          .eq("id", checkout.id);

        if (alreadyCreated) {
          return Response.json({ success: true, message: null });
        }

        const { data: finalized, error } = await (supabaseAdmin as any).rpc("finalize_site_checkout_paid", {
          p_checkout_id: checkout.id,
          p_confirmed_by: "infinitepay",
          p_provider_ref: String(payload.transaction_nsu),
          p_stripe_session_id: null,
        });
        if (error || !finalized?.ok) {
          return Response.json({ success: false, message: error?.message || finalized?.error || "Falha ao gerar pedido" }, { status: 400 });
        }

        try {
          const { notifyPaidSiteOrder } = await import("@/lib/site-checkout.functions");
          if (finalized.order_id) await notifyPaidSiteOrder(supabaseAdmin, finalized.order_id);
        } catch (e) {
          console.error("[infinitepay] pedido criado, aviso WhatsApp falhou", e);
        }

        return Response.json({ success: true, message: null });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/efi")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { processEfiWebhook, processEfiChargeNotification } = await import("@/lib/efi.functions");
          const url = new URL(request.url);
          const webhookToken = String(url.searchParams.get("token") || "");
          const contentType = request.headers.get("content-type") || "";
          let payload: any = {};
          if (contentType.includes("application/json")) payload = await request.json().catch(() => ({}));
          else {
            const raw = await request.text();
            const params = new URLSearchParams(raw);
            payload = Object.fromEntries(params.entries());
          }
          if (Array.isArray(payload?.pix)) {
            const result = await processEfiWebhook(supabaseAdmin, payload, webhookToken);
            return Response.json(result, { status: result.unauthorized ? 401 : 200 });
          }
          const notificationToken = String(payload?.notification || payload?.token || "");
          if (notificationToken) {
            const result = await processEfiChargeNotification(supabaseAdmin, notificationToken, webhookToken);
            return Response.json(result, { status: result.unauthorized ? 401 : 200 });
          }
          return Response.json({ ok: true, ignored: true });
        } catch (error) {
          console.error("[efi-webhook]", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});

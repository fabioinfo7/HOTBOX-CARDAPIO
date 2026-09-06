import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > 35_000) return Response.json({ ok: false }, { status: 413 });
          const payload = await request.json().catch(() => null);
          if (!payload || typeof payload !== "object") return Response.json({ ok: false }, { status: 400 });
          const eventName = String((payload as any).event_name || "").trim();
          const sessionId = String((payload as any).session_id || "").trim();
          const visitorId = String((payload as any).visitor_id || "").trim();
          if (!eventName || eventName.length > 80 || !sessionId || sessionId.length > 100 || !visitorId || visitorId.length > 100) {
            return Response.json({ ok: false }, { status: 400 });
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await (supabaseAdmin as any).rpc("record_analytics_event", { p_event: payload });
          if (error) {
            console.error("[analytics] falha ao registrar evento", error);
            return Response.json({ ok: false }, { status: 500 });
          }
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[analytics] erro inesperado", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});

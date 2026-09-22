import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_ORIGINS = ["*"];
const MAX_BODY_BYTES = 48_000;

function corsHeaders(origin: string | null) {
  const allowOrigin = ALLOWED_ORIGINS.includes("*") ? "*" : origin || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-analise-site-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function safeString(value: unknown, max = 5000) {
  return String(value ?? "").slice(0, max);
}

function safeObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > 24_000) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/public/analise/collect")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) }),
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const headers = corsHeaders(origin);

        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > MAX_BODY_BYTES) return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });

          const body = await request.json();
          const siteKey = safeString(body?.site_key, 160);
          const sessionId = safeString(body?.session_id, 160);
          const visitorId = safeString(body?.visitor_id, 160);
          const eventName = safeString(body?.event_name, 80) || "unknown";
          const pageUrl = safeString(body?.page_url, 4000);
          const pagePath = safeString(body?.page_path, 2000);
          const pageTitle = safeString(body?.page_title, 500);
          const eventData = safeObject(body?.event_data);
          const utm = safeObject(body?.utm);
          const device = safeObject(body?.device);

          if (!siteKey || !sessionId || !visitorId) {
            return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("analytics_pro_collect", {
            p_site_key: siteKey,
            p_session_id: sessionId,
            p_visitor_id: visitorId,
            p_event_name: eventName,
            p_page_url: pageUrl || null,
            p_page_path: pagePath || null,
            p_page_title: pageTitle || null,
            p_event_data: eventData,
            p_utm: utm,
            p_device: device,
            p_at: new Date().toISOString(),
          });

          if (error) {
            console.error("[analise-pro] collector", error.message);
            return Response.json({ ok: false, error: "collector_failed" }, { status: 500, headers });
          }

          return Response.json(data || { ok: true }, { status: 200, headers });
        } catch (error) {
          console.error("[analise-pro] invalid request", error);
          return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers });
        }
      },
    },
  },
});

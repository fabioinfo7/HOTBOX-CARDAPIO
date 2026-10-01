import { createFileRoute } from "@tanstack/react-router";

const PRESENCE_WINDOW_SECONDS = 30;

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function str(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

async function resolveSite(siteKey: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("analytics_pro_sites")
    .select("id")
    .eq("site_key", siteKey)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export const Route = createFileRoute("/api/public/analise/realtime")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: headers() }),

      GET: async ({ request }) => {
        const responseHeaders = headers();
        const url = new URL(request.url);
        const siteKey = str(url.searchParams.get("site_key"), 160);

        if (!siteKey) {
          return Response.json({ ok: false, error: "missing_site_key" }, { status: 400, headers: responseHeaders });
        }

        try {
          const siteId = await resolveSite(siteKey);
          if (!siteId) {
            return Response.json({ ok: false, error: "invalid_site" }, { status: 404, headers: responseHeaders });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const cutoff = new Date(Date.now() - PRESENCE_WINDOW_SECONDS * 1000).toISOString();

          const { count, error } = await supabaseAdmin
            .from("analytics_pro_sessions")
            .select("id", { count: "exact", head: true })
            .eq("site_id", siteId)
            .gte("last_seen_at", cutoff);

          if (error) throw error;

          return Response.json(
            {
              ok: true,
              active_visitors: count ?? 0,
              window_seconds: PRESENCE_WINDOW_SECONDS,
              server_time: new Date().toISOString(),
            },
            { status: 200, headers: responseHeaders },
          );
        } catch (error) {
          console.error("[AnalisePro] realtime GET", error);
          return Response.json({ ok: false, error: "realtime_failed" }, { status: 500, headers: responseHeaders });
        }
      },

      POST: async ({ request }) => {
        const responseHeaders = headers();

        try {
          const length = Number(request.headers.get("content-length") || 0);
          if (length > 8_000) {
            return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers: responseHeaders });
          }

          const body = await request.json();
          const siteKey = str(body?.site_key, 160);
          const sessionId = str(body?.session_id, 160);
          const visitorId = str(body?.visitor_id, 160);
          const pagePath = str(body?.page_path, 500) || "/";
          const pageTitle = str(body?.page_title, 500);

          if (!siteKey || !sessionId || !visitorId) {
            return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers: responseHeaders });
          }

          const siteId = await resolveSite(siteKey);
          if (!siteId) {
            return Response.json({ ok: false, error: "invalid_site" }, { status: 404, headers: responseHeaders });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const now = new Date().toISOString();

          const { data: updated, error: updateError } = await supabaseAdmin
            .from("analytics_pro_sessions")
            .update({
              last_seen_at: now,
            })
            .eq("id", sessionId)
            .eq("site_id", siteId)
            .eq("visitor_id", visitorId)
            .select("id")
            .maybeSingle();

          if (updateError) throw updateError;

          if (!updated) {
            const { error: insertError } = await supabaseAdmin
              .from("analytics_pro_sessions")
              .insert({
                id: sessionId,
                site_id: siteId,
                visitor_id: visitorId,
                first_seen_at: now,
                last_seen_at: now,
                entry_path: pagePath,
                entry_url: null,
                landing_referrer: null,
                pageviews: 0,
                max_scroll: 0,
                engaged_seconds: 0,
                converted: false,
                conversion_value: 0,
              });

            if (insertError && String(insertError.code) !== "23505") throw insertError;
          }

          return new Response(null, { status: 204, headers: responseHeaders });
        } catch (error) {
          console.error("[AnalisePro] realtime POST", error);
          return new Response(null, { status: 204, headers: responseHeaders });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 8_000;
const ACTIVE_WINDOW_SECONDS = 30;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

async function resolveSiteId(siteKey: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("analytics_pro_sites")
    .select("id")
    .eq("site_key", siteKey)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data?.id ? String(data.id) : null;
}

async function countActiveVisitors(siteId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_SECONDS * 1000).toISOString();

  const { data, error } = await (supabaseAdmin as any)
    .from("analytics_pro_sessions")
    .select("visitor_id")
    .eq("site_id", siteId)
    .gte("last_seen_at", cutoff);

  if (error) throw error;

  const visitors = new Set(
    (data ?? [])
      .map((row: any) => clean(row?.visitor_id, 160))
      .filter(Boolean),
  );

  return visitors.size;
}

async function touchPresence(
  siteId: string,
  sessionId: string,
  visitorId: string,
  pagePath: string,
  pageTitle: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date().toISOString();

  const { data: existing, error: lookupError } = await (supabaseAdmin as any)
    .from("analytics_pro_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("site_id", siteId)
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await (supabaseAdmin as any)
      .from("analytics_pro_sessions")
      .update({
        last_seen_at: now,
      })
      .eq("id", sessionId)
      .eq("site_id", siteId)
      .eq("visitor_id", visitorId);

    if (error) throw error;
  } else {
    const { error } = await (supabaseAdmin as any)
      .from("analytics_pro_sessions")
      .insert({
        id: sessionId,
        site_id: siteId,
        visitor_id: visitorId,
        first_seen_at: now,
        last_seen_at: now,
        entry_path: pagePath || "/",
      });

    if (error && String(error.code) !== "23505") throw error;
  }

  return now;
}

async function handleGet(request: Request) {
  const url = new URL(request.url);
  const siteKey = clean(url.searchParams.get("site_key"), 160);
  const headers = corsHeaders();

  if (!siteKey) {
    return Response.json(
      { ok: false, error: "missing_site_key", active_visitors: 0, window_seconds: ACTIVE_WINDOW_SECONDS },
      { status: 400, headers },
    );
  }

  try {
    const siteId = await resolveSiteId(siteKey);
    if (!siteId) {
      return Response.json(
        { ok: false, error: "invalid_site", active_visitors: 0, window_seconds: ACTIVE_WINDOW_SECONDS },
        { status: 404, headers },
      );
    }

    const activeVisitors = await countActiveVisitors(siteId);

    return Response.json(
      {
        ok: true,
        active_visitors: activeVisitors,
        window_seconds: ACTIVE_WINDOW_SECONDS,
        generated_at: new Date().toISOString(),
      },
      { status: 200, headers },
    );
  } catch (error) {
    console.error("[AnalisePro] realtime GET", error);
    return Response.json(
      { ok: false, error: "realtime_failed", active_visitors: 0, window_seconds: ACTIVE_WINDOW_SECONDS },
      { status: 500, headers },
    );
  }
}

async function handlePost(request: Request) {
  const headers = corsHeaders();

  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) {
      return Response.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
    }

    const body = await request.json();
    const siteKey = clean(body?.site_key, 160);
    const sessionId = clean(body?.session_id, 160);
    const visitorId = clean(body?.visitor_id, 160);
    const pagePath = clean(body?.page_path, 500);
    const pageTitle = clean(body?.page_title, 500);

    if (!siteKey || !sessionId || !visitorId) {
      return Response.json({ ok: false, error: "missing_identity" }, { status: 400, headers });
    }

    const siteId = await resolveSiteId(siteKey);
    if (!siteId) {
      return Response.json({ ok: false, error: "invalid_site" }, { status: 404, headers });
    }

    await touchPresence(siteId, sessionId, visitorId, pagePath, pageTitle);
    const activeVisitors = await countActiveVisitors(siteId);

    return Response.json(
      {
        ok: true,
        active_visitors: activeVisitors,
        window_seconds: ACTIVE_WINDOW_SECONDS,
        generated_at: new Date().toISOString(),
      },
      { status: 200, headers },
    );
  } catch (error) {
    console.error("[AnalisePro] realtime POST", error);
    return Response.json({ ok: false, error: "realtime_failed" }, { status: 500, headers });
  }
}

export const Route = createFileRoute("/api/public/analise/realtime")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
    },
  },
});

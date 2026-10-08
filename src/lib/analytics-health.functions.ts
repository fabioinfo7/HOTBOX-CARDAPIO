import { createServerFn } from "@tanstack/react-start";

export const analyticsHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sessions = await (supabaseAdmin as any)
      .from("analytics_sessions")
      .select("id", { count: "exact", head: true });

    const events = await (supabaseAdmin as any)
      .from("analytics_events")
      .select("id", { count: "exact", head: true });

    return {
      ok: !sessions.error && !events.error,
      sessions_count: sessions.count ?? 0,
      events_count: events.count ?? 0,
      sessions_error: sessions.error
        ? {
            code: sessions.error.code,
            message: sessions.error.message,
            details: sessions.error.details,
            hint: sessions.error.hint,
          }
        : null,
      events_error: events.error
        ? {
            code: events.error.code,
            message: events.error.message,
            details: events.error.details,
            hint: events.error.hint,
          }
        : null,
    };
  } catch (error: any) {
    return {
      ok: false,
      sessions_count: 0,
      events_count: 0,
      sessions_error: null,
      events_error: null,
      exception: error?.message || String(error),
    };
  }
});

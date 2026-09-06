import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: any) {
  const { data } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "store_admin").maybeSingle();
  return !!data;
}

function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function pct(a: number, b: number) { return b > 0 ? Number(((a / b) * 100).toFixed(1)) : 0; }
function groupCount<T>(rows: T[], key: (r: T) => string) {
  const map = new Map<string, number>();
  for (const row of rows) { const k = key(row) || "Não identificado"; map.set(k, (map.get(k) || 0) + 1); }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export const getAnalyticsDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string; surface?: string; maxEvents?: number }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fromIso = new Date(`${data.from}T00:00:00-03:00`).toISOString();
    const toIso = new Date(`${data.to}T23:59:59.999-03:00`).toISOString();
    const maxEvents = Math.max(500, Math.min(10_000, Number(data.maxEvents || 5000)));

    let eventQ = (supabaseAdmin as any).from("analytics_events")
      .select("id,session_id,visitor_id,event_name,event_category,event_label,page_path,page_title,value,product_id,product_name,checkout_id,order_id,metadata,occurred_at")
      .gte("occurred_at", fromIso).lte("occurred_at", toIso).order("occurred_at", { ascending: false }).limit(maxEvents);
    if (data.surface && data.surface !== "all") eventQ = eventQ.contains("metadata", { surface: data.surface });
    const { data: events, error: eventError } = await eventQ;
    if (eventError) return { ok: false, error: eventError.message } as const;

    const sessionIds = [...new Set((events || []).map((e: any) => e.session_id).filter(Boolean))];
    const sessions: any[] = [];
    for (let i = 0; i < sessionIds.length; i += 500) {
      const { data: part, error } = await (supabaseAdmin as any).from("analytics_sessions")
        .select("session_id,visitor_id,started_at,last_seen_at,ended_at,landing_path,last_path,referrer,source,medium,campaign,content,term,device_type,browser,os,screen,viewport,language,timezone,pageviews,event_count,max_scroll,engagement_seconds,checkout_started_at,checkout_id,converted_at,order_id,revenue")
        .in("session_id", sessionIds.slice(i, i + 500));
      if (error) return { ok: false, error: error.message } as const;
      sessions.push(...(part || []));
    }

    const ev = events || [];
    const ss = sessions || [];
    const visitors = new Set(ss.map((s: any) => s.visitor_id)).size;
    const conversions = ss.filter((s: any) => s.converted_at).length;
    const revenue = ss.filter((s: any) => s.converted_at).reduce((sum: number, s: any) => sum + n(s.revenue), 0);
    const now = Date.now();
    const abandoned = ss.filter((s: any) => !s.converted_at && now - new Date(s.last_seen_at || s.started_at).getTime() > 30 * 60_000).length;
    const avgEngagement = ss.length ? Math.round(ss.reduce((sum: number, s: any) => sum + n(s.engagement_seconds), 0) / ss.length) : 0;
    const pageviews = ev.filter((e: any) => e.event_name === "page_view").length;

    const funnelDefs = [
      ["Acessou Bio", (e: any) => e.event_name === "page_view" && e.metadata?.surface === "bio"],
      ["Acessou Cardápio", (e: any) => e.event_name === "page_view" && e.metadata?.surface === "menu"],
      ["Iniciou validação de CEP", (e: any) => e.event_name === "area_check_start"],
      ["Área aprovada", (e: any) => e.event_name === "area_supported"],
      ["Visualizou produto", (e: any) => e.event_name === "product_view"],
      ["Adicionou à sacola", (e: any) => e.event_name === "add_to_cart"],
      ["Iniciou checkout", (e: any) => e.event_name === "checkout_start"],
      ["Criou checkout/pedido", (e: any) => ["checkout_created", "order_created"].includes(e.event_name)],
      ["Venda concluída", (e: any) => e.event_name === "purchase_completed"],
    ] as const;
    const funnel = funnelDefs.map(([name, fn]) => ({ name, count: new Set(ev.filter(fn).map((e: any) => e.session_id)).size }));

    const sourceMap = new Map<string, any>();
    for (const s of ss) {
      const key = `${s.source || "Direto"}|||${s.medium || ""}`;
      const row = sourceMap.get(key) || { source: s.source || "Direto", medium: s.medium || "", sessions: 0, conversions: 0, revenue: 0 };
      row.sessions++; if (s.converted_at) { row.conversions++; row.revenue += n(s.revenue); } sourceMap.set(key, row);
    }
    const sources = [...sourceMap.values()].map((r) => ({ ...r, conversionRate: pct(r.conversions, r.sessions) })).sort((a, b) => b.sessions - a.sessions);

    const campaignMap = new Map<string, any>();
    for (const s of ss.filter((x: any) => x.campaign)) {
      const key = String(s.campaign);
      const row = campaignMap.get(key) || { campaign: key, sessions: 0, conversions: 0, revenue: 0 };
      row.sessions++; if (s.converted_at) { row.conversions++; row.revenue += n(s.revenue); } campaignMap.set(key, row);
    }
    const campaigns = [...campaignMap.values()].map((r) => ({ ...r, conversionRate: pct(r.conversions, r.sessions) })).sort((a, b) => b.sessions - a.sessions);

    const pageMap = new Map<string, any>();
    for (const e of ev.filter((x: any) => x.event_name === "page_view")) {
      const path = e.page_path || "/"; const row = pageMap.get(path) || { path, views: 0, sessions: new Set<string>() };
      row.views++; row.sessions.add(e.session_id); pageMap.set(path, row);
    }
    const pages = [...pageMap.values()].map((r) => ({ path: r.path, views: r.views, sessions: r.sessions.size })).sort((a, b) => b.views - a.views);

    const lastEventBySession = new Map<string, any>();
    for (const e of [...ev].sort((a: any, b: any) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())) lastEventBySession.set(e.session_id, e);
    const abandonments = groupCount(ss.filter((s: any) => !s.converted_at && now - new Date(s.last_seen_at || s.started_at).getTime() > 30 * 60_000), (s: any) => {
      const e = lastEventBySession.get(s.session_id); return e ? `${e.event_name} · ${e.page_path || s.last_path || ""}` : s.last_path || "Sem evento";
    }).slice(0, 20);

    const dayMap = new Map<string, any>();
    for (const s of ss) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(s.started_at));
      const row = dayMap.get(day) || { day, sessions: 0, conversions: 0, revenue: 0 };
      row.sessions++; if (s.converted_at) { row.conversions++; row.revenue += n(s.revenue); } dayMap.set(day, row);
    }
    const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    const eventTypes = groupCount(ev, (e: any) => e.event_name).slice(0, 40);
    const devices = groupCount(ss, (s: any) => s.device_type || "Desconhecido");
    const browsers = groupCount(ss, (s: any) => s.browser || "Desconhecido");
    const oses = groupCount(ss, (s: any) => s.os || "Desconhecido");

    return {
      ok: true,
      summary: {
        sessions: ss.length, visitors, pageviews, events: ev.length, conversions, revenue: Number(revenue.toFixed(2)),
        conversionRate: pct(conversions, ss.length), averageOrderValue: conversions ? Number((revenue / conversions).toFixed(2)) : 0,
        abandoned, abandonmentRate: pct(abandoned, ss.length), averageEngagementSeconds: avgEngagement,
      },
      funnel, sources, campaigns, pages, abandonments, days, eventTypes, devices, browsers, oses,
      sessions: ss.sort((a: any, b: any) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()).slice(0, 300),
      events: ev.slice(0, 1000),
      truncated: ev.length >= maxEvents,
    } as const;
  });

export const getAnalyticsSessionJourneyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error: sErr } = await (supabaseAdmin as any).from("analytics_sessions").select("*").eq("session_id", data.sessionId).maybeSingle();
    if (sErr) return { ok: false, error: sErr.message } as const;
    const { data: events, error: eErr } = await (supabaseAdmin as any).from("analytics_events").select("*").eq("session_id", data.sessionId).order("occurred_at", { ascending: true }).limit(1000);
    if (eErr) return { ok: false, error: eErr.message } as const;
    return { ok: true, session, events: events || [] } as const;
  });

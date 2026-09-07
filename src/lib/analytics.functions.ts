import { createServerFn } from "@tanstack/react-start";

export type AnalyticsEventInput = {
  session_id: string;
  visitor_id: string;
  event_name: string;
  event_category?: string | null;
  page_path?: string | null;
  page_title?: string | null;
  referrer?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
  click_id?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  language?: string | null;
  timezone?: string | null;
  screen_width?: number | null;
  screen_height?: number | null;
  viewport_width?: number | null;
  viewport_height?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  checkout_id?: string | null;
  order_id?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  payment_method?: string | null;
  value?: number | null;
  quantity?: number | null;
  properties?: Record<string, unknown> | null;
};

function trim(v: unknown, max = 500) {
  return String(v ?? "").trim().slice(0, max) || null;
}

export const trackAnalyticsEvent = createServerFn({ method: "POST" })
  .inputValidator((data: AnalyticsEventInput) => data)
  .handler(async ({ data }) => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const request = getRequest();
      const h = request?.headers;
      const forwarded = h?.get("x-forwarded-for")?.split(",")[0]?.trim();
      const ip = forwarded || h?.get("cf-connecting-ip") || h?.get("x-real-ip") || null;
      const userAgent = h?.get("user-agent") || null;
      const country = h?.get("cf-ipcountry") || null;
      const city = h?.get("cf-ipcity") || null;
      const region = h?.get("cf-region") || null;

      const sessionId = trim(data.session_id, 100);
      const visitorId = trim(data.visitor_id, 100);
      const eventName = trim(data.event_name, 100);
      if (!sessionId || !visitorId || !eventName) return { ok: false } as const;

      const now = new Date().toISOString();
      const sessionPayload: any = {
        id: sessionId,
        visitor_id: visitorId,
        last_seen_at: now,
        entry_path: trim(data.page_path, 500),
        landing_referrer: trim(data.referrer, 1200),
        source: trim(data.source, 120),
        medium: trim(data.medium, 120),
        campaign: trim(data.campaign, 240),
        term: trim(data.term, 240),
        content: trim(data.content, 240),
        click_id: trim(data.click_id, 300),
        device_type: trim(data.device_type, 40),
        browser: trim(data.browser, 100),
        os: trim(data.os, 100),
        language: trim(data.language, 40),
        timezone: trim(data.timezone, 100),
        screen_width: Number(data.screen_width || 0) || null,
        screen_height: Number(data.screen_height || 0) || null,
        viewport_width: Number(data.viewport_width || 0) || null,
        viewport_height: Number(data.viewport_height || 0) || null,
        ip_address: trim(ip, 80),
        country: trim(country, 100),
        region: trim(region, 100),
        city: trim(city, 100),
        user_agent: trim(userAgent, 1000),
      };
      if (data.customer_name) sessionPayload.customer_name = trim(data.customer_name, 180);
      if (data.customer_phone) sessionPayload.customer_phone = String(data.customer_phone).replace(/\D/g, "").slice(0, 20) || null;
      if (data.checkout_id) sessionPayload.checkout_id = trim(data.checkout_id, 100);
      if (data.order_id) sessionPayload.order_id = trim(data.order_id, 100);
      if (data.payment_method) sessionPayload.payment_method = trim(data.payment_method, 100);
      if (eventName === "purchase" || eventName === "order_created") {
        sessionPayload.converted = true;
        sessionPayload.converted_at = now;
        sessionPayload.revenue = Number(data.value || 0) || 0;
      }

      // First insert preserves first_seen/entry. On conflict only update mutable fields.
      const { error: sessionInsertError } = await (supabaseAdmin as any)
        .from("analytics_sessions")
        .insert(sessionPayload);

      if (sessionInsertError) {
        if (String(sessionInsertError.code) === "23505") {
          const updatePayload = { ...sessionPayload };
          delete updatePayload.id;
          delete updatePayload.visitor_id;
          delete updatePayload.entry_path;
          delete updatePayload.landing_referrer;
          delete updatePayload.source;
          delete updatePayload.medium;
          delete updatePayload.campaign;
          delete updatePayload.term;
          delete updatePayload.content;
          delete updatePayload.click_id;

          const { error: sessionUpdateError } = await (supabaseAdmin as any)
            .from("analytics_sessions")
            .update(updatePayload)
            .eq("id", sessionId);

          if (sessionUpdateError) {
            console.error("[analytics] session update failed", {
              code: sessionUpdateError.code,
              message: sessionUpdateError.message,
              details: sessionUpdateError.details,
              hint: sessionUpdateError.hint,
            });
            return { ok: false, stage: "session_update", error: sessionUpdateError.message } as const;
          }
        } else {
          console.error("[analytics] session insert failed", {
            code: sessionInsertError.code,
            message: sessionInsertError.message,
            details: sessionInsertError.details,
            hint: sessionInsertError.hint,
          });
          return { ok: false, stage: "session_insert", error: sessionInsertError.message } as const;
        }
      }

      const { error: eventInsertError } = await (supabaseAdmin as any)
        .from("analytics_events")
        .insert({
          session_id: sessionId,
          visitor_id: visitorId,
          event_name: eventName,
          event_category: trim(data.event_category, 100) || "engagement",
          page_path: trim(data.page_path, 500),
          page_title: trim(data.page_title, 500),
          product_id: trim(data.product_id, 100),
          product_name: trim(data.product_name, 300),
          checkout_id: trim(data.checkout_id, 100),
          order_id: trim(data.order_id, 100),
          payment_method: trim(data.payment_method, 100),
          value: data.value == null ? null : Number(data.value),
          quantity: data.quantity == null ? null : Number(data.quantity),
          properties: data.properties && typeof data.properties === "object" ? data.properties : {},
        });

      if (eventInsertError) {
        console.error("[analytics] event insert failed", {
          code: eventInsertError.code,
          message: eventInsertError.message,
          details: eventInsertError.details,
          hint: eventInsertError.hint,
        });
        return { ok: false, stage: "event_insert", error: eventInsertError.message } as const;
      }

      return { ok: true } as const;
    } catch (error: any) {
      console.error("[analytics] track failed", {
        message: error?.message || String(error),
        stack: error?.stack,
      });
      // Analytics must never break checkout/customer experience.
      return { ok: false, stage: "exception", error: error?.message || String(error) } as const;
    }
  });

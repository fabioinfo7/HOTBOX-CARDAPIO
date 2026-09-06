import { useEffect } from "react";
import { trackAnalytics } from "@/lib/analytics";

export function AnalyticsTracker() {
  useEffect(() => {
    if (typeof window === "undefined" || /^\/(loja|admin|entregador)(\/|$)/.test(location.pathname)) return;
    let currentPath = `${location.pathname}${location.search}`;
    let startedAt = Date.now();
    const scrollMarks = new Set<number>();

    const pageView = () => trackAnalytics("page_view", { event_category: "navigation", page_path: currentPath });
    pageView();

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("a,button,[role='button']") as HTMLElement | null;
      if (!el) return;
      const anchor = el instanceof HTMLAnchorElement ? el : null;
      trackAnalytics("click", {
        event_category: "interaction",
        properties: {
          text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 180),
          element: el.tagName.toLowerCase(),
          href: anchor?.href || null,
          id: el.id || null,
          analytics_label: el.getAttribute("data-analytics") || null,
        },
      });
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // Never collect field values here. Only interaction with the field.
      trackAnalytics("form_field_focus", { event_category: "form", properties: { name: el.name || el.id || el.getAttribute("aria-label") || "field", type: (el as HTMLInputElement).type || el.tagName.toLowerCase() } });
    };
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const pct = Math.round((scrollY / max) * 100);
      [25, 50, 75, 90, 100].forEach((mark) => {
        if (pct >= mark && !scrollMarks.has(mark)) {
          scrollMarks.add(mark);
          trackAnalytics("scroll_depth", { event_category: "engagement", properties: { percent: mark } });
        }
      });
    };
    const routePoll = window.setInterval(() => {
      const next = `${location.pathname}${location.search}`;
      if (next !== currentPath) {
        trackAnalytics("page_exit", { event_category: "engagement", page_path: currentPath, value: Math.round((Date.now() - startedAt) / 1000) });
        currentPath = next; startedAt = Date.now(); scrollMarks.clear(); pageView();
      }
    }, 600);
    const onHide = () => trackAnalytics("page_exit", { event_category: "engagement", page_path: currentPath, value: Math.round((Date.now() - startedAt) / 1000) });

    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(routePoll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  return null;
}

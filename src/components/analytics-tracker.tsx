import { useEffect } from "react";
import { trackAnalytics } from "@/lib/analytics";

export function AnalyticsTracker() {
  useEffect(() => {
    if (typeof window === "undefined" || /^\/(loja|admin|entregador)(\/|$)/.test(location.pathname))
      return;
    let currentPath = `${location.pathname}${location.search}`;
    let startedAt = Date.now();
    const scrollMarks = new Set<number>();

    const pageView = () =>
      trackAnalytics("page_view", { event_category: "navigation", page_path: currentPath });
    pageView();

    const safeHref = (anchor: HTMLAnchorElement | null) => {
      if (!anchor?.href) return null;
      try {
        const url = new URL(anchor.href, window.location.origin);
        return `${url.origin}${url.pathname}`;
      } catch {
        return null;
      }
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest(
        "a,button,[role='button']",
      ) as HTMLElement | null;
      if (!el) return;
      const anchor = el instanceof HTMLAnchorElement ? el : null;
      trackAnalytics("click", {
        event_category: "interaction",
        properties: {
          text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "")
            .trim()
            .slice(0, 180),
          element: el.tagName.toLowerCase(),
          // Query strings can contain prefilled WhatsApp messages or campaign
          // identifiers. Analytics only needs the destination, never that content.
          href: safeHref(anchor),
          id: el.id || null,
          analytics_label: el.getAttribute("data-analytics") || null,
        },
      });
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // Never collect field values here. Only interaction with the field.
      trackAnalytics("form_field_focus", {
        event_category: "form",
        properties: {
          name: el.name || el.id || el.getAttribute("aria-label") || "field",
          type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
        },
      });
    };
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const pct = Math.round((scrollY / max) * 100);
      [25, 50, 75, 90, 100].forEach((mark) => {
        if (pct >= mark && !scrollMarks.has(mark)) {
          scrollMarks.add(mark);
          trackAnalytics("scroll_depth", {
            event_category: "engagement",
            properties: { percent: mark },
          });
        }
      });
    };
    const routePoll = window.setInterval(() => {
      const next = `${location.pathname}${location.search}`;
      if (next !== currentPath) {
        trackAnalytics("page_exit", {
          event_category: "engagement",
          page_path: currentPath,
          value: Math.round((Date.now() - startedAt) / 1000),
        });
        currentPath = next;
        startedAt = Date.now();
        scrollMarks.clear();
        pageView();
      }
    }, 600);
    const onVirtualPage = (event: Event) => {
      const detail = (event as CustomEvent<{ previousPath?: string; nextPath?: string }>).detail;
      const next = String(detail?.nextPath || "").trim();
      if (!next || next === currentPath) return;
      trackAnalytics("page_exit", {
        event_category: "engagement",
        page_path: currentPath,
        value: Math.round((Date.now() - startedAt) / 1000),
        properties: { virtual_page: true },
      });
      currentPath = next;
      startedAt = Date.now();
      scrollMarks.clear();
    };

    const reportPerformance = () => {
      window.setTimeout(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined;
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        if (!navigation) return;
        trackAnalytics("performance_summary", {
          event_category: "performance",
          properties: {
            ttfb_ms: Math.round(navigation.responseStart),
            dom_interactive_ms: Math.round(navigation.domInteractive),
            load_ms: Math.round(navigation.loadEventEnd || performance.now()),
            fcp_ms: paint ? Math.round(paint.startTime) : null,
            transfer_kb: navigation.transferSize
              ? Math.round(navigation.transferSize / 1024)
              : null,
          },
        });
      }, 1200);
    };
    if (document.readyState === "complete") reportPerformance();
    else window.addEventListener("load", reportPerformance, { once: true });
    const onHide = () =>
      trackAnalytics("page_exit", {
        event_category: "engagement",
        page_path: currentPath,
        value: Math.round((Date.now() - startedAt) / 1000),
      });

    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    window.addEventListener("hotbox:virtual-page", onVirtualPage as EventListener);
    return () => {
      clearInterval(routePoll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("hotbox:virtual-page", onVirtualPage as EventListener);
      window.removeEventListener("load", reportPerformance);
    };
  }, []);
  return null;
}

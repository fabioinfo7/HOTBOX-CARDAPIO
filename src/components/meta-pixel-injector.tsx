import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type Placement = "menu" | "bio";

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    __hotboxMetaPixels?: Set<string>;
    __hotboxMetaPageViews?: Set<string>;
  }
}

function extractPixelId(source: string) {
  const text = String(source || "").trim();
  if (!text) return "";

  const patterns = [
    /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{5,})['"]/i,
    /facebook\.com\/tr\?id=(\d{5,})/i,
    /pixel[_\s-]*id[^0-9]*(\d{5,})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Também aceita somente o ID numérico no campo.
  if (/^\d{5,}$/.test(text)) return text;

  return "";
}

function ensureFacebookPixel(pixelId: string) {
  if (typeof window === "undefined" || !pixelId) return;

  if (!window.fbq) {
    const fbq: any = function (...args: any[]) {
      if (fbq.callMethod) {
        fbq.callMethod.apply(fbq, args);
      } else {
        fbq.queue.push(args);
      }
    };

    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];

    window.fbq = fbq;
    window._fbq = fbq;

    if (!document.querySelector('script[data-hotbox-meta-pixel="1"]')) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.dataset.hotboxMetaPixel = "1";
      document.head.appendChild(script);
    }
  }

  window.__hotboxMetaPixels ??= new Set<string>();

  if (!window.__hotboxMetaPixels.has(pixelId)) {
    window.fbq?.("init", pixelId);
    window.__hotboxMetaPixels.add(pixelId);
  }

  const pageKey = `${pixelId}:${window.location.pathname}${window.location.search}`;
  window.__hotboxMetaPageViews ??= new Set<string>();

  if (!window.__hotboxMetaPageViews.has(pageKey)) {
    window.fbq?.("track", "PageView");
    window.__hotboxMetaPageViews.add(pageKey);
  }
}

export function MetaPixelInjector({ placement }: { placement: Placement }) {
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await (supabase as any)
        .from("store_config")
        .select("meta_pixel_enabled, meta_pixel_script, meta_pixel_on_menu, meta_pixel_on_bio")
        .eq("id", 1)
        .maybeSingle();

      if (cancelled || error || !data?.meta_pixel_enabled) return;

      const allowed =
        placement === "menu"
          ? data.meta_pixel_on_menu !== false
          : data.meta_pixel_on_bio !== false;

      if (!allowed) return;

      const pixelId = extractPixelId(data.meta_pixel_script || "");
      if (!pixelId) {
        console.warn("[meta-pixel] Não foi possível identificar o Pixel ID no script salvo.");
        return;
      }

      ensureFacebookPixel(pixelId);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [placement]);

  return null;
}

export { extractPixelId };

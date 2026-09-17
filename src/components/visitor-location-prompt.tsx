import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  captureVisitorNeighborhood,
  getVisitorLocationPromptSettings,
} from "@/lib/analytics.functions";
import { analyticsIdentity, trackAnalytics } from "@/lib/analytics";

const PROMPT_KEY = "hb_visitor_location_prompt_answered";

export function VisitorLocationPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      /^\/(loja|admin|entregador)(\/|$)/.test(location.pathname) ||
      sessionStorage.getItem(PROMPT_KEY)
    ) return;

    void getVisitorLocationPromptSettings().then((result: any) => {
      if (result?.ok && result.enabled) setVisible(true);
    });
  }, []);

  const dismiss = (event: string) => {
    try { sessionStorage.setItem(PROMPT_KEY, "1"); } catch {}
    setVisible(false);
    trackAnalytics(event, { event_category: "location" });
  };

  const allow = () => {
    if (!navigator.geolocation) return dismiss("visitor_location_unavailable");

    trackAnalytics("visitor_location_prompt_accepted", { event_category: "location" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const ids = analyticsIdentity();
        void captureVisitorNeighborhood({
          data: {
            ...ids,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy_m: position.coords.accuracy,
          },
        });
        try { sessionStorage.setItem(PROMPT_KEY, "1"); } catch {}
        setVisible(false);
      },
      () => dismiss("visitor_location_declined"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border bg-background p-4 shadow-xl sm:bottom-5">
      <div className="flex gap-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">Encontrar opções da sua região?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Com sua permissão, usamos a localização aproximada apenas para entender os bairros que visitam a loja. Isso não altera taxa nem disponibilidade de entrega.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={allow}>Permitir localização</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss("visitor_location_prompt_dismissed")}>Agora não</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

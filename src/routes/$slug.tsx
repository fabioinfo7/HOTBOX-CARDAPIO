import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/$slug")({ component: ShortLinkRedirect });

function ShortLinkRedirect() {
  const { slug } = Route.useParams();
  const [state, setState] = useState<"loading" | "missing" | "invalid">("loading");

  useEffect(() => {
    let alive = true;
    const alias = String(slug || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(alias)) { setState("missing"); return; }
    void (supabase as any).from("short_links").select("destination_url").eq("slug", alias).eq("active", true).maybeSingle()
      .then(({ data, error }: any) => {
        if (!alive) return;
        const destination = String(data?.destination_url || "").trim();
        if (error || !destination) { setState("missing"); return; }
        try {
          const url = new URL(destination);
          if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
          window.location.replace(url.toString());
        } catch { setState("invalid"); }
      });
    return () => { alive = false; };
  }, [slug]);

  return <main className="grid min-h-screen place-items-center bg-zinc-950 p-5 text-white"><section className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-7 text-center shadow-2xl">{state === "loading" ? <Loader2 className="mx-auto size-9 animate-spin text-amber-400" /> : <AlertCircle className="mx-auto size-10 text-amber-400" />}<h1 className="mt-4 text-xl font-black">{state === "loading" ? "Abrindo link..." : "Link indisponível"}</h1>{state !== "loading" && <p className="mt-2 text-sm text-zinc-300">{state === "invalid" ? "Este destino não é válido." : "Este link não existe ou não está mais ativo."}</p>}</section></main>;
}

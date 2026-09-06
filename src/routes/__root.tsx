import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";


const TRACKING_SCRIPT_MARKER = "data-hotbox-config-tracking";

function isPublicCustomerPage() {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname || "/";
  return !path.startsWith("/loja") && !path.startsWith("/admin") && !path.startsWith("/entregador");
}

function clearConfiguredTrackingScripts() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(`[${TRACKING_SCRIPT_MARKER}="true"]`).forEach((node) => node.remove());
}

function installConfiguredTrackingScript(rawSnippet: string) {
  if (typeof document === "undefined") return;
  const snippet = String(rawSnippet || "").trim();
  if (!snippet) return;

  clearConfiguredTrackingScripts();

  // O administrador cola o código completo fornecido pela Meta. Não existe
  // Pixel hardcoded no projeto: os <script> são recriados aqui para que o
  // navegador realmente os execute. <noscript> não é necessário quando JS está ativo.
  const parsed = new DOMParser().parseFromString(snippet, "text/html");
  const sourceScripts = Array.from(parsed.querySelectorAll("script"));

  if (sourceScripts.length === 0) {
    // Também aceita JavaScript puro, caso o usuário cole apenas o conteúdo do script.
    const script = document.createElement("script");
    script.setAttribute(TRACKING_SCRIPT_MARKER, "true");
    script.textContent = snippet;
    document.head.appendChild(script);
    return;
  }

  for (const source of sourceScripts) {
    const script = document.createElement("script");
    for (const attr of Array.from(source.attributes)) script.setAttribute(attr.name, attr.value);
    script.setAttribute(TRACKING_SCRIPT_MARKER, "true");
    if (source.src) script.src = source.src;
    else script.textContent = source.textContent || "";
    document.head.appendChild(script);
  }
}

async function loadConfiguredTrackingScript() {
  if (!isPublicCustomerPage()) return;
  try {
    const { data, error } = await (supabase as any).rpc("get_public_tracking_config");
    if (error) throw error;
    if (data?.meta_pixel_script_enabled === true && String(data?.meta_pixel_script || "").trim()) {
      installConfiguredTrackingScript(String(data.meta_pixel_script));
    } else {
      clearConfiguredTrackingScripts();
    }
  } catch (error) {
    console.error("[tracking-config] não foi possível carregar o script configurado", error);
  }
}

function reportAppError(error: unknown, context: Record<string, unknown> = {}) {
  // Log local do erro de renderização — sem dependência de nenhum serviço externo.
  console.error("[app-error-boundary]", error, context);
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-4 text-lg font-semibold">Página não encontrada</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportAppError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tente novamente ou volte ao início.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Tentar de novo</button>
          <a href="/" className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium">Início</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "HotBox Delivery — Muito sabor em cada pedido" },
      { name: "description", content: "Peça lanches, pizzas e bebidas na HotBox Delivery. Entrega rápida, pagamento por Pix ou cartão." },
      { property: "og:title", content: "HotBox Delivery — Muito sabor em cada pedido" },
      { property: "og:description", content: "Peça lanches, pizzas e bebidas na HotBox Delivery. Entrega rápida, pagamento por Pix ou cartão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "HotBox Delivery — Muito sabor em cada pedido" },
      { name: "twitter:description", content: "Peça lanches, pizzas e bebidas na HotBox Delivery. Entrega rápida, pagamento por Pix ou cartão." },
      // TODO: substituir pela URL do logo/banner do HotBox hospedado no domínio novo
      // (a imagem antiga era um preview gerado automaticamente pelo Lovable).
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    void loadConfiguredTrackingScript();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}

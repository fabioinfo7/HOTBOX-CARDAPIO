import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const loginTo = location.pathname.startsWith("/entregador") ? "/entregador/login" : "/admin/login";
      throw redirect({ to: loginTo });
    }
    return { user: data.user };
  },
  pendingComponent: () => (
    <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
      Carregando…
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <p className="mb-3 text-sm text-destructive">Erro: {String((error as any)?.message ?? error)}</p>
        <button onClick={reset} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Tentar novamente
        </button>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">Não encontrado</div>
  ),
  component: () => <Outlet />,
});

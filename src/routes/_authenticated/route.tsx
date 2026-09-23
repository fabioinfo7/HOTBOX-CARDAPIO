import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type ProtectedArea = "admin" | "deliverer";

function getProtectedArea(pathname: string): ProtectedArea {
  return pathname.startsWith("/entregador") ? "deliverer" : "admin";
}

function getLoginPath(area: ProtectedArea) {
  return area === "deliverer" ? "/entregador/login" : "/admin/login";
}

function getHomePath(area: ProtectedArea) {
  return area === "deliverer" ? "/entregador" : "/loja";
}

async function hasRequiredRole(userId: string, area: ProtectedArea) {
  const role = area === "deliverer" ? "deliverer" : "store_admin";

  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: role,
  });

  if (error) {
    console.error("[auth] role check failed", error);
    return false;
  }

  return data === true;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const area = getProtectedArea(location.pathname);
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw redirect({ to: getLoginPath(area) });
    }

    const authorized = await hasRequiredRole(data.user.id, area);

    if (!authorized) {
      const target = getHomePath(area === "admin" ? "deliverer" : "admin");

      // A logged-in user with the other valid role is sent to their own area.
      // If the account has no supported role, sign out so protected UI is never shown.
      const otherArea: ProtectedArea = area === "admin" ? "deliverer" : "admin";
      const hasOtherRole = await hasRequiredRole(data.user.id, otherArea);

      if (hasOtherRole) {
        throw redirect({ to: target });
      }

      await supabase.auth.signOut();
      throw redirect({ to: getLoginPath(area) });
    }

    return { user: data.user, area };
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

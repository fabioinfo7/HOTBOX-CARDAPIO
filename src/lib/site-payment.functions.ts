import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { activatePaidSiteOrder } from "./site-payment.server";

export const confirmSitePaymentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "store_admin")
      .maybeSingle();
    if (!role) return { ok: false, error: "Acesso não autorizado" } as const;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return activatePaidSiteOrder(supabaseAdmin, data.orderId, "admin");
  });

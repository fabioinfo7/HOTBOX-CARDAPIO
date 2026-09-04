import { createServerFn } from "@tanstack/react-start";
import { pushNfoodOrderStatus } from "./nfood-api.server";

/**
 * Caminho direto pra avisar a 99Food de uma mudança de status, chamado na
 * hora do clique no painel — em paralelo ao trigger do banco
 * (push_nfood_status_change → webhooks/nfood-status-push). Mesmo padrão
 * de redundância já usado com a iFood: se um caminho falhar (URL pública
 * mal configurada, deploy no meio), o outro ainda cobre. O guard de
 * idempotência (nfood_last_pushed_status) evita envio duplicado.
 */
export const pushNfoodStatusFn = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; newStatus: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await pushNfoodOrderStatus(supabaseAdmin, data.orderId, data.newStatus);
    return result;
  });

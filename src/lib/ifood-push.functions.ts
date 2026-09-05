import { createServerFn } from "@tanstack/react-start";
import { pushIfoodOrderStatus } from "./ifood-api.server";

/**
 * Caminho DIRETO pra avisar a iFood de uma mudança de status, chamado na
 * hora do clique no painel — em paralelo ao caminho antigo (trigger do
 * banco → HTTP pro próprio site → push). Motivo: o caminho antigo tem
 * elos frágeis (URL pública configurada errada, site no meio de um deploy)
 * e quando qualquer um falha, a iFood nunca fica sabendo — foi exatamente
 * assim que o cenário "Pedido Confirmado" reprovou na homologação sem
 * deixar rastro. Com os dois caminhos ativos, o guard de idempotência
 * (ifood_last_pushed_status) garante que a iFood recebe o aviso UMA vez só,
 * não importa qual caminho chegar primeiro.
 */
export const pushIfoodStatusFn = createServerFn({ method: "POST" })
  .inputValidator((data: { orderId: string; newStatus: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await pushIfoodOrderStatus(supabaseAdmin, data.orderId, data.newStatus);
    return result;
  });

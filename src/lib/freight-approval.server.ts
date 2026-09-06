/**
 * Aprovação humana da taxa de entrega antes de a IA informar o valor ao cliente.
 *
 * Fluxo:
 *  1. A IA calcula a taxa pelo endereço do cliente.
 *  2. Antes de responder, cria um registro em `pending_freight_approvals`.
 *  3. A loja recebe o registro em tempo real (Realtime) e mostra um popup.
 *  4. O gerente aprova ou recusa em até 30 segundos.
 *     - aprovado  -> a IA informa o valor normalmente.
 *     - recusado  -> a conversa vai pra atendimento manual (bot_paused).
 *     - sem resposta em 30s -> expira e o valor calculado é liberado.
 */

export type FreightApprovalOutcome = {
  status: "approved" | "rejected" | "expired";
  fee: number | null;
};

const WINDOW_MS = 30_000;
const POLL_MS = 1_500;

export async function requestFreightApproval(
  supabaseAdmin: any,
  input: {
    conversationId: string;
    phone: string;
    customerName?: string | null;
    address: string;
    fee: number;
    distanceKm?: number | null;
  },
): Promise<FreightApprovalOutcome> {
  let approvalId: string | null = null;
  try {
    const expiresAt = new Date(Date.now() + WINDOW_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from("pending_freight_approvals")
      .insert({
        conversation_id: input.conversationId,
        phone: input.phone,
        customer_name: input.customerName ?? null,
        address: input.address,
        fee: input.fee,
        distance_km: input.distanceKm ?? null,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !data) return { status: "expired", fee: input.fee };
    approvalId = data.id as string;
  } catch {
    // Se nem conseguimos criar a solicitação, não travamos o atendimento.
    return { status: "expired", fee: input.fee };
  }

  const deadline = Date.now() + WINDOW_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const { data } = await supabaseAdmin
        .from("pending_freight_approvals")
        .select("status, fee")
        .eq("id", approvalId)
        .maybeSingle();
      const status = data?.status as string | undefined;
      if (status === "approved") return { status: "approved", fee: data?.fee == null ? input.fee : Number(data.fee) };
      if (status === "rejected") return { status: "rejected", fee: data?.fee == null ? input.fee : Number(data.fee) };
    } catch {
      /* segue tentando até o prazo */
    }
  }

  try {
    await supabaseAdmin
      .from("pending_freight_approvals")
      .update({ status: "expired", resolved_at: new Date().toISOString() })
      .eq("id", approvalId)
      .eq("status", "pending");
  } catch {
    /* ignora */
  }
  return { status: "expired", fee: input.fee };
}

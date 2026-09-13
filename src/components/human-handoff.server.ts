export async function requestSilentHumanHandoff(
  supabaseAdmin: any,
  input: {
    conversationId: string;
    phone: string;
    customerName?: string | null;
    reason: string;
    severity?: "info" | "warn" | "error";
  },
) {
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("whatsapp_conversations")
    .update({ bot_paused: true })
    .eq("id", input.conversationId);

  const { data: existing } = await (supabaseAdmin as any)
    .from("pending_human_handoffs")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing?.id) {
    await (supabaseAdmin as any)
      .from("pending_human_handoffs")
      .insert({
        conversation_id: input.conversationId,
        phone: input.phone,
        customer_name: input.customerName ?? null,
        reason: input.reason,
        status: "pending",
        created_at: now,
      });
  }

  try {
    await supabaseAdmin.rpc("record_system_alert", {
      _kind: "atendimento_manual_necessario",
      _message: `${input.phone}: ${input.reason}`,
      _severity: input.severity ?? "warn",
    });
  } catch {}

  return { ok: true };
}

export async function resolvePendingHumanHandoffsForConversation(
  supabaseAdmin: any,
  conversationId: string,
  status: "assumed" | "resolved" = "assumed",
) {
  try {
    await (supabaseAdmin as any)
      .from("pending_human_handoffs")
      .update({
        status,
        resolved_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId)
      .eq("status", "pending");
  } catch {}
}

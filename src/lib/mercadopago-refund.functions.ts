import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStoreAdmin(context: any) {
  const { data: role } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "store_admin")
    .maybeSingle();
  return !!role;
}

export const refundMercadoPagoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    checkoutId: string;
    refundType: "total" | "partial";
    amount?: number | null;
    reason: string;
  }) => data)
  .handler(async ({ data, context }) => {
    if (!(await requireStoreAdmin(context))) return { ok: false, error: "Acesso não autorizado." } as const;
    const reason = String(data.reason || "").trim().slice(0, 500);
    if (reason.length < 3) return { ok: false, error: "Informe o motivo do estorno." } as const;
    if (data.refundType !== "total" && data.refundType !== "partial") return { ok: false, error: "Tipo de estorno inválido." } as const;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadMercadoPagoConfig, fetchMercadoPagoOrder } = await import("@/lib/mercadopago.functions");
    const cfg = await loadMercadoPagoConfig(supabaseAdmin);
    if (!cfg.accessToken) return { ok: false, error: "Mercado Pago não está configurado." } as const;

    const { data: checkout, error } = await (supabaseAdmin as any)
      .from("site_checkout_sessions")
      .select("id,status,total,customer_name,order_id,payment_provider,payment_kind,mercadopago_order_id,mercadopago_payment_id,mercadopago_refunded_amount")
      .eq("id", data.checkoutId)
      .maybeSingle();
    if (error || !checkout) return { ok: false, error: "Recebimento não encontrado." } as const;
    if (checkout.payment_provider !== "mercadopago") return { ok: false, error: "Este recebimento não pertence ao Mercado Pago." } as const;
    if (checkout.status !== "paid" || !checkout.order_id) return { ok: false, error: "Somente pagamentos confirmados podem ser estornados." } as const;
    if (!checkout.mercadopago_order_id) return { ok: false, error: "Este pagamento é anterior à migração para Orders API e não possui Order ID. Faça o estorno pelo painel do Mercado Pago." } as const;

    const verified = await fetchMercadoPagoOrder(cfg.accessToken, String(checkout.mercadopago_order_id));
    if (!verified.response.ok) return { ok: false, error: "Não foi possível confirmar a order no Mercado Pago agora." } as const;
    const order = verified.body || {};
    const payment = Array.isArray(order?.transactions?.payments) ? order.transactions.payments[0] : null;
    const transactionId = String(payment?.id || checkout.mercadopago_payment_id || "");
    if (!transactionId) return { ok: false, error: "A transação de pagamento da order não foi encontrada." } as const;

    const total = Number(Number(checkout.total || 0).toFixed(2));
    const providerRefunded = Array.isArray(order?.transactions?.refunds)
      ? order.transactions.refunds.reduce((sum: number, r: any) => sum + Number(r?.amount || 0), 0)
      : 0;
    const localRefunded = Number(checkout.mercadopago_refunded_amount || 0);
    const alreadyRefunded = Math.max(providerRefunded, localRefunded);
    const refundable = Number(Math.max(0, total - alreadyRefunded).toFixed(2));
    if (refundable <= 0) return { ok: false, error: "Este pagamento já foi totalmente estornado." } as const;

    const amount = data.refundType === "total" ? refundable : Number(Number(data.amount || 0).toFixed(2));
    if (amount <= 0) return { ok: false, error: "Informe um valor válido para o estorno parcial." } as const;
    if (amount > refundable) return { ok: false, error: `O máximo disponível para estorno é R$ ${refundable.toFixed(2).replace(".", ",")}.` } as const;

    const idempotencyKey = `hotbox-refund-${crypto.randomUUID()}`;
    const { data: log, error: logError } = await (supabaseAdmin as any)
      .from("mercadopago_refunds")
      .insert({
        checkout_id: checkout.id,
        order_id: checkout.order_id,
        mercadopago_order_id: String(checkout.mercadopago_order_id),
        mercadopago_transaction_id: transactionId,
        refund_type: data.refundType,
        amount,
        reason,
        status: "requested",
        idempotency_key: idempotencyKey,
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (logError || !log?.id) return { ok: false, error: logError?.message || "Não foi possível registrar a solicitação de estorno." } as const;

    const body = data.refundType === "partial" || amount < total
      ? { transactions: [{ id: transactionId, amount: amount.toFixed(2) }] }
      : undefined;

    let response: Response;
    let result: any;
    try {
      response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(String(checkout.mercadopago_order_id))}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      result = await response.json().catch(() => ({}));
    } catch {
      await (supabaseAdmin as any).from("mercadopago_refunds").update({ status: "failed", error_message: "Falha de rede ao solicitar estorno.", updated_at: new Date().toISOString() }).eq("id", log.id);
      return { ok: false, error: "O Mercado Pago não respondeu. Nenhum estorno foi marcado como concluído no sistema." } as const;
    }

    if (!response.ok) {
      const errorText = String(result?.message || result?.error || result?.errors?.[0]?.message || result?.errors?.[0]?.code || `Mercado Pago respondeu ${response.status}`);
      await (supabaseAdmin as any).from("mercadopago_refunds").update({ status: "failed", response_payload: result, error_message: errorText, updated_at: new Date().toISOString() }).eq("id", log.id);
      return { ok: false, error: errorText } as const;
    }

    const refunds = Array.isArray(result?.transactions?.refunds) ? result.transactions.refunds : [];
    const providerRefund = refunds[refunds.length - 1] || {};
    const providerRefundId = String(providerRefund?.id || "");
    const providerStatus = String(providerRefund?.status || result?.status_detail || result?.status || "processing");
    const { data: finalized, error: finalizeError } = await (supabaseAdmin as any).rpc("finalize_mercadopago_refund", {
      p_refund_log_id: log.id,
      p_provider_refund_id: providerRefundId,
      p_provider_status: providerStatus,
      p_response_payload: result,
    });
    if (finalizeError || !finalized?.ok) {
      return { ok: false, warning: true, error: "O Mercado Pago aceitou o estorno, mas houve falha ao finalizar o registro local. Não repita o estorno. Verifique o histórico antes de qualquer nova tentativa." } as const;
    }

    return {
      ok: true,
      refundId: providerRefundId || null,
      status: providerStatus,
      amount,
      refundType: data.refundType,
      refundedAmount: Number(finalized.refunded_amount || amount),
      refundStatus: String(finalized.refund_status || ""),
    } as const;
  });

import { createFileRoute } from "@tanstack/react-router";
import { sendSatisfactionForOrder } from "@/lib/satisfaction.functions";

// Chamado pelo pg_cron a cada minuto. Envia automaticamente o convite de
// avaliação quando já se passaram pelo menos 10 minutos desde a entrega.
//
// IMPORTANTE: esta consulta prioriza os pedidos entregues mais recentes.
// A versão anterior ordenava updated_at do mais antigo e limitava em 100;
// quando existiam mais de 100 pedidos antigos entregues, pedidos novos podiam
// nunca entrar no lote analisado e a avaliação automática ficava bloqueada.
export const Route = createFileRoute("/api/public/hooks/satisfaction-auto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoffISO = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { data: cfg } = await supabaseAdmin
          .from("store_config")
          .select("app_public_url")
          .maybeSingle();
        let origin = String(cfg?.app_public_url ?? "").replace(/\/$/, "");
        if (!origin) {
          try { origin = new URL(request.url).origin; } catch { origin = ""; }
        }
        if (!origin) return Response.json({ ok: false, error: "app_public_url não configurada" }, { status: 500 });

        // Fluxo normal: delivered_at preenchido. Busca os elegíveis MAIS RECENTES,
        // evitando que histórico antigo ocupe permanentemente o limite.
        const { data: normalOrders, error: normalError } = await supabaseAdmin
          .from("orders")
          .select("id,delivered_at,updated_at,created_at")
          .eq("status", "delivered")
          .not("delivered_at", "is", null)
          .lte("delivered_at", cutoffISO)
          .order("delivered_at", { ascending: false })
          .limit(200);
        if (normalError) return Response.json({ ok: false, error: normalError.message }, { status: 500 });

        // Compatibilidade com pedidos antigos nos quais delivered_at ficou nulo.
        const { data: legacyOrders, error: legacyError } = await supabaseAdmin
          .from("orders")
          .select("id,delivered_at,updated_at,created_at")
          .eq("status", "delivered")
          .is("delivered_at", null)
          .lte("updated_at", cutoffISO)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (legacyError) return Response.json({ ok: false, error: legacyError.message }, { status: 500 });

        const unique = new Map<string, any>();
        for (const o of [...(normalOrders ?? []), ...(legacyOrders ?? [])]) unique.set(o.id, o);
        const candidateIds = [...unique.keys()];
        if (!candidateIds.length) return Response.json({ ok: true, processed: 0, sent: 0, failed: 0 });

        const { data: feedbackRows } = await supabaseAdmin
          .from("customer_feedback")
          .select("order_id,sent_at,submitted_at")
          .in("order_id", candidateIds);
        const done = new Set((feedbackRows ?? [])
          .filter((f: any) => f.order_id && (f.sent_at || f.submitted_at))
          .map((f: any) => f.order_id));

        let sent = 0;
        let failed = 0;
        let skipped = 0;
        for (const orderId of candidateIds) {
          if (done.has(orderId)) { skipped++; continue; }
          try {
            const result = await sendSatisfactionForOrder({ supabaseAdmin, orderId, origin });
            if (result.ok && !result.alreadySent) sent++;
            else if (!result.ok) failed++;
            else skipped++;
          } catch (err) {
            failed++;
            console.error("[satisfaction-auto] erro", { orderId, err });
          }
        }

        return Response.json({ ok: true, processed: candidateIds.length, sent, failed, skipped });
      },
    },
  },
});

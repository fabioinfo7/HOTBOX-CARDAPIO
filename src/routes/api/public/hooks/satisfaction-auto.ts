import { createFileRoute } from "@tanstack/react-router";

// Chamado pelo pg_cron a cada minuto.
//
// A contagem de 10 minutos NÃO fica no navegador e NÃO depende do painel estar
// aberto. O banco grava `satisfaction_due_at = delivered_at + 10 minutos`
// exatamente quando o pedido muda para "delivered". Este hook só processa
// pedidos cujo horário venceu.
//
// Idempotência:
// - customer_feedback.sent_at impede convite duplicado;
// - orders.satisfaction_auto_sent_at marca processamento automático concluído;
// - falha de WhatsApp mantém o pedido pendente para uma próxima tentativa.
export const Route = createFileRoute("/api/public/hooks/satisfaction-auto")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: cfg } = await supabaseAdmin
          .from("store_config")
          .select("app_public_url")
          .maybeSingle();

        let origin = String(cfg?.app_public_url ?? "").replace(/\/$/, "");
        if (!origin) {
          try {
            origin = new URL(request.url).origin;
          } catch {
            origin = "";
          }
        }

        if (!origin) {
          return Response.json(
            { ok: false, error: "app_public_url não configurada" },
            { status: 500 },
          );
        }

        const nowISO = new Date().toISOString();

        const { data: dueOrders, error: dueError } = await supabaseAdmin
          .from("orders")
          .select("id,satisfaction_due_at,satisfaction_auto_sent_at,status")
          .eq("status", "delivered")
          .not("satisfaction_due_at", "is", null)
          .is("satisfaction_auto_sent_at", null)
          .lte("satisfaction_due_at", nowISO)
          .order("satisfaction_due_at", { ascending: true })
          .limit(100);

        if (dueError) {
          return Response.json(
            { ok: false, error: dueError.message },
            { status: 500 },
          );
        }

        if (!dueOrders?.length) {
          return Response.json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0 });
        }

        const { sendSatisfactionForOrder } = await import("@/lib/satisfaction.server");

        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (const order of dueOrders) {
          try {
            const result = await sendSatisfactionForOrder({
              supabaseAdmin,
              orderId: order.id,
              origin,
            });

            if (result.ok) {
              // Se já havia sido enviado manualmente, também considera resolvido:
              // não há motivo para tentar de novo.
              await supabaseAdmin
                .from("orders")
                .update({
                  satisfaction_auto_sent_at: new Date().toISOString(),
                })
                .eq("id", order.id)
                .is("satisfaction_auto_sent_at", null);

              if (result.alreadySent) skipped++;
              else sent++;
            } else {
              failed++;
              console.error("[satisfaction-auto] envio falhou", {
                orderId: order.id,
                error: result.error,
              });
            }
          } catch (err) {
            failed++;
            console.error("[satisfaction-auto] erro inesperado", {
              orderId: order.id,
              err,
            });
          }
        }

        return Response.json({
          ok: true,
          processed: dueOrders.length,
          sent,
          failed,
          skipped,
        });
      },
    },
  },
});

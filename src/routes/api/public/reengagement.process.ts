import { createFileRoute } from "@tanstack/react-router";
import { sendEvolutionMarketingText } from "@/lib/whatsapp-send.server";
// ============================================================
// Endpoint: GET /api/protected/reengagement/process
// Caminho:  src/routes/api/public/reengagement.process.ts
//
// Processa a fila reengagement_queue: envia mensagem de retorno
// para contatos que chegaram ~21h atrás e ainda não compraram.
//
// Chamada a cada 15 min via:
//   - pg_net (Supabase): SELECT net.http_get(url, headers)
//   - cron externo: cron-job.org (gratuito) GET nessa URL
//   - ou manualmente pelo painel em /loja/config (botão "Processar fila")
//
// Autenticação: header obrigatório
//   x-internal-key: <INTERNAL_API_KEY>  (variável de ambiente no Supabase)
// ============================================================


/** Intervalo aleatório entre envios para evitar ban (4–9 segundos) */
const randomDelay = () =>
  new Promise<void>((r) => setTimeout(r, 4000 + Math.round(Math.random() * 5000)));

/**
 * Mensagem enviada para quem entrou em contato mas não comprou.
 * Personalize à vontade — pode incluir o nome do cliente usando
 * template literals com `job.customer_name` se adicionar o campo
 * ao SELECT abaixo.
 */
const MENSAGEM_REENGAJAMENTO = `Olá! 👋

Vi que você entrou em contato mas não finalizou o pedido.

Posso te ajudar com alguma dúvida ou montar seu pedido agora? 😊🍔`;

export const Route = createFileRoute("/api/public/reengagement/process")({
  server: {
    handlers: {
      GET: async ({ request }) => {
    // ── Autenticação por chave interna ──────────────────────────────
    const internalKey = process.env.INTERNAL_API_KEY;
    if (!internalKey) {
      return new Response(
        "INTERNAL_API_KEY não configurada nas variáveis de ambiente",
        { status: 500 },
      );
    }
    if (request.headers.get("x-internal-key") !== internalKey) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ── Busca jobs pendentes com scheduled_for <= agora ─────────────
    const { data: jobs, error: fetchErr } = await supabaseAdmin
      .from("reengagement_queue")
      .select("id, phone, conversation_id")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(50); // processa no máximo 50 por rodada (~6–7 min de envio)

    if (fetchErr) {
      return Response.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!jobs?.length) {
      return Response.json({ processed: 0, sent: 0, cancelled: 0 });
    }

    let sent = 0;
    let cancelled = 0;

    for (const job of jobs) {
      // ── Verifica se comprou depois do agendamento ──────────────────
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("customer_phone", job.phone)
        .maybeSingle();

      if (order) {
        await supabaseAdmin
          .from("reengagement_queue")
          .update({
            status: "cancelled",
            cancel_reason: "cliente_comprou_antes_do_envio",
          })
          .eq("id", job.id);
        cancelled++;
        continue;
      }

      // ── Envia a mensagem ────────────────────────────────────────────
      const result = await sendEvolutionMarketingText(
        supabaseAdmin,
        job.phone,
        MENSAGEM_REENGAJAMENTO,
      );

      if (result.ok) {
        // Marca como enviado
        await supabaseAdmin
          .from("reengagement_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        // O envio promocional permanece somente na fila de reengajamento;
        // nunca cria mensagem nem atualiza o Chat do atendimento oficial.

        sent++;
      } else {
        // Falha no envio — mantém como pending para tentar na próxima rodada
        console.error(`[reengagement] Falha ao enviar para ${job.phone}`);
      }

      // ── Delay anti-ban entre cada envio ────────────────────────────
      await randomDelay();
    }

    return Response.json({
      processed: jobs.length,
      sent,
      cancelled,
      skipped: jobs.length - sent - cancelled,
    });
      },
    },
  },
});

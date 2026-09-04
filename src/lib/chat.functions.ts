import { createServerFn } from "@tanstack/react-start";
import { sendWhatsappText, sendWhatsappMedia, deleteWhatsappMessageForEveryone } from "./whatsapp-send.server";

async function touchConversation(supabaseAdmin: any, conversationId: string, preview: string) {
  await supabaseAdmin
    .from("whatsapp_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: preview.slice(0, 140),
    })
    .eq("id", conversationId);
}

/** Admin manda uma mensagem de texto pro cliente — assume automaticamente a conversa (pausa o robô). */
export const sendChatText = createServerFn({ method: "POST" })
  .inputValidator((data: { conversationId: string; phone: string; text: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let externalId: string | undefined;
    try {
      const result = await sendWhatsappText(supabaseAdmin, data.phone, data.text);
      if (!result.ok) return { error: "Falha ao enviar pelo WhatsApp — confira o provedor em /loja/config." };
      externalId = result.externalId;
    } catch (err: any) {
      return { error: "Falha ao enviar pelo WhatsApp: " + String(err?.message ?? err) };
    }

    await supabaseAdmin.from("whatsapp_messages").insert({
      conversation_id: data.conversationId,
      direction: "out",
      sender_type: "admin",
      body: data.text,
      external_id: externalId ?? null,
    });
    await supabaseAdmin.from("whatsapp_conversations").update({ bot_paused: true }).eq("id", data.conversationId);
    await touchConversation(supabaseAdmin, data.conversationId, data.text);

    return { ok: true };
  });

/** Admin manda uma imagem/vídeo/áudio/documento (já upado no storage) pro cliente. */
export const sendChatMedia = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      conversationId: string;
      phone: string;
      mediaUrl: string;
      mediaType: "image" | "video" | "audio" | "document";
      caption?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const result = await sendWhatsappMedia(supabaseAdmin, data.phone, data.mediaUrl, data.mediaType, data.caption);
    if (!result.ok) return { error: result.error };

    await supabaseAdmin.from("whatsapp_messages").insert({
      conversation_id: data.conversationId,
      direction: "out",
      sender_type: "admin",
      body: data.caption || null,
      media_url: data.mediaUrl,
      media_type: data.mediaType,
      external_id: result.externalId ?? null,
    });
    await supabaseAdmin.from("whatsapp_conversations").update({ bot_paused: true }).eq("id", data.conversationId);
    await touchConversation(supabaseAdmin, data.conversationId, `[${data.mediaType}]`);

    return { ok: true };
  });

/** Exclui uma conversa e todas as mensagens dela. */
export const deleteConversation = createServerFn({ method: "POST" })
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("whatsapp_messages").delete().eq("conversation_id", data.conversationId);
    const { error } = await supabaseAdmin.from("whatsapp_conversations").delete().eq("id", data.conversationId);
    if (error) return { error: error.message };
    return { ok: true };
  });

/** Lista de transmissão — manda a mesma mensagem (texto e/ou imagem) pra vários contatos de uma vez. */
export const broadcastMessage = createServerFn({ method: "POST" })
  .inputValidator((data: { phones: string[]; text: string; imageUrl?: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let sent = 0;
    const failed: string[] = [];

    for (const phone of data.phones) {
      try {
        let result: { ok: boolean; externalId?: string; error?: string };
        if (data.imageUrl) {
          // Envia imagem com legenda de texto opcional
          result = await sendWhatsappMedia(supabaseAdmin, phone, data.imageUrl, "image", data.text || undefined);
        } else {
          result = await sendWhatsappText(supabaseAdmin, phone, data.text);
        }

        if (!result.ok) {
          failed.push(phone);
          continue;
        }

        const preview = data.text ? data.text.slice(0, 140) : "[imagem]";
        const { data: conv } = await supabaseAdmin
          .from("whatsapp_conversations")
          .upsert(
            { phone, last_message_at: new Date().toISOString(), last_message_preview: preview },
            { onConflict: "phone" },
          )
          .select("id")
          .single();
        if (conv?.id) {
          await supabaseAdmin.from("whatsapp_messages").insert({
            conversation_id: conv.id,
            direction:   "out",
            sender_type: "admin",
            body:        data.text || null,
            media_url:   data.imageUrl || null,
            media_type:  data.imageUrl ? "image" : null,
            external_id: result.externalId ?? null,
          });
        }
        sent++;
        // intervalo variável — padrão regular é sinal de automação pro WhatsApp
        await new Promise((r) => setTimeout(r, 900 + Math.round(Math.random() * 1400)));
      } catch {
        failed.push(phone);
      }
    }

    return { ok: true, sent, failed };
  });

/** Apaga uma mensagem ENVIADA para todos.
 *  Primeiro revoga a mensagem no WhatsApp pela Evolution API. Somente depois
 *  marca deleted_at no banco para removê-la do painel. Se o WhatsApp rejeitar
 *  a revogação (mensagem antiga, ID ausente, provedor incompatível etc.), a
 *  mensagem permanece visível no painel para não dar a falsa impressão de que
 *  também sumiu para o cliente. */
export const deleteMessage = createServerFn({ method: "POST" })
  .inputValidator((data: { messageId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: message, error: messageError } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, external_id, deleted_at")
      .eq("id", data.messageId)
      .maybeSingle();
    if (messageError) return { error: messageError.message };
    if (!message) return { error: "Mensagem não encontrada." };
    if (message.deleted_at) return { ok: true };
    if (message.direction !== "out") {
      return { error: "Só é possível apagar para todos mensagens enviadas pela loja." };
    }
    if (!message.external_id) {
      return { error: "Esta mensagem não possui o ID retornado pelo WhatsApp e não pode ser apagada para o cliente." };
    }

    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("phone")
      .eq("id", message.conversation_id)
      .maybeSingle();
    if (conversationError) return { error: conversationError.message };
    if (!conversation?.phone) return { error: "Conversa/telefone da mensagem não encontrado." };

    const revoked = await deleteWhatsappMessageForEveryone(
      supabaseAdmin,
      conversation.phone,
      message.external_id,
    );
    if (!revoked.ok) return { error: revoked.error || "Não foi possível apagar a mensagem para todos." };

    const { error: deleteError } = await supabaseAdmin
      .from("whatsapp_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.messageId);
    if (deleteError) {
      // A revogação já aconteceu no WhatsApp. Não podemos desfazê-la, então
      // retornamos erro explícito para o painel recarregar depois.
      return { error: `Mensagem apagada no WhatsApp, mas falhou ao atualizar o painel: ${deleteError.message}` };
    }

    return { ok: true, deletedForEveryone: true };
  });

/** Envia mensagem de re-engajamento para uma lista de telefones manualmente
 *  selecionados pelo admin. Registra cada envio na reengagement_queue.
 *  Delay de 4–9s entre envios para evitar ban do WhatsApp. */
export const sendReengagementBatch = createServerFn({ method: "POST" })
  .inputValidator((data: { phones: string[]; message: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { phone: string; status: "sent" | "skipped" | "failed" }[] = [];

    for (const phone of data.phones) {
      // Verifica de novo se comprou entre a seleção e o envio
      const { data: order } = await supabaseAdmin
        .from("orders").select("id").eq("customer_phone", phone).maybeSingle();

      if (order) {
        await supabaseAdmin.from("reengagement_queue").insert({
          phone, scheduled_for: new Date().toISOString(),
          status: "cancelled", cancel_reason: "comprou_antes_do_envio",
        });
        results.push({ phone, status: "skipped" });
        continue;
      }

      const result = await sendWhatsappText(supabaseAdmin, phone, data.message);

      // Busca a conversa para registrar no histórico do chat
      const { data: conv } = await supabaseAdmin
        .from("whatsapp_conversations").select("id").eq("phone", phone).maybeSingle();

      if (result.ok) {
        await supabaseAdmin.from("reengagement_queue").insert({
          phone, conversation_id: conv?.id ?? null,
          scheduled_for: new Date().toISOString(),
          sent_at: new Date().toISOString(), status: "sent",
        });
        if (conv?.id) {
          await supabaseAdmin.from("whatsapp_messages").insert({
            conversation_id: conv.id, direction: "out", sender_type: "admin",
            body: data.message, external_id: result.externalId ?? null,
          });
        }
        results.push({ phone, status: "sent" });
      } else {
        results.push({ phone, status: "failed" });
      }

      // Delay anti-ban: 4–9s aleatório entre cada envio
      await new Promise((r) => setTimeout(r, 4000 + Math.round(Math.random() * 5000)));
    }

    return { results, sent: results.filter((r) => r.status === "sent").length };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Janela 24h — broadcast para contatos dentro da janela gratuita do Meta API
// Estratégia anti-ban inteligente com delays variados por posição na fila.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o delay em ms para o envio da mensagem de índice `i`.
 *
 * Padrão humano simulado:
 *   - Base: 10–20 s aleatório entre cada mensagem
 *   - A cada 5 mensagens: pausa extra de 30–50 s  (café, olhar a tela…)
 *   - A cada 15 mensagens: pausa longa de 90–120 s (parou pra fazer outra coisa)
 *   - Variação de ±20% sobre a base (nunca dois envios no mesmo intervalo exato)
 */
function _windowDelay(i: number): number {
  const base   = 10_000 + Math.random() * 10_000;          // 10–20 s
  const vary   = base * (Math.random() * 0.4 - 0.2);       // ±20%
  const five   = i > 0 && i % 5 === 0
                   ? 30_000 + Math.random() * 20_000        // 30–50 s extra
                   : 0;
  const fifteen = i > 0 && i % 15 === 0
                   ? 90_000 + Math.random() * 30_000        // 90–120 s extra
                   : 0;
  return Math.round(base + vary + five + fifteen);
}

export const sendWindowBroadcast = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { phones: string[]; text: string; imageUrl: string }) => data,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Valida janela: só aceita contatos com last_message_at nas últimas 22h30
    const hardLimit = new Date(Date.now() - 22.5 * 60 * 60 * 1000).toISOString();

    const log: { phone: string; status: "ok" | "skip" | "err" }[] = [];
    let sent = 0, skipped = 0, failed = 0;

    for (let i = 0; i < data.phones.length; i++) {
      const phone = data.phones[i];

      // Revalida janela em tempo real (o envio pode demorar minutos)
      const { data: conv } = await supabaseAdmin
        .from("whatsapp_conversations")
        .select("id, last_message_at")
        .eq("phone", phone)
        .gte("last_message_at", hardLimit)   // hard cap 22h30
        .maybeSingle();

      if (!conv) {
        // Contato saiu da janela enquanto aguardava o turno — pula sem errar
        log.push({ phone, status: "skip" });
        skipped++;
        continue;
      }

      try {
        if (data.imageUrl) {
          // Envia imagem com legenda opcional
          await sendWhatsappMedia(supabaseAdmin, phone, data.imageUrl, "image", data.text || undefined);
        } else {
          await sendWhatsappText(supabaseAdmin, phone, data.text);
        }

        // Registra no histórico da conversa para aparecer no painel
        if (conv.id) {
          await supabaseAdmin.from("whatsapp_messages").insert({
            conversation_id: conv.id,
            direction:       "out",
            sender_type:     "admin",
            body:            data.text || null,
            media_url:       data.imageUrl || null,
            media_type:      data.imageUrl ? "image" : null,
          });
        }

        log.push({ phone, status: "ok" });
        sent++;
      } catch {
        log.push({ phone, status: "err" });
        failed++;
      }

      // Delay anti-ban — só aplica se ainda há próximo envio
      if (i < data.phones.length - 1) {
        await new Promise((r) => setTimeout(r, _windowDelay(i)));
      }
    }

    return { sent, skipped, failed, log };
  });

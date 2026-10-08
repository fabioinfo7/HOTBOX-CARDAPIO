import { createFileRoute } from "@tanstack/react-router";
import {
  loadMetaConfig,
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
  metaDownloadMediaAsBase64,
} from "@/lib/meta-whatsapp-api.server";
import { logApi } from "@/lib/api-log.server";

// Webhook oficial da Meta Cloud API. Configure no App do Meta for Developers
// (WhatsApp → Configuration → Webhook):
//   URL de callback: https://SEU-DOMINIO/api/public/webhooks/meta
//   Verify token: o mesmo que você colocar em /loja/config → "Verify Token"
//   Campo (webhook field) pra assinar: "messages"
//
// ESTRATÉGIA: em vez de duplicar toda a lógica de IA/cardápio/pedido (que já
// existe e está testada em produção pra Evolution), este webhook só faz a
// tradução do formato da Meta pro formato que o webhook da Evolution espera,
// e encaminha internamente pra lá. A decisão de COMO responder (Evolution ou
// Meta) já é tratada à parte, em src/lib/whatsapp-send.server.ts, com base
// em store_config.whatsapp_provider — então a resposta sai pelo canal certo
// mesmo a mensagem tendo entrado por aqui.

export const Route = createFileRoute("/api/public/webhooks/meta")({
  server: {
    handlers: {
      // ============ handshake de verificação (a Meta chama isso UMA vez, ao salvar o webhook) ============
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cfg = await loadMetaConfig(supabaseAdmin);
        const url = new URL(request.url);
        if (!cfg?.verifyToken)
          return new Response("meta_verify_token não configurado em /loja/config", { status: 500 });
        const challenge = verifyMetaWebhookChallenge(url.searchParams, cfg.verifyToken);
        if (!challenge) return new Response("verification failed", { status: 403 });
        return new Response(challenge, { status: 200 });
      },

      // ============ mensagens recebidas ============
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const rawBody = await request.text();
        let payload: any;
        try {
          payload = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          return new Response("bad json", { status: 400 });
        }
        if (!payload) return new Response("empty", { status: 400 });

        const cfg = await loadMetaConfig(supabaseAdmin);
        if (!cfg) {
          await logApi(supabaseAdmin, {
            source: "meta_webhook",
            direction: "in",
            response_status: 500,
            error_message: "Meta Cloud API não configurada em /loja/config",
          });
          return new Response("not configured", { status: 500 });
        }

        // assinatura — confirma que a requisição realmente veio da Meta
        if (cfg.appSecret) {
          const signature = request.headers.get("x-hub-signature-256");
          const validSig = await verifyMetaSignature(rawBody, signature, cfg.appSecret);
          if (!validSig) {
            await logApi(supabaseAdmin, {
              source: "meta_webhook",
              direction: "in",
              response_status: 401,
              error_message: "X-Hub-Signature-256 não bateu — confira o App Secret em /loja/config",
            });
            return new Response("unauthorized", { status: 401 });
          }
        }

        const value = payload?.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        // ============ CONFIRMAÇÃO DE LEITURA ============
        // Evento de status (entregue/lido) — a Meta manda os wamid das
        // mensagens enviadas por nós junto com o novo status. "read" é o
        // que marca como lida pelo cliente; os outros ("sent", "delivered",
        // "failed") só são ignorados aqui.
        if (!message && Array.isArray(value?.statuses)) {
          for (const status of value.statuses) {
            if (status?.status === "read" && status?.id) {
              try {
                await supabaseAdmin
                  .from("whatsapp_messages")
                  .update({ read_at: new Date().toISOString() })
                  .eq("external_id", status.id)
                  .is("read_at", null);
              } catch (err) {
                console.error("[meta webhook] falha ao gravar confirmação de leitura:", err);
              }
            }
          }
          return Response.json({ ok: true, statuses: value.statuses.length });
        }

        // eventos de status (entregue/lido) e outros que não são mensagem nova — ignora
        if (!message) {
          return Response.json({ ignored: "no_message", has_statuses: !!value?.statuses });
        }

        const phone: string = message.from; // já vem como dígitos com DDI, ex: "5521999999999"
        const pushName: string = value?.contacts?.[0]?.profile?.name ?? "";
        const messageId: string = message.id;

        // ============ DEDUPLICAÇÃO ============
        // Se essa mensagem já foi processada antes (reenvio da Meta por
        // demora na resposta), para aqui — não reprocessa, não responde de
        // novo. Isso é o que evita o loop de respostas duplicadas.
        const { error: dedupError } = await supabaseAdmin
          .from("meta_processed_messages")
          .insert({ message_id: messageId });
        if (dedupError) {
          // já existe essa message_id = já processamos antes; ignora silenciosamente
          return Response.json({ ok: true, duplicate: true });
        }

        // guarda o wamid da mensagem recebida — necessário pro indicador de
        // "digitando..." oficial na hora de responder (ver whatsapp-send.server.ts)
        await supabaseAdmin
          .from("whatsapp_conversations")
          .upsert({ phone, last_inbound_meta_message_id: messageId }, { onConflict: "phone" });

        // ============ RASTREAMENTO DE ANÚNCIO (Click-to-WhatsApp) ============
        // A Meta envia o campo "referral" quando a mensagem foi iniciada por
        // clique em um anúncio. Ele contém o ctwa_clid (Click-to-WhatsApp ID)
        // que é o identificador chave para atribuição na Conversions API.
        // Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components#referral-object
        const referral = message?.referral;
        if (referral?.ctwa_clid) {
          try {
            // Busca a conversa para verificar se já foi rastreada
            const { data: conv } = await supabaseAdmin
              .from("whatsapp_conversations")
              .select("id, ctwa_clid, capi_lead_sent_at")
              .eq("phone", phone)
              .maybeSingle();

            const conversationId: string | undefined = conv?.id;

            // Salva os dados do anúncio na conversa (mesmo se já existir — atualiza)
            if (conversationId) {
              await supabaseAdmin
                .from("whatsapp_conversations")
                .update({
                  ad_source: "ctwa",
                  ctwa_clid: referral.ctwa_clid,
                  ad_id: referral.source_id ?? null,
                  ad_title: referral.headline ?? null,
                  referral_source_url: referral.source_url ?? null,
                })
                .eq("id", conversationId);
            }

            // Dispara evento Lead no CAPI apenas se ainda não foi enviado pra esta conversa
            // (evita duplicatas se o lead mandar várias mensagens com referral)
            if (!conv?.capi_lead_sent_at) {
              const { fireLeadEvent } = await import("@/lib/meta-capi.server");
              await fireLeadEvent(supabaseAdmin, {
                phone,
                name: pushName || undefined,
                ctwaClid: referral.ctwa_clid,
                conversationId,
              });
            }
          } catch (err) {
            // Rastreamento não pode jamais travar o atendimento
            console.error("[meta webhook] erro ao salvar referral/CAPI:", err);
          }
        }

        // ============ monta o payload no formato que o webhook da Evolution já entende ============
        let evolutionShaped: any;

        if (message.type === "image" && message.image?.id) {
          const media = await metaDownloadMediaAsBase64(cfg, message.image.id);
          if (!media) {
            await logApi(supabaseAdmin, {
              source: "meta_webhook",
              direction: "in",
              response_status: 500,
              error_message: `Falha ao baixar imagem (media_id ${message.image.id})`,
            });
            return Response.json({ ok: false, error: "download_failed" });
          }
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: {
                imageMessage: { mimetype: media.mimeType, caption: message.image.caption || null },
                base64: media.base64,
              },
            },
          };
        } else if (message.type === "text" && message.text?.body) {
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: { conversation: message.text.body },
            },
          };
        } else if (message.type === "document" && message.document?.id) {
          const media = await metaDownloadMediaAsBase64(cfg, message.document.id);
          if (!media) {
            await logApi(supabaseAdmin, {
              source: "meta_webhook",
              direction: "in",
              response_status: 500,
              error_message: `Falha ao baixar documento (media_id ${message.document.id})`,
            });
            return Response.json({ ok: false, error: "download_failed" });
          }
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: {
                documentMessage: {
                  mimetype: media.mimeType,
                  fileName: message.document.filename || null,
                  caption: message.document.caption || null,
                },
                base64: media.base64,
              },
            },
          };
        } else if (message.type === "audio" && message.audio?.id) {
          const media = await metaDownloadMediaAsBase64(cfg, message.audio.id);
          if (!media) {
            await logApi(supabaseAdmin, {
              source: "meta_webhook",
              direction: "in",
              response_status: 500,
              error_message: `Falha ao baixar áudio (media_id ${message.audio.id})`,
            });
            return Response.json({ ok: false, error: "download_failed" });
          }
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: {
                audioMessage: { mimetype: media.mimeType },
                base64: media.base64,
              },
            },
          };
        } else if (message.type === "location" && message.location) {
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: {
                locationMessage: {
                  degreesLatitude: message.location.latitude,
                  degreesLongitude: message.location.longitude,
                  name: message.location.name || null,
                  address: message.location.address || null,
                },
              },
            },
          };
        } else if (message.type === "video" && message.video?.id) {
          const media = await metaDownloadMediaAsBase64(cfg, message.video.id);
          if (!media) {
            await logApi(supabaseAdmin, {
              source: "meta_webhook",
              direction: "in",
              response_status: 500,
              error_message: `Falha ao baixar vídeo (media_id ${message.video.id})`,
            });
            return Response.json({ ok: false, error: "download_failed" });
          }
          evolutionShaped = {
            event: "messages.upsert",
            data: {
              key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
              pushName,
              message: {
                videoMessage: {
                  mimetype: media.mimeType,
                  caption: message.video.caption || null,
                },
                base64: media.base64,
              },
            },
          };
        } else {
          // figurinha, localização, reação, etc — tipos sem tratamento
          // Registra o payload bruto pra diagnosticar em Configurações → Logs
          await logApi(supabaseAdmin, {
            source: "meta_webhook",
            direction: "in",
            request_payload: { phone, message },
            response_status: 200,
            response_body: `tipo "${message.type}" recebido e ignorado`,
          });
          return Response.json({ ignored: message.type });
        }

        // ============ processa direto, no mesmo processo — reaproveita 100% da lógica de IA/pedido ============
        // ANTES isso era um fetch() do servidor pro seu próprio domínio público
        // (self-referencial). Em vários provedores de hospedagem (Railway
        // incluso) o contêiner não consegue alcançar seu próprio domínio
        // público de dentro pra fora — a chamada trava esperando resposta
        // pra sempre, sem nunca dar erro nem sucesso, e a mensagem nunca é
        // processada (nem logada, porque o código nem chega a continuar).
        // Chamar a função diretamente, sem passar pela rede, elimina esse
        // problema por completo.
        try {
          const { handleIncomingMessage } = await import("./webhooks.evolution");
          return await handleIncomingMessage(evolutionShaped, { skipEvolutionKillSwitch: true });
        } catch (err: any) {
          await logApi(supabaseAdmin, {
            source: "meta_webhook",
            direction: "in",
            response_status: 500,
            error_message: String(err?.message ?? err),
          });
          return new Response("processing failed", { status: 500 });
        }
      },
    },
  },
});

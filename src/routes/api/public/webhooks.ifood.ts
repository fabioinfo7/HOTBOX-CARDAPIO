import { createFileRoute } from "@tanstack/react-router";
import { logApi } from "@/lib/api-log.server";
import {
  classifyIfoodEvent,
  createOrderFromIfoodPayload,
  getIfoodAccessToken,
  processIfoodEvent,
} from "@/lib/ifood-api.server";

const WEBHOOK_VERSION = "HOTBOX_IFOOD_WEBHOOK_V30_KEEPALIVE_IDEMPOTENT_20260908";

function normalizeCode(payload: any) {
  const code = String(payload?.code ?? "").trim().toUpperCase();
  const fullCode = String(payload?.fullCode ?? "").trim().toUpperCase();
  return { code, fullCode, combined: `${code} ${fullCode}`.trim() };
}

function looksLikeFullOrder(payload: any) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      String(payload?.id ?? "").trim() &&
      Array.isArray(payload?.items) &&
      payload.items.length > 0 &&
      !String(payload?.code ?? payload?.fullCode ?? "").trim(),
  );
}

async function claimWebhookEvent(supabaseAdmin: any, payload: any) {
  const eventId = String(payload?.id ?? "").trim();
  if (!eventId) return { duplicate: false, eventId: null as string | null };

  const { code, fullCode } = normalizeCode(payload);
  const { error } = await supabaseAdmin.from("ifood_webhook_events").insert({
    event_id: eventId,
    code: code || null,
    full_code: fullCode || null,
    order_id: payload?.orderId ? String(payload.orderId) : null,
    payload,
  });

  if (!error) return { duplicate: false, eventId };

  // 23505 = unique violation. Qualquer outro erro (ex.: migration ainda não
  // aplicada) não derruba a homologação; as outras barreiras continuam ativas.
  if (String(error?.code ?? "") === "23505") return { duplicate: true, eventId };

  console.warn("[ifood-webhook] tabela de eventos indisponível; seguindo com demais guardas", error?.message);
  return { duplicate: false, eventId };
}

export const Route = createFileRoute("/api/public/webhooks/ifood")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          service: "hotbox-ifood-webhook",
          version: WEBHOOK_VERSION,
        }),

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const payload: any = await request.json().catch(() => ({}));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin
          .from("store_config")
          .select("ifood_webhook_secret")
          .eq("id", 1)
          .maybeSingle();

        const receivedToken = String(url.searchParams.get("token") ?? "");
        const expectedToken = String(cfg?.ifood_webhook_secret ?? "");
        if (!expectedToken || receivedToken !== expectedToken) {
          await logApi(supabaseAdmin, {
            source: "ifood_webhook",
            direction: "in",
            response_status: 401,
            error_message: "Webhook iFood recusado: token inválido",
            request_payload: payload,
            event_type: String(payload?.fullCode ?? payload?.code ?? "UNKNOWN"),
          });
          return Response.json({ ok: false, error: "unauthorized", version: WEBHOOK_VERSION }, { status: 401 });
        }

        const { code, fullCode, combined } = normalizeCode(payload);

        await logApi(supabaseAdmin, {
          source: "ifood_webhook",
          direction: "in",
          response_status: 200,
          request_payload: payload,
          order_id: payload?.orderId ?? null,
          event_type: fullCode || code || "UNKNOWN",
          response_body: `Webhook recebido (${fullCode || code || "sem código"}) — ${WEBHOOK_VERSION}`,
        });

        // ================================================================
        // KEEPALIVE DA HOMOLOGAÇÃO
        // ================================================================
        // O iFood usa esse evento apenas para testar se a URL está viva.
        // A resposta obrigatória aqui é 200; NUNCA é pedido e NUNCA deve chegar
        // em createOrderFromIfoodPayload.
        if (code === "KEEPALIVE" || fullCode === "KEEPALIVE" || combined.includes("KEEPALIVE")) {
          console.info("[ifood-webhook] KEEPALIVE recebido e respondido com 200", {
            eventId: payload?.id ?? null,
            version: WEBHOOK_VERSION,
          });
          return Response.json(
            {
              ok: true,
              received: true,
              keepalive: true,
              ignored_for_order_creation: true,
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        // Deduplica o mesmo eventId enviado mais de uma vez pelo iFood.
        const claim = await claimWebhookEvent(supabaseAdmin, payload);
        if (claim.duplicate) {
          return Response.json(
            {
              ok: true,
              received: true,
              duplicate_event: true,
              event_id: claim.eventId,
              version: WEBHOOK_VERSION,
            },
            { status: 200 },
          );
        }

        // Compatibilidade: caso um integrador envie o pedido completo direto
        // no webhook, só aceitamos se houver itens e NÃO houver code/fullCode.
        if (looksLikeFullOrder(payload)) {
          const created = await createOrderFromIfoodPayload(supabaseAdmin, payload);
          return Response.json({ ok: true, received: true, result: created, version: WEBHOOK_VERSION }, { status: 200 });
        }

        const classification = classifyIfoodEvent(payload);

        // Somente PLC / PLACED têm autorização para iniciar criação de pedido.
        if (classification.category === "new_order") {
          const orderId = String(payload?.orderId ?? "").trim();
          if (!orderId) {
            return Response.json(
              {
                ok: true,
                received: true,
                ignored: true,
                reason: "placed_event_without_order_id",
                version: WEBHOOK_VERSION,
              },
              { status: 200 },
            );
          }

          const token = await getIfoodAccessToken(supabaseAdmin);
          if (!token) {
            // 503 faz o iFood tentar novamente um evento de pedido real.
            return Response.json({ ok: false, retry: true, reason: "ifood_auth_unavailable", version: WEBHOOK_VERSION }, { status: 503 });
          }

          const processed = await processIfoodEvent(supabaseAdmin, token, payload);
          return Response.json(
            { ok: true, received: true, processed: processed.processed, category: classification.category, version: WEBHOOK_VERSION },
            { status: 200 },
          );
        }

        // Eventos de status/cancelamento do pedido já conhecido podem ser
        // processados pela mesma lógica do polling. Eventos desconhecidos são
        // apenas reconhecidos com 200, sem mutação e, principalmente, sem criar pedido.
        if (classification.category !== "unknown" && payload?.orderId) {
          const token = await getIfoodAccessToken(supabaseAdmin);
          if (token) {
            const processed = await processIfoodEvent(supabaseAdmin, token, payload);
            return Response.json(
              { ok: true, received: true, processed: processed.processed, category: classification.category, version: WEBHOOK_VERSION },
              { status: 200 },
            );
          }
        }

        return Response.json(
          {
            ok: true,
            received: true,
            ignored: true,
            reason: classification.category === "unknown" ? "non_order_event" : "event_without_order_id",
            code,
            fullCode,
            version: WEBHOOK_VERSION,
          },
          { status: 200 },
        );
      },
    },
  },
});

Warning: truncated output (original token count: 91610)
Total output lines: 7239

import { createFileRoute } from "@tanstack/react-router";
import { calculateDeliveryFee, type DeliveryConfig } from "@/lib/delivery-distance.server";
import { normalizeStreet, similarity } from "@/lib/zonas-entrega.server";
import { brl, orderNumberFmt } from "@/lib/formatters";
import { sendWhatsappText, sendWhatsappMedia } from "@/lib/whatsapp-send.server";
import { isWithinBusinessHours, formatBusinessHoursText, type BusinessHourRange } from "@/lib/business-hours";
import { getEffectivePrice } from "@/lib/promotions";
import { requestSilentHumanHandoff } from "@/lib/human-handoff.server";

// Envia todas as imagens do cardápio cadastradas em /loja/config → Imagens do
// cardápio, uma de cada vez, com um pequeno intervalo. Quando o cliente pede
// explicitamente o cardápio/menu, a imagem pode ser enviada independentemente
// do bairro. Esse envio nunca deve incluir links de iFood/99Food.
async function sendMenuImagesOnce(
  supabaseAdmin: any,
  conversationId: string,
  phone: string,
  force = false,   // true = cliente pediu explicitamente → envia mesmo se já enviou antes
): Promise<void> {
  try {
    if (!force) {
      // Verifica se o cardápio em imagem já foi enviado nesta conversa.
      // Impede reenvio em caso de race-condition (2 mensagens chegando juntas)
      // ou de o bot enviar de novo sem o cliente ter pedido.
      const { count } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("direction", "out")
        .not("media_url", "is", null)
        .eq("media_type", "image");
      if ((count ?? 0) > 0) return; // já enviou — não repete
    }

    const { data: imgs } = await supabaseAdmin
      .from("menu_images")
      .select("url")
      .order("created_at", { ascending: true });
    const urls: string[] = (imgs ?? []).map((i: any) => i.url).filter(Boolean);
    if (!urls.length) return;
    for (let i = 0; i < urls.length; i++) {
      const res = await sendWhatsappMedia(supabaseAdmin, phone, urls[i], "image", i === 0 ? "Cardápio 👇" : undefined);
      if (res.ok) {
        await supabaseAdmin.from("whatsapp_messages").insert({
          conversation_id: conversationId,
          direction: "out",
          sender_type: "bot",
          body: i === 0 ? "Cardápio 👇" : null,
          media_url: urls[i],
          media_type: "image",
          external_id: res.externalId ?? null,
        });
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch {
    /* falha silenciosa — não trava o atendimento se o storage/CDN estiver instável */
  }
}

// Evolution API manda os eventos de mensagem aqui.
// Fluxo:
//  1. Registra a conversa e a mensagem recebida no histórico do chat.
//  2. Se o admin já assumiu a conversa (bot_paused), não responde nada — só loga.
//  3. Se for imagem, tenta ler como comprovante de Pix.
//  4. Se for texto, roda a IA conversacional (com memória do pedido em construção,
//     cardápio e estoque ao vivo) até coletar tudo e fechar o pedido.

// ============================================================
// IA com failover automático: o ChatGPT (OpenAI) é o provedor PRINCIPAL —
// sempre é o primeiro tentado. Se a chave da OpenAI não estiver configurada,
// falhar ou ficar sem crédito, o sistema tenta automaticamente a chave do
// Groq cadastrada como reserva, na mesma requisição, sem o cliente perceber.
// Cadastre as duas chaves em /loja/config (Configurações → IA / Failover).
// ============================================================

type AiProvider = "openai" | "groq1";

const AI_PROVIDERS: Record<AiProvider, { endpoint: string; model: string; visionModel: string }> = {
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    visionModel: "gpt-4o-mini",
  },
  groq1: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    visionModel: "llama-3.2-90b-vision-preview",
  },
};

async function loadAiState(supabaseAdmin: any): Promise<{ openaiKey: string | null; groqKey: string | null; temperature: number }> {
  let { data, error } = await supabaseAdmin
    .from("store_config")
    .select("openai_api_key, groq_api_key, ai_temperature")
    .maybeSingle();
  // Compatibilidade enquanto a migration de ai_temperature ainda não foi
  // aplicada: preserva as chaves e usa 0.2 como padrão seguro.
  if (error) {
    const fallback = await supabaseAdmin
      .from("store_config")
      .select("openai_api_key, groq_api_key")
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, ai_temperature: 0.2 } : null;
  }
  const rawTemperature = Number(data?.ai_temperature ?? 0.2);
  return {
    openaiKey: data?.openai_api_key || null,
    groqKey: data?.groq_api_key || null,
    temperature: Number.isFinite(rawTemperature) ? Math.max(0, Math.min(1, rawTemperature)) : 0.2,
  };
}

const AI_REQUEST_TIMEOUT_MS = 20000;

async function acquireWhatsappProcessingLock(supabaseAdmin: any, phone: string): Promise<boolean> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString();
    // limpa somente lock expirado deste telefone
    await supabaseAdmin
      .from("whatsapp_processing_locks")
      .delete()
      .eq("phone", phone)
      .lt("expires_at", now.toISOString());
    const { error } = await supabaseAdmin
      .from("whatsapp_processing_locks")
      .insert({ phone, expires_at: expiresAt });
    if (!error) return true;
    // 23505 = outra mensagem do mesmo cliente está sendo processada
    if (String(error.code) !== "23505") {
      // migration ainda não aplicada: não derruba o atendimento
      if (/whatsapp_processing_locks|schema cache|relation/i.test(String(error.message ?? ""))) return true;
      console.error("[conversation-lock] falha ao adquirir lock:", error);
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function releaseWhatsappProcessingLock(supabaseAdmin: any, phone: string): Promise<void> {
  try {
    await supabaseAdmin.from("whatsapp_processing_locks").delete().eq("phone", phone);
  } catch {
    /* best effort */
  }
}

function extractPhoneFromEvolutionPayload(payload: any): string | null {
  const rawData = payload?.data ?? payload?.message ?? payload;
  const data = Array.isArray(rawData?.messages) ? rawData.messages[0] : rawData;
  const remoteJid: string = data?.key?.remoteJid ?? "";
  if (!remoteJid || remoteJid.endsWith("@g.us")) return null;
  const phone = remoteJid.split("@")[0].replace(/\D/g, "");
  return phone || null;
}

/** Chama o chat completions do ChatGPT (principal); se falhar, tenta o Groq (reserva) na mesma requisição. */
async function callChatCompletion(supabaseAdmin: any, body: any, useVision = false): Promise<any | null> {
  const { openaiKey, groqKey, temperature } = await loadAiState(supabaseAdmin);

  const order: { provider: AiProvider; key: string | null }[] = [
    { provider: "openai", key: openaiKey },
    { provider: "groq1", key: groqKey },
  ];

  for (const { provider, key } of order) {
    if (!key) continue; // essa chave não está configurada, pula pro próximo provedor
    const cfg = AI_PROVIDERS[provider];

    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, temperature: body.temperature ?? temperature, model: useVision ? cfg.visionModel : cfg.model }),
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`[ai-failover] ${provider} respondeu ${res.status}: ${await res.text().catch(() => "")}`);
        continue;
      }
      if (provider !== "openai") {
        console.log(`[ai-failover] ChatGPT falhou, usando reserva: ${provider}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`[ai-failover] ${provider} falhou:`, err);
      continue;
    }
  }

  console.error("[ai-failover] ChatGPT e Groq (reserva) falharam ou não estão configurados");
  return null;
}

// ============================================================
// Utilidades de envio / storage
// ============================================================

async function sendWhatsappReply(phone: string, text: string): Promise<string | undefined> {
  // a decisão de qual provedor usar (Evolution ou Meta Cloud API) e toda a
  // humanização (pausa + "digitando...") ficam centralizadas em
  // src/lib/whatsapp-send.server.ts — aqui só delega
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = await sendWhatsappText(supabaseAdmin, phone, text);
  return result.externalId;
}

// ============================================================
// Conversa / histórico de chat (visível no painel em /loja/chat)
// ============================================================

async function getOrCreateConversation(supabaseAdmin: any, phone: string, pushName?: string) {
  const { data: existing, error: selectErr } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (selectErr) throw new Error(`Falha ao buscar conversa (whatsapp_conversations select): ${selectErr.message}`);
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("whatsapp_conversations")
    .insert({ phone, customer_name: pushName || null })
    .select("*")
    .single();
  if (insertErr) {
    // Duas primeiras mensagens podem chegar quase juntas. Se outro webhook
    // criou a conversa entre o SELECT e o INSERT, recupera a linha existente
    // em vez de transformar uma condição normal de concorrência em erro 500.
    if (String(insertErr.code) === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("whatsapp_conversations")
        .select("*")
        .eq("phone", phone)
        .maybeSingle();
      if (raced) return raced;
    }
    throw new Error(`Falha ao criar conversa (whatsapp_conversations insert): ${insertErr.message}`);
  }
  if (!created) throw new Error("whatsapp_conversations insert não retornou nenhuma linha");
  return created;
}

async function logMessage(
  supabaseAdmin: any,
  conversationId: string,
  patch: {
    direction: "in" | "out";
    sender_type: "customer" | "bot" | "admin";
    body?: string | null;
    media_url?: string | null;
    media_type?: string | null;
    external_id?: string | null;
  },
) {
  // IMPORTANTE: o cliente do Supabase NÃO lança exceção sozinho quando o
  // banco rejeita uma gravação (RLS, permissão, constraint) — ele só
  // devolve um campo `error`. Sem checar isso explicitamente, uma falha
  // aqui é 100% silenciosa: a mensagem "desaparece" (não é salva, não
  // aparece no chat do painel), mas o resto do fluxo continua normal como
  // se nada tivesse acontecido. Por isso agora verificamos e propagamos.
  const { error: insertErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .insert({ conversation_id: conversationId, ...patch });
  if (insertErr) {
    console.error("[logMessage] falha ao gravar mensagem:", insertErr.message);
    try {
      await supabaseAdmin.rpc("record_system_alert", {
        _kind: "whatsapp_message_log_failed",
        _message: `Mensagem do WhatsApp (${patch.direction}) não foi salva no histórico: ${insertErr.message}`,
        _severity: "error",
      });
    } catch {
      /* alerta não pode quebrar o fluxo */
    }
    throw new Error(`Falha ao gravar mensagem (whatsapp_messages insert): ${insertErr.message}`);
  }
  await supabaseAdmin
    .from("whatsapp_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: (patch.body || `[${patch.media_type ?? "mídia"}]`).slice(0, 140),
    })
    .eq("id", conversationId);
  if (patch.direction === "in") {
    const { data } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("unread_count")
      .eq("id", conversationId)
      .maybeSingle();
    await supabaseAdmin
      .from("whatsapp_conversations")
      .update({ unread_count: (data?.unread_count ?? 0) + 1, has_unread: true })
      .eq("id", conversationId);
  }
}

// ============================================================
// Helper: faz upload de mídia (base64) para o Supabase Storage
// bucket "chat-media" e devolve a URL pública permanente.
// Retorna null em caso de falha — não quebra o fluxo principal,
// a mensagem ainda é salva sem visualização de mídia no painel.
// ============================================================
async function uploadMediaToStorage(
  supabaseAdmin: any,
  base64: string,
  mimeType: string,
  conversationId: string,
  filename?: string,
): Promise<string | null> {
  try {
    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg"
      : mimeType.includes("png") ? "png"
      : mimeType.includes("gif") ? "gif"
      : mimeType.includes("webp") ? "webp"
      : mimeType.includes("pdf") ? "pdf"
      : mimeType.includes("mp4") ? "mp4"
      : mimeType.includes("ogg") || mimeType.includes("opus") ? "ogg"
      : mimeType.includes("mp3") ? "mp3"
      : mimeType.includes("wav") ? "wav"
      : mimeType.includes("mpeg") ? "mp3"
      : "bin";
    const safeName = filename
      ? filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)
      : `${Date.now()}.${ext}`;
    const storagePath = `${conversationId}/${Date.now()}-${safeName}`;
    const buffer = Buffer.from(base64, "base64");
    const { error } = await supabaseAdmin.storage
      .from("chat-media")
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (error) {
      console.error("[uploadMediaToStorage] erro ao fazer upload:", error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from("chat-media").getPublicUrl(storagePath);
    return data?.publicUrl ?? null;
  } catch (err: any) {
    console.error("[uploadMediaToStorage] exceção:", err?.message ?? err);
    return null;
  }
}

async function replyAndLog(
  supabaseAdmin: any,
  conversationId: string,
  phone: string,
  text: string,
  opts?: { systemMessage?: boolean },
) {
  const externalId = await sendWhatsappReply(phone, text);
  // Mensagens automáticas do sistema (comprovante do pedido, chave Pix, fallback)
  // são marcadas com media_type "system": aparecem normal no chat do painel, mas
  // FICAM FORA do histórico que a IA lê — se entram, o modelo passa a imitar o
  // estilo delas (emojis, blocos, apresentações) e repete padrão em loop.
  await logMessage(supabaseAdmin, conversationId, {
    direction: "out",
    sender_type: "bot",
    body: text,
    media_type: opts?.systemMessage ? "system" : null,
    external_id: externalId ?? null,
  });
}

// ============================================================
// Comprovante de Pix (imagem)
// ============================================================

async function analyzeReceipt(
  supabaseAdmin: any,
  imageBase64: string,
  mimeType: string,
): Promise<{ is_receipt: boolean; amount: number | null; confidence: "high" | "medium" | "low" }> {
  const fallback = { is_receipt: false, amount: null, confidence: "low" as const };

  const json = await callChatCompletion(
    supabaseAdmin,
    {
      messages: [
        {
          role: "system",
          content:
            "Você analisa imagens de comprovante de pagamento Pix enviadas por clientes de um delivery. Diga se a imagem É um comprovante de Pix concluído (não pendente, não agendado) e qual o valor pago.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Essa imagem é um comprovante de Pix já concluído? Qual o valor?",
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "register_receipt",
            description: "Registra a análise do comprovante",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                is_receipt: {
                  type: "boolean",
                  description: "true somente se for um comprovante de Pix CONCLUÍDO",
                },
                amount: {
                  type: "number",
                  description: "valor pago em reais, ou null se não identificado",
                },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["is_receipt", "confidence"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "register_receipt" } },
    },
    true,
  );

  if (!json) return fallback;
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return fallback;
  try {
    const parsed = JSON.parse(call.function.arguments);
    return {
      is_receipt: !!parsed.is_receipt,
      amount: parsed.amount ?? null,
      confidence: parsed.confidence ?? "low",
    };
  } catch {
    return fallback;
  }
}

async function handleReceiptImage(
  supabaseAdmin: any,
  conversationId: string,
  phone: string,
  imageBase64: string,
  mimeType: string,
) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, total, payment_status, status")
    .eq("customer_phone", phone)
    .eq("payment_method", "pix")
    .neq("payment_status", "paid")
    .not("status", "in", "(cancelled,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!order) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Recebi a imagem. Para eu conseguir te ajudar corretamente, me diga por texto o que você precisa.",
      { systemMessage: true },
    );
    return;
  }

  const analysis = await analyzeReceipt(supabaseAdmin, imageBase64, mimeType);
  if (!analysis.is_receipt) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Recebi a imagem. Se ela for referente ao seu pedido, me diga por texto o que você precisa.",
      { systemMessage: true },
    );
    return;
  }
  if (analysis.confidence === "low") {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      `Recebi o possível comprovante do pedido *${orderNumberFmt(order.order_number)}*. A loja vai conferir manualmente antes de confirmar o pagamento.`,
      { systemMessage: true },
    );
    return;
  }

  const path = `${order.id}/${Date.now()}.jpg`;
  const bytes = Buffer.from(imageBase64, "base64");
  await supabaseAdmin.storage.from("payment-receipts").upload(path, bytes, { contentType: mimeType, upsert: true });
  const { data: pub } = supabaseAdmin.storage.from("payment-receipts").getPublicUrl(path);

  const amountMatches = analysis.amount == null || Math.abs(analysis.amount - Number(order.total)) < 0.05;

  // A IA pode reconhecer que a imagem parece um comprovante, mas NÃO tem
  // autoridade para marcar o Pix como pago. Liquidação financeira só pode ser
  // confirmada por integração bancária ou por um operador humano.
  await supabaseAdmin
    .from("orders")
    .update({ payment_receipt_url: pub.publicUrl })
    .eq("id", order.id);

  await replyAndLog(
    supabaseAdmin,
    conversationId,
    phone,
    amountMatches
      ? `Recebi o comprovante do pedido *${orderNumberFmt(order.order_number)}*. A loja vai conferir o pagamento e confirmar por aqui.`
      : `Recebi o comprovante do pedido *${orderNumberFmt(order.order_number)}*, mas o valor identificado não bateu com o total (*${brl(order.total)}*). A loja vai conferir manualmente.`,
    { systemMessage: true },
  );
}

// ============================================================
// Cardápio e estoque ao vivo (o que a IA "sabe" sobre a loja)
// ============================================================

async function loadCatalogText(
  supabaseAdmin: any,
): Promise<{ catalogText: string; unavailableText: string; categoriesText: string }> {
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id,name,description,customer_ingredients,category,sale_price,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label")
    .eq("active", true)
    .order("category")
    .order("name");

  const { data: outIngredients } = await supabaseAdmin
    .from("ingredients")
    .select("id")
    .eq("track_stock", true)
    .lte("stock_quantity", 0);
  let unavailableNames: string[] = [];
  if (outIngredients?.length) {
    const ids = outIngredients.map((i: any) => i.id);
    const { data: affected } = await supabaseAdmin.from("recipe_items").select("product_id").in("ingredient_id", ids);
    const productIds = [...new Set((affected ?? []).map((r: any) => r.product_id))];
    if (productIds.length) {
      const { data: unavailableProducts } = await supabaseAdmin.from("products").select("name").in("id", productIds);
      unavailableNames = (unavailableProducts ?? []).map((p: any) => p.name);
    }
  }

  // Composição de cada produto (quais insumos entram nele) — assim a IA sabe
  // responder qualquer pergunta sobre ingredientes com segurança, sem nunca
  // precisar dizer que "não tem essa informação".
  const productIds = (products ?? []).map((p: any) => p.id);
  const ingredientsByProduct: Record<string, string[]> = {};
  if (productIds.length) {
    const { data: recipeRows } = await supabaseAdmin
      .from("recipe_items")
      .select("product_id, ingredient_id, ingredients(name)")
      .in("product_id", productIds);
    for (const row of recipeRows ?? []) {
      const ingName = row.ingredients?.name;
      if (!ingName) continue;
      (ingredientsByProduct[row.product_id] ||= []).push(ingName);
    }
  }

  const availableProducts = (products ?? []).filter((p: any) => !unavailableNames.includes(p.name));

  // Adicionais estruturados vinculados a cada produto. A IA recebe somente
  // opções realmente cadastradas e ativas, com preço atual.
  const addonsByProduct: Record<string, Array<{ name: string; price: number }>> = {};
  if (productIds.length) {
    const [{ data: links }, { data: groups }, { data: options }] = await Promise.all([
      supabaseAdmin.from("product_addon_groups").select("product_id,group_id").in("product_id", productIds),
      supabaseAdmin.from("menu_addon_groups").select("id,active").eq("active", true),
      supabaseAdmin.from("menu_addon_options").select("id,group_id,name,display_name,price,linked_product_id,use_linked_product_price,active").eq("active", true),
    ]);

    const linkedIds = Array.from(
      new Set(
        (options ?? [])
          .map((option: any) => option?.linked_product_id)
          .filter(Boolean)
          .map(String),
      ),
    );

    const { data: linkedProducts } = linkedIds.length
      ? await supabaseAdmin
          .from("products")
          .select("id,name,active,sale_price,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label")
          .in("id", linkedIds)
      : { data: [] as any[] };

    const linkedById = new Map(
      (linkedProducts ?? []).map((product: any) => [String(product.id), product]),
    );

    const activeGroupIds = new Set((groups ?? []).map((g: any) => String(g.id)));
    const optionsByGroup = new Map<string, any[]>();

    for (const option of options ?? []) {
      if (!activeGroupIds.has(String(option.group_id))) continue;

      const linked = option.linked_product_id
        ? linkedById.get(String(option.linked_product_id))
        : null;

      if (option.linked_product_id && (!linked || linked.active !== true)) continue;

      const effectiveAddonPrice =
        option.use_linked_product_price === true && linked
          ? Number(getEffectivePrice(linked).price || 0)
          : Number(option.price || 0);

      const list = optionsByGroup.get(String(option.group_id)) ?? [];
      list.push({ ...option, effectiveAddonPrice });
      optionsByGroup.set(String(option.group_id), list);
    }

    for (const link of links ?? []) {
      const productId = String(link.product_id);
      const groupOptions = optionsByGroup.get(String(link.group_id)) ?? [];
      for (const option of groupOptions) {
        (addonsByProduct[productId] ||= []).push({
          name: String(option.display_name || option.name),
          price: Number(option.effectiveAddonPrice || 0),
        });
      }
    }
  }

  // Categorias REAIS cadastradas no sistema — a IA usa ISSO, e só isso, pra
  // responder "o que vocês têm?". Isso existe porque a IA já respondeu com
  // uma categoria inventada, que não existe na loja, copiando um exemplo
  // genérico que sobrou no prompt em vez de olhar o cardápio real. Calculando
  // a lista de categorias aqui, em código, a partir do banco, não sobra
  // espaço pra ela inventar nada: ou a categoria está nesta lista, ou ela
  // não existe na loja.
  const categoryOrder: string[] = [];
  for (const p of availableProducts) {
    const cat = (p.category || "Outros").trim();
    if (!categoryOrder.includes(cat)) categoryOrder.push(cat);
  }
  const categoriesText = categoryOrder.length ? categoryOrder.join(", ") : "(nenhuma categoria cadastrada ainda)";

  // Cardápio agrupado por categoria (com cabeçalho), pra ficar estruturalmente
  // claro pra IA quais produtos pertencem a qual categoria real.
  const byCategory: Record<string, any[]> = {};
  for (const p of availableProducts) {
    const cat = (p.category || "Outros").trim();
    (byCategory[cat] ||= []).push(p);
  }
  const catalogText =
    categoryOrder
      .map((cat) => {
        const items = byCategory[cat]
          .map((p: any) => {
            const recipeIngs = ingredientsByProduct[p.id];
            // Fonte principal para responder ao cliente: campo explícito do cadastro do produto.
            // A ficha técnica (recipe_items) fica como fallback para produtos antigos ainda não preenchidos.
            const customerIngredients = String(p.customer_ingredients || "").trim();
            const composition = customerIngredients
              ? ` | Ingredientes: ${customerIngredients}`
              : recipeIngs?.length
                ? ` | Ingredientes: ${recipeIngs.join(", ")}`
                : " | Ingredientes: não cadastrados — se o cliente perguntar, informe que vai confirmar com a equipe; nunca invente";
            const effective = getEffectivePrice(p);
            const promo = effective.isPromotion ? ` (promoção${p.promotion_label ? `: ${p.promotion_label}` : ""}; preço normal R$ ${effective.listPrice.toFixed(2).replace(".", ",")})` : "";
            const addonText = (addonsByProduct[String(p.id)] || []).length
              ? ` | Adicionais disponíveis: ${(addonsByProduct[String(p.id)] || [])
                  .map((addon) => `${addon.name} (+R$ ${addon.price.toFixed(2).replace(".", ",")})`)
                  .join(", ")}`
              : "";
            return `- ${p.name}${p.description ? " — " + p.description : ""} — R$ ${effective.price.toFixed(2).replace(".", ",")}${promo}${composition}${addonText}`;
          })
          .join("\n");
        return `[${cat}]\n${items}`;
      })
      .join("\n\n") || "(cardápio vazio no momento — nenhum produto cadastrado ou ativo)";

  const unavailableText = unavailableNames.length
    ? unavailableNames.map((n) => `- ${n} (sem estoque hoje)`).join("\n")
    : "";

  return { catalogText, unavailableText, categoriesText };
}

// ============================================================
// Rascunho do pedido (memória de trabalho por conversa)
// ============================================================

type DraftAddon = { name: string; quantity?: number | null };
type DraftItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
  addons?: DraftAddon[];
};
type Draft = {
  customer_name?: string | null;
  delivery_mode?: "delivery" | "pickup" | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_reference?: string | null;
  items: DraftItem[];
  payment_method?: "pix" | "card" | null;
  card_type?: "credit" | "debit" | null;
  payment_timing?: "now" | "delivery" | null;
  change_for?: number | null;
  notes?: string | null;
  estimated_delivery_fee?: number | null;
  estimated_distance_km?: number | null;
  out_of_delivery_area?: boolean;
  failed_finalize_attempts?: number;
  awaiting_final_confirmation?: boolean;
  stage?: string | null;
};

// Se o rascunho ficou parado por muito tempo (cliente sumiu, teste antigo,
// pedido abandonado), ele NÃO deve ser tratado como "já confirmado" numa
// conversa nova — isso é o que causava a IA fechar pedido sozinha em cima de
// dados velhos assim que o cliente mandava um simples "bom dia". Qualquer
// rascunho com conteúdo e sem atividade há mais de 20min é limpo
// automaticamente antes de uma nova sessão. Em delivery o cliente pode ficar
// 30, 60 ou 90 minutos sem responder e continuar a mesma compra. A janela antiga
// de 20 minutos apagava bairro, itens e outros dados no meio de uma venda real.
// Mantemos a memória apenas durante uma janela operacional razoável de 90 minutos.
// Depois disso, uma nova mensagem inicia uma coleta limpa. Fechamento/cancelamento
// continuam limpando o rascunho imediatamente pelos fluxos próprios.
const DRAFT_STALE_MS = 90 * 60 * 1000;

async function loadOrCreateDraft(supabaseAdmin: any, conversationId: string): Promise<Draft> {
  const { data, error: selectErr } = await supabaseAdmin
    .from("order_drafts")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (selectErr) throw new Error(`Falha ao buscar rascunho (order_drafts select): ${selectErr.message}`);

  if (data) {
    const hasContent = Boolean(
      data.customer_name || data.address_street || data.payment_method || (data.items ?? []).length,
    );
    const ageMs = data.updated_at ? Date.now() - new Date(data.updated_at).getTime() : Infinity;
    if (hasContent && ageMs > DRAFT_STALE_MS) {
      const cleared = {
        customer_name: null,
        delivery_mode: null,
        address_street: null,
        address_number: null,
        address_complement: null,
        address_neighborhood: null,
        address_city: null,
        address_reference: null,
        items: [],
        payment_method: null,
        card_type: null,
        payment_timing: null,
        change_for: null,
        notes: null,
        estimated_delivery_fee: null,
        estimated_distance_km: null,
        out_of_delivery_area: false,
        awaiting_final_confirmation: false,
        stage: "collecting",
        updated_at: new Date().toISOString(),
      };
      await supabaseAdmin.from("order_drafts").update(cleared).eq("conversation_id", conversationId);
      return { items: [] };
    }
    return { ...data, items: data.items ?? [] };
  }

  const { error: insertErr } = await supabaseAdmin
    .from("order_drafts")
    .insert({ conversation_id: conversationId, items: [] });
  if (insertErr) throw new Error(`Falha ao criar rascunho (order_drafts insert): ${insertErr.message}`);
  return { items: [] };
}

function summarizeDraft(d: Draft): string {
  const lines: string[] = [];
  if (d.customer_name) lines.push(`Nome: ${d.customer_name}`);
  if (d.delivery_mode)
    lines.push(`Modo: ${d.delivery_mode === "pickup" ? "Retirada no local (sem entrega)" : "Entrega"}`);
  if (d.delivery_mode !== "pickup") {
    if (d.address_street)
      lines.push(
        `Endereço: ${d.address_street}, ${d.address_number ?? "?"}${d.address_complement ? " — " + d.address_complement : ""}${d.address_neighborhood ? " — " + d.address_neighborhood : ""}`,
      );
    if (d.address_reference) lines.push(`Referência: ${d.address_reference}`);
  }
  if (d.items?.length)
    lines.push(
      `Itens: ${d.items.map((i) => `${i.quantity}x ${i.product_name}${i.notes ? " (" + i.notes + ")" : ""}`).join(", ")}`,
    );
  if (d.payment_method)
    lines.push(
      `Pagamento: ${d.payment_method === "pix" ? "Pix" : `Cartão${d.card_type === "credit" ? " de crédito" : d.card_type === "debit" ? " de débito" : ""}`}`,
    );
  if (d.payment_timing)
    lines.push(`Quando paga: ${d.payment_timing === "now" ? "agora, no fechamento" : "na entrega/retirada"}`);
  if (d.delivery_mode !== "pickup") {
    if (d.out_of_delivery_area)
      lines.push(
        `⚠️ ATENÇÃO: esse endereço está FORA da área de entrega do entregador fixo — siga o fluxo de REDIRECIONAMENTO FORA DE ÁREA (iFood/99Food), não finalize o pedido.`,
      );
    else if (d.estimated_delivery_fee != null)
      lines.push(
        `Taxa de entrega calculada pra esse endereço: R$ ${Number(d.estimated_delivery_fee).toFixed(2).replace(".", ",")}${d.estimated_distance_km != null ? ` (${d.estimated_distance_km.toFixed(1)} km da loja)` : ""}`,
      );
  }
  return lines.length ? lines.join("\n") : "(nada coletado ainda)";
}

function buildContinuityFallback(draft: Draft): string {
  const items = Array.isArray(draft.items) ? draft.items : [];
  if (!items.length) return "Perfeito! Pode me dizer o que você gostaria de pedir e a quantidade de cada item, por favor?";
  if (!draft.delivery_mode) return "Perfeito. O pedido será para entrega ou retirada, por favor?";

  const missingName = !draft.customer_name;
  const missingPayment = !draft.payment_method;
  const firstName = String(draft.customer_name ?? "").trim().split(/\s+/)[0] || "";
  const namePrefix = firstName ? `${firstName}, ` : "";

  if (draft.delivery_mode === "delivery") {
    if (!draft.address_neighborhood) return "Para continuar com a entrega, poderia me informar seu bairro, por favor?";

    // FLUXO ENXUTO E ORGANIZADO: primeiro coletamos NOME + ENDEREÇO juntos.
    // O pagamento é solicitado somente depois que o endereço estiver completo e
    // a taxa tiver sido confirmada. Se o cliente informar pagamento antes, ele é
    // aproveitado e não será perguntado novamente.
    if (!draft.address_street && !draft.address_number) {
      if (missingName) {
        return (
          "*Por favor, me informe:*\n\n" +
          "*Nome de quem vai receber:*\n" +
          "*Endereço completo para entrega (rua e número):*"
        );
      }
      return `${namePrefix}por favor, me informe o endereço completo para entrega (rua e número).`;
    }

    // Se o endereço veio parcialmente e o nome ainda não foi informado,
    // continue agrupando NOME + parte faltante do endereço. Isso evita o fluxo
    // voltar a pedir apenas endereço quando a regra comercial é coletar os dois
    // juntos antes de seguir para taxa/pagamento.
    if (!draft.address_street) {
      if (missingName) {
        return (
          "*Por favor, me informe:*\n\n" +
          "*Nome de quem vai receber:*\n" +
          "*Rua do endereço de entrega:*"
        );
      }
      return `${namePrefix}para completar o endereço, poderia me informar somente a rua, por favor?`;
    }

    if (!draft.address_number) {
      if (missingName) {
        return (
          "*Por favor, me informe:*\n\n" +
          "*Nome de quem vai receber:*\n" +
          "*Número do endereço de entrega:*"
        );
      }
      return `${namePrefix}para completar o endereço, poderia me informar somente o número, por favor?`;
    }

    // Com endereço completo, a prioridade é confirmar a taxa ANTES de pedir
    // pagamento ou qualquer outro dado restante.
    if (draft.estimated_delivery_fee == null) {
      return `${namePrefix}só um instante enquanto confirmo a taxa de entrega para esse endereço.`;
    }
  }

  if (missingName) return "Para continuar, qual é o nome de quem vai receber o pedido, por favor?";
  if (missingPayment) {
    return (
      `${namePrefix}*Qual será a forma de pagamento?*\n` +
      "Aceitamos cartão de crédito, cartão de débito ou Pix.\n\n" +
      "*Observação:* Não aceitamos dinheiro em espécie, para segurança do nosso entregador."
    );
  }
  if (draft.awaiting_final_confirmation) return `${namePrefix}fico aguardando sua confirmação para fechar o pedido.`;
  return `${namePrefix}perfeito. Vou preparar o resumo do pedido para sua confirmação.`;
}

/** Última barreira contra loops: dado já persistido não pode ser perguntado de novo. */
function enforceNoRepeatedKnownQuestion(text: string, draft: Draft): string {
  if (!text) return text;
  const t = normalizeStreet(text);
  const fallback = () => buildContinuityFallback(draft);

  if (draft.address_neighborhood && /(?:informe|informar|qual|diga|dizer|confirmar).{0,35}bairro|bairro.{0,25}(?:por favor|qual)/.test(t)) return fallback();
  if ((draft.items ?? []).length > 0 && /(?:quais|qual).{0,25}(?:itens|produtos).{0,30}(?:pedir|pedido)|o que voce gostaria de pedir|quais itens voce gostaria de pedir|o que vai querer|o que deseja pedir/.test(t)) return fallback();
  if ((draft.items ?? []).length > 0 && draft.items.every((item: any) => Number(item?.quantity || 0) > 0) && /(?:qual|quais|quantas|quantos|informe|informar).{0,30}(?:quantidade|unidades)|quantas unidades|quantos voce quer/.test(t)) return fallback();
  if (draft.delivery_mode && /(?:entrega ou retirada|retirada ou entrega|vai retirar|sera para entrega|e para entrega|prefere entrega|prefere retirar)/.test(t)) return fallback();
  if (draft.customer_name && /(?:qual|informe|informar).{0,30}nome.{0,25}(?:pedido|receber|cliente)/.test(t)) return fallback();
  if (draft.payment_method && /(?:qual|informe|informar).{0,35}(?:forma|metodo).{0,20}pagamento/.test(t)) return fallback();
  const fullAddressKnown = Boolean(draft.address_street && draft.address_number && draft.address_neighborhood);
  if (draft.delivery_mode === "delivery" && fullAddressKnown && /(?:qual|informe|informar).{0,35}endereco|endereco.{0,25}por favor/.test(t)) return fallback();
  return text;
}

function isExplicitOrderRestartIntent(text: string): boolean {
  const t = normalizeStreet(text);
  return /\b(recomecar|comecar de novo|reiniciar|zerar).{0,30}(pedido|tudo)|\besqueca tudo|\bapaga tudo.{0,20}(pedido|ate aqui)/.test(t);
}

async function resetCurrentOrderKeepingValidatedNeighborhood(
  supabaseAdmin: any,
  conversationId: string,
  draft: Draft,
  bairrosAtendidos: string[],
): Promise<void> {
  const savedNeighborhood = draft.address_neighborhood
    ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
    : null;
  const cleared: any = {
    customer_name: null,
    delivery_mode: savedNeighborhood ? "delivery" : null,
    address_street: null, address_number: null, address_complement: null,
    address_neighborhood: savedNeighborhood, address_city: null, address_reference: null,
    items: [], payment_method: null, card_type: null, payment_timing: null, change_for: null,
    notes: null, estimated_delivery_fee: null, estimated_distance_km: null,
    out_of_delivery_area: false, awaiting_final_confirmation: false, updated_at: new Date().toISOString(),
  };
  Object.assign(draft, cleared);
  await supabaseAdmin.from("order_drafts").update(cleared).eq("conversation_id", conversationId);
}

function parseExplicitQuantityFromText(text: string): number | null {
  const t = normalizeStreet(text);
  const numeric = t.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
  if (numeric) {
    const n = Number(numeric[1]);
    if (n >= 1 && n <= 30) return n;
  }
  const words: Array<[RegExp, number]> = [
    [/\b(?:uma|um)\b/, 1], [/\b(?:duas|dois)\b/, 2], [/\btres\b/, 3],
    [/\bquatro\b/, 4], [/\bcinco\b/, 5], [/\bseis\b/, 6],
  ];
  for (const [re, n] of words) if (re.test(t)) return n;
  return null;
}


function isExplicitDraftItemChangeIntent(text: string | null | undefined): boolean {
  const t = normalizeStreet(String(text ?? ""));
  if (!t) return false;
  return /\b(?:tira|tirar|retira|retirar|remove|remover|exclui|excluir|cancela|cancelar|troca|trocar|substitui|substituir|muda|mudar|altera|alterar|corrige|corrigir|diminui|diminuir|reduz|reduzir|aumenta|aumentar|acrescenta|acrescentar|adiciona|adicionar|mais uma|mais um|recomecar|esquecer.*pedido)\b/.test(t);
}

function isDestructiveDraftItemChangeIntent(text: string | null | undefined): boolean {
  const t = normalizeStreet(String(text ?? ""));
  if (!t) return false;
  return /\b(?:tira|tirar|retira|retirar|remove|remover|exclui|excluir|cancela|cancelar|troca|trocar|substitui|substituir|recomecar|esquecer.*pedido)\b/.test(t);
}

function mergeDraftItemPreservingCommercialData(oldItem: DraftItem, incomingItem: DraftItem): DraftItem {
  const incomingAddons = Array.isArray(incomingItem.addons) ? incomingItem.addons : [];
  const oldAddons = Array.isArray(oldItem.addons) ? oldItem.addons : [];
  return {
    ...oldItem,
    ...incomingItem,
    notes:
      incomingItem.notes != null && String(incomingItem.notes).trim() !== ""
        ? incomingItem.notes
        : oldItem.notes ?? null,
    addons: incomingAddons.length ? incomingAddons : oldAddons,
  };
}

function normalizeDraftItems(items: any): DraftItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it: any) => ({
      product_name: String(it?.product_name ?? "").trim(),
      quantity: Math.max(1, Math.round(Number(it?.quantity) || 1)),
      notes: it?.notes == null ? null : String(it.notes),
      addons: Array.isArray(it?.addons)
        ? it.addons
            .map((addon: any) => ({
              name: String(addon?.name ?? "").trim(),
              quantity: Math.max(1, Math.round(Number(addon?.quantity) || 1)),
            }))
            .filter((addon: DraftAddon) => Boolean(addon.name))
        : [],
    }))
    .filter((it: DraftItem) => Boolean(it.product_name));
}

/**
 * update_order_draft é acionado por um LLM. Em turnos que não alteram produtos
 * (endereço, nome, pagamento etc.) alguns provedores podem reenviar `items: []`
 * ou apenas parte da lista. A versão antiga aceitava isso literalmente e apagava
 * o pedido já coletado. Aqui o draft nunca pode REGREDIR sem intenção explícita
 * do cliente de alterar/remover itens.
 */
function reconcileDraftItems(existingRaw: DraftItem[] | null | undefined, incomingRaw: any, userText: string): DraftItem[] {
  const existing = normalizeDraftItems(existingRaw ?? []);
  const incoming = normalizeDraftItems(incomingRaw);
  const destructiveChangeAllowed = isDestructiveDraftItemChangeIntent(userText);

  if (!destructiveChangeAllowed) {
    if (!incoming.length && existing.length) return existing;
    if (!existing.length) return incoming;

    const merged = [...existing];
    for (const item of incoming) {
      const key = normalizeStreet(item.product_name);
      const idx = merged.findIndex((old) => normalizeStreet(old.product_name) === key);
      if (idx >= 0) merged[idx] = mergeDraftItemPreservingCommercialData(merged[idx], item);
      else merged.push(item);
    }
    return merged;
  }

  const byName = new Map(existing.map((item) => [normalizeStreet(item.product_name), item]));
  return incoming.map((item) => {
    const old = byName.get(normalizeStreet(item.product_name));
    return old ? mergeDraftItemPreservingCommercialData(old, item) : item;
  });
}

function isSimpleConversationAffirmative(text: string): boolean {
  const t = normalizeStreet(text).replace(/[.,;:!?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  // Entende confirmações naturais e gírias comuns sem reproduzi-las na resposta.
  // O contexto (pergunta anterior) decide O QUE está sendo confirmado; esta função
  // apenas reconhece que a fala do cliente é afirmativa.
  return /^(?:sim|s|ss|isso|isso ai|isso mesmo|correto|certo|certinho|perfeito|ok|okay|blz|beleza|show|fechou|demorou|exato|exatamente|pode ser|pode|pode sim|confirmo|confirmado|ta certo|tudo certo|tranquilo|joia|positivo|combinado)$/.test(t);
}

function isIntermediateItemsConfirmationPrompt(text: string): boolean {
  const t = normalizeStreet(text);
  if (!t) return false;
  // Resumo final é outra etapa e possui total/taxa ou pedido explícito de fechamento.
  if (/resumo do (?:seu )?pedido|total a pagar|taxa de entrega|posso fechar o pedido|pode fechar o pedido/.test(t)) return false;
  const asksConfirmation = /\b(?:correto|certo|confere|esta correto|esta certo)\b/.test(t);
  const mentionsItems = /\b(?:unidade|unidades|item|itens|gostaria de|voce gostaria de|pedir|pedido)\b/.test(t);
  return asksConfirmation && mentionsItems;
}

function parseAddressFromCustomerTurn(
  userText: string,
  previousAssistantText: string,
): { street?: string; number?: string } | null {
  const raw = String(userText ?? "").trim();
  if (!raw) return null;
  const prev = normalizeStreet(previousAssistantText);
  const addressContext = /\b(?:endereco|rua|avenida|av\.?|numero|residencia)\b/.test(prev);
  const explicitStreet = /^(?:rua|r\.?|avenida|av\.?|travessa|tv\.?|estrada|rodovia|alameda|praca|praça)\b/i.test(raw);
  if (!addressContext && !explicitStreet) return null;

  // Resposta isolada à pergunta de número: "324", "Número 324", "nº 324".
  const normalizedRaw = normalizeStreet(raw).replace(/[º°]/g, "o");
  const onlyNumber = normalizedRaw.match(/^(?:(?:n(?:o|umero)?\.?|numero)\s*[:#-]?\s*)?(\d{1,6}[a-z]?)$/i);
  if (onlyNumber && /\bnumero\b/.test(prev)) return { number: onlyNumber[1] };

  // COLETA AGRUPADA: aceita endereço dentro de uma resposta que também traz
  // nome e pagamento, por exemplo: "Rua Cananéia, 12, Evanilda, Pix".
  // Primeiro procura um logradouro explícito e para no número, sem engolir os
  // outros dados da mesma mensagem.
  const embedded = raw.match(
    /((?:rua|r\.?|avenida|av\.?|travessa|tv\.?|estrada|rodovia|alameda|praca|praça)\s+[^,;\n]+?)[,\s]+(?:n(?:[º°o]|umero)?\.?\s*)?(\d{1,6}[a-zA-Z]?)(?=\s*(?:[,;\n]|$))/i,
  );
  if (embedded) {
    const street = embedded[1].replace(/[,-]+\s*$/, "").trim();
    if (street && !/^\d+$/.test(street)) return { street, number: embedded[2] };
  }

  // Rua + número como resposta inteira: "Av Brasil 324", "Rua X, nº 10".
  const full = raw.match(/^(.+?)(?:\s*,?\s+(?:n(?:[º°o]|umero)?\.?\s*)?)(\d{1,6}[a-zA-Z]?)\s*$/i);
  if (!full) return null;
  const street = full[1].replace(/[,-]+\s*$/, "").trim();
  if (!street || /^\d+$/.test(street)) return null;
  return { street, number: full[2] };
}

async function persistDeterministicAddressFromTurn(
  supabaseAdmin: any,
  conversationId: string,
  userText: string,
  history: Array<{ role: string; content: string }>,
  draft: Draft,
): Promise<void> {
  if (draft.delivery_mode === "pickup") return;
  const previousAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const parsed = parseAddressFromCustomerTurn(userText, previousAssistant);
  if (!parsed) return;

  const patch: any = { updated_at: new Date().toISOString() };
  if (parsed.street) {
    draft.address_street = parsed.street;
    patch.address_street = parsed.street;
  }
  if (parsed.number) {
    draft.address_number = parsed.number;
    patch.address_number = parsed.number;
  }
  // O bairro previamente validado permanece intocado.
  const { error } = await supabaseAdmin.from("order_drafts").update(patch).eq("conversation_id", conversationId);
  if (error) throw new Error(`Falha ao persistir endereço determinístico: ${error.message}`);
}


/**
 * Garante que um endereço completo recém-informado nunca fique parado esperando
 * uma segunda rodada da IA para calcular o frete. A memória determinística de
 * endereço roda antes do modelo; portanto, depender apenas de `addressChanged`
 * dentro de update_order_draft fazia o endereço já parecer "antigo" e pulava o
 * popup. Esta função é chamada imediatamente após capturar rua+número.
 */
async function resolveFreightImmediatelyForCompleteDraft(
  supabaseAdmin: any,
  conversation: any,
  draft: Draft,
  bairrosAtendidos: string[],
  bairrosNaoAtendidos: string[],
  ruasNaoAtendidas: string[],
): Promise<{ status: "not_needed" | "resolved" | "manual" | "failed"; fee?: number }> {
  if (draft.delivery_mode === "pickup") return { status: "not_needed" };
  if (!draft.address_street?.trim() || !draft.address_number?.trim() || !draft.address_neighborhood?.trim()) {
    return { status: "not_needed" };
  }
  if (draft.estimated_delivery_fee != null) {
    return { status: "resolved", fee: Number(draft.estimated_delivery_fee) };
  }

  try {
    const { data: cfgRow } = await supabaseAdmin
      .from("store_config")
      .select("delivery_pricing_mode, store_lat, store_lng, google_maps_api_key, delivery_fee_tiers, default_delivery_fee, fixed_delivery_city")
      .maybeSingle();
    if (!cfgRow) return { status: "failed" };

    const fullAddress = [draft.address_street, draft.address_number, draft.address_neighborhood]
      .filter(Boolean)
      .join(", ");
    const rawResult = await calculateDeliveryFee(cfgRow as DeliveryConfig, fullAddress, {
      supabaseAdmin,
      phone: conversation.phone,
    });
    const result = applyBairroOverride(
      rawResult,
      draft.address_neighborhood,
      bairrosAtendidos,
      (cfgRow as any)?.default_delivery_fee ?? null,
      draft.address_street,
      bairrosNaoAtendidos,
      ruasNaoAtendidas,
    );

    if (result.outOfArea) {
      // Não reclassifica silenciosamente um bairro ativo. A proteção autoritativa
      // de bairros continua sendo a fonte de verdade da cobertura.
      const activeMatch = findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos);
      if (activeMatch) result.outOfArea = false;
    }

    if (!result.outOfArea && result.fee != null) {
      const { requestFreightApproval } = await import("@/lib/freight-approval.server");
      const outcome = await requestFreightApproval(supabaseAdmin, {
        conversationId: conversation.id,
        phone: conversation.phone,
        customerName: draft.customer_name ?? conversation.customer_name ?? null,
        address: fullAddress,
        fee: Number(result.fee),
        distanceKm: result.distanceKm ?? null,
      });
      if (outcome.status === "rejected") {
        await supabaseAdmin.from("whatsapp_conversations").update({ bot_paused: true }).eq("id", conversation.id);
        return { status: "manual" };
      }
      if (outcome.fee != null) result.fee = Number(outcome.fee);
    }

    if (result.fee == null) return { status: "failed" };

    draft.estimated_delivery_fee = Number(result.fee);
    draft.estimated_distance_km = result.distanceKm;
    draft.out_of_delivery_area = Boolean(result.outOfArea);
    draft.awaiting_final_confirmation = false;

    const { error } = await supabaseAdmin
      .from("order_drafts")
      .update({
        estimated_delivery_fee: Number(result.fee),
        estimated_distance_km: result.distanceKm,
        out_of_delivery_area: Boolean(result.outOfArea),
        awaiting_final_confirmation: false,
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversation.id);
    if (error) throw new Error(error.message);

    return { status: "resolved", fee: Number(result.fee) };
  } catch (err) {
    console.error("[FREIGHT_IMMEDIATE] falha ao calcular/aprovar taxa:", err);
    return { status: "failed" };
  }
}

function significantProductTokens(name: string): string[] {
  const stop = new Set(["batata", "recheada", "de", "da", "do", "com", "e", "sabor", "cremoso", "cremosa", "crocante"]);
  return normalizeStreet(name).split(/\s+/).filter((x) => x.length >= 3 && !stop.has(x));
}

function hasPaidAddonIntent(text: string): boolean {
  const t = normalizeStreet(text);
  return /\\b(?:adicional|adiciona|adicionar|acrescenta|acrescentar|coloca|colocar|bota|botar|extra|com)\\b/.test(t);
}

async function persistPaidAddonMemoryFromTurn(
  supabaseAdmin: any,
  conversationId: string,
  userText: string,
  draft: Draft,
): Promise<void> {
  if (!draft.items?.length || !hasPaidAddonIntent(userText)) return;

  const normalizedText = normalizeStreet(userText);
  const { findProductMatch } = await import("@/lib/product-match.server");

  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id,name,active")
    .eq("active", true);
  const productList = products ?? [];
  if (!productList.length) return;

  const draftMatches = draft.items
    .map((item, index) => ({ index, item, product: findProductMatch(productList, item.product_name) }))
    .filter((row) => row.product?.id);

  const productIds = draftMatches.map((row) => row.product.id);
  if (!productIds.length) return;

  const [{ data: links }, { data: groups }, { data: options }] = await Promise.all([
    supabaseAdmin.from("product_addon_groups").select("product_id,group_id").in("product_id", productIds),
    supabaseAdmin.from("menu_addon_groups").select("id,active").eq("active", true),
    supabaseAdmin
      .from("menu_addon_options")
      .select("id,group_id,name,display_name,price,linked_product_id,use_linked_product_price,active")
      .eq("active", true),
  ]);

  const activeGroups = new Set((groups ?? []).map((g: any) => String(g.id)));
  const optionsByGroup = new Map<string, any[]>();
  for (const option of options ?? []) {
    if (!activeGroups.has(String(option.group_id))) continue;
    const list = optionsByGroup.get(String(option.group_id)) ?? [];
    list.push(option);
    optionsByGroup.set(String(option.group_id), list);
  }

  const optionsByProduct = new Map<string, any[]>();
  for (const link of links ?? []) {
    const list = optionsByProduct.get(String(link.product_id)) ?? [];
    list.push(...(optionsByGroup.get(String(link.group_id)) ?? []));
    optionsByProduct.set(String(link.product_id), list);
  }

  const targetAll = /\\b(?:em todas|em todos|nas duas|nos dois|em cada|para todas|pra todas)\\b/.test(normalizedText);
  let changed = false;
  const nextItems = normalizeDraftItems(draft.items);

  for (const row of draftMatches) {
    const productTokens = significantProductTokens(String(row.product.name || ""));
    const mentionsThisProduct = productTokens.some(
      (token) => token.length >= 5 && new RegExp(`\\b${token}\\b`).test(normalizedText),
    );

    // Se há um único item, "coloca bacon" se refere a ele.
    // Se há vários, exige mencionar o produto ou indicar que vale para todos.
    if (draftMatches.length > 1 && !targetAll && !mentionsThisProduct) continue;

    const available = optionsByProduct.get(String(row.product.id)) ?? [];
    for (const option of available) {
      const display = String(option.display_name || option.name || "").trim();
      if (!display) continue;
      const qty = extractAddonQuantityFromNotes(userText, display);
      if (qty <= 0) continue;

      const existing = Array.isArray(nextItems[row.index].addons) ? nextItems[row.index].addons! : [];
      const normalizedDisplay = normalizeStreet(display);
      const found = existing.findIndex((addon) => {
        const key = normalizeStreet(addon.name);
        return key === normalizedDisplay || key.includes(normalizedDisplay) || normalizedDisplay.includes(key);
      });

      if (found >= 0) {
        if (Number(existing[found].quantity || 1) !== qty) {
          existing[found] = { ...existing[found], name: display, quantity: qty };
          changed = true;
        }
      } else {
        existing.push({ name: display, quantity: qty });
        changed = true;
      }
      nextItems[row.index].addons = existing;
    }
  }

  if (!changed) return;

  draft.items = nextItems;
  draft.awaiting_final_confirmation = false;
  const { error } = await supabaseAdmin
    .from("order_drafts")
    .update({
      items: nextItems,
      awaiting_final_confirmation: false,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`Falha ao persistir adicionais pagos: ${error.message}`);
}

async function persistObviousProductMemoryFromTurn(
  supabaseAdmin: any,
  conversationId: string,
  userText: string,
  history: Array<{ role: string; content: string }>,
  draft: Draft,
): Promise<void> {
  const qty = parseExplicitQuantityFromText(userText);
  const previousAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const previousAskedQuantity = /quantidade|quantas|quantos/.test(normalizeStreet(previousAssistant));

  const { data: products } = await supabaseAdmin.from("products").select("name").eq("active", true);
  if (!products?.length) return;

  const candidatesFrom = (source: string) => {
    const userTokens = new Set(normalizeStreet(source).split(/\s+/).filter((x) => x.length >= 3));
    return (products ?? []).filter((p: any) => {
      const tokens = significantProductTokens(String(p.name ?? ""));
      if (!tokens.length) return false;
      const hits = tokens.filter((x) => userTokens.has(x));
      return hits.some((x) => x.length >= 5) || hits.length >= 2;
    });
  };

  const existing = Array.isArray(draft.items) ? [...draft.items] : [];
  const upsert = (canonicalName: string, quantity: number) => {
    const key = normalizeStreet(canonicalName);
    const idx = existing.findIndex((it) => normalizeStreet(it.product_name) === key);
    if (idx >= 0) existing[idx] = { ...existing[idx], product_name: canonicalName, quantity };
    else existing.push({ product_name: canonicalName, quantity });
  };

  // 1) Vários produtos + quantidade na MESMA frase.
  // "uma de costela e uma de strogonoff", "1 costela + 2 pizza", etc.
  // A versão anterior extraía apenas UM número global e, ao encontrar dois
  // produtos, desistia e perguntava quantidade novamente.
  const clauses = String(userText)
    .split(/\s+(?:e|mais)\s+|[,;+]/i)
    .map((x) => x.trim())
    .filter(Boolean);
  let explicitItemsCaptured = 0;
  for (const clause of clauses) {
    const clauseQty = parseExplicitQuantityFromText(clause);
    if (clauseQty == null) continue;
    const clauseCandidates = candidatesFrom(clause);
    if (clauseCandidates.length !== 1) continue;
    upsert(String((clauseCandidates[0] as any).name), clauseQty);
    explicitItemsCaptured++;
  }

  if (explicitItemsCaptured > 0) {
    draft.items = existing;
    draft.awaiting_final_confirmation = false;
    const { error } = await supabaseAdmin
      .from("order_drafts")
      .update({ items: existing, awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
      .eq("conversation_id", conversationId);
    if (error) throw new Error(`Falha ao persistir itens explícitos: ${error.message}`);
    return;
  }

  // 2) "uma de cada" / "2 de cada" em resposta à pergunta de quantidade.
  // Recupera todos os produtos mencionados pelo cliente no turno anterior.
  const normalizedCurrent = normalizeStreet(userText);
  if (previousAskedQuantity && qty != null && /\b(?:de cada|cada um|cada uma)\b/.test(normalizedCurrent)) {
    const previousUserTexts = [...history].reverse().filter((m) => m.role === "user").map((m) => m.content).slice(0, 6);
    for (const oldText of previousUserTexts) {
      const found = candidatesFrom(oldText);
      if (found.length >= 2) {
        for (const product of found) upsert(String((product as any).name), qty);
        draft.items = existing;
        draft.awaiting_final_confirmation = false;
        const { error } = await supabaseAdmin
          .from("order_drafts")
          .update({ items: existing, awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
          .eq("conversation_id", conversationId);
        if (error) throw new Error(`Falha ao persistir quantidade de cada item: ${error.message}`);
        return;
      }
    }
  }

  const previousWasBeverageOffer = isBeverageOfferMessage(previousAssistant);

  // 3) Caso simples. Se acabou de oferecer bebida e o cliente respondeu
  // apenas com o nome ("Guaraná", "Coca", "água"), assume 1 unidade.
  let candidates = candidatesFrom(userText);
  let resolvedQty = qty;
  if (resolvedQty == null && previousWasBeverageOffer && candidates.length === 1) resolvedQty = 1;
  if (resolvedQty == null && !previousAskedQuantity) return;

  if (!candidates.length && resolvedQty != null && previousAskedQuantity) {
    const previousUserTexts = [...history].reverse().filter((m) => m.role === "user").map((m) => m.content).slice(0, 5);
    for (const oldText of previousUserTexts) {
      const found = candidatesFrom(oldText);
      if (found.length === 1) { candidates = found; break; }
    }
  }
  if (candidates.length !== 1 || resolvedQty == null) return;

  upsert(String((candidates[0] as any).name), resolvedQty);
  draft.items = existing;
  draft.awaiting_final_confirmation = false;
  const { error } = await supabaseAdmin
    .from("order_drafts")
    .update({ items: existing, awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId);
  if (error) throw new Error(`Falha ao persistir memória de itens: ${error.message}`);
}

function assistantPromisesActionButDoesNothing(text: string): boolean {
  const t = normalizeStreet(text || "");
  if (!t) return false;
  return /\b(vou (?:finalizar|fechar|concluir|gerar|registrar|processar)(?: o| seu)? pedido|um momento|s[oó] um instante|aguarde (?:um )?momento|j[aá] vou finalizar|vou preparar o resumo)\b/.test(t);
}

/**
 * Guardrail comercial, não classificador principal da conversa. A IA continua
 * interpretando linguagem natural; esta função só impede um salto de etapa
 * quando o cliente claramente entrou em modo de compra e ainda não existe
 * nenhum item no rascunho. Isso evita casos como “já sei o que vou pedir”
 * virarem imediatamente uma pergunta de endereço.
 */

function isDeliveryFeeQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  if (!t) return false;
  return (
    /\b(?:taxa|frete)\b/.test(t) ||
    /\b(?:valor|preco|quanto|quanto custa|qual o valor).{0,30}\bentrega\b/.test(t) ||
    /\bentrega.{0,30}\b(?:valor|preco|quanto|taxa|frete)\b/.test(t)
  );
}

function isDeliveryTimeQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  return /\b(?:prazo|tempo de entrega|quanto tempo|demora|demorar|chega em quanto|entrega demora)\b/.test(t);
}

function isPaymentInfoQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  return /\b(?:forma de pagamento|formas de pagamento|aceita pix|aceitam pix|aceita cartao|aceitam cartao|aceita dinheiro|aceitam dinheiro|como posso pagar|como paga|pagamento)\b/.test(t);
}

function isStoreLocationQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  return /\b(?:onde fica|onde voces ficam|onde e a loja|endereco da loja|localizacao da loja|localizacao de voces)\b/.test(t);
}

function isBusinessHoursQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  return /\b(?:horario|horarios|que horas abre|que horas fecha|estao abertos|esta aberto|funciona hoje|abrem hoje|fecha que horas)\b/.test(t);
}

function isGenericMenuOrPriceQuestion(text: string): boolean {
  const t = normalizeStreet(text);
  if (!t || isDeliveryFeeQuestion(text)) return false;
  return (
    /\b(?:cardapio|menu|quais os precos|quais precos|quanto custa|qual o valor de voces|precos de voces|o que voces tem|o que tem hoje)\b/.test(t) &&
    !/\b(?:de|da|do)\s+[a-z0-9]/.test(t.replace(/\b(?:qual|quanto|preco|valor|custa|cardapio|menu|voces|tem|hoje)\b/g, " "))
  );
}

function looksInformationalOnly(text: string): boolean {
  return (
    isDeliveryFeeQuestion(text) ||
    isDeliveryTimeQuestion(text) ||
    isPaymentInfoQuestion(text) ||
    isStoreLocationQuestion(text) ||
    isBusinessHoursQuestion(text)
  );
}

function extractProductPriceNeedle(text: string): string {
  return normalizeStreet(text)
    .replace(/\b(?:quanto|qual|me diz|me fala|saber|queria saber|gostaria de saber)\b/g, " ")
    .replace(/\b(?:custa|custam|valor|preco|precos|fica|esta|e|da|do|de|por favor|pfv|pf)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findSpecificProductAskedForPrice(
  supabaseAdmin: any,
  text: string,
): Promise<any | null> {
  if (isDeliveryFeeQuestion(text)) return null;

  const normalized = normalizeStreet(text);
  const asksPrice =
    /\b(?:preco|valor|quanto custa|quanto e|quanto fica|custa quanto)\b/.test(normalized);

  if (!asksPrice) return null;

  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select(
      "id,name,sale_price,active,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label",
    )
    .eq("active", true);

  if (error || !(products ?? []).length) return null;

  const productList = products ?? [];
  const directMatches = productList
    .map((product: any) => ({
      product,
      key: normalizeStreet(String(product.name || "")),
    }))
    .filter((row: any) => row.key && normalized.includes(row.key))
    .sort((a: any, b: any) => b.key.length - a.key.length);

  if (directMatches.length) return directMatches[0].product;

  const needle = extractProductPriceNeedle(text);
  if (!needle) return null;

  try {
    const { findProductMatch } = await import("@/lib/product-match.server");
    return findProductMatch(productList, needle);
  } catch {
    return null;
  }
}

async function getNeighborhoodQuoteForInformation(
  supabaseAdmin: any,
  neighborhood: string,
  street?: string | null,
): Promise<{ supported: boolean; fee: number | null; pricingMode?: string; needsNumber?: boolean } | null> {
  try {
    const { data, error } = await (supabaseAdmin as any).rpc(
      "check_delivery_area_public",
      {
        p_neighborhood: neighborhood,
        p_street: street || null,
      },
    );

    if (error || !data) return null;

    return {
      supported: data.supported !== false,
      fee: data.fee == null ? null : Number(data.fee),
      pricingMode: data.pricing_mode ? String(data.pricing_mode) : undefined,
      needsNumber: data.needs_number === true,
    };
  } catch {
    return null;
  }
}

/**
 * Perguntas informativas NÃO podem iniciar coleta agressiva de pedido.
 * Esse handler roda antes da IA e responde determinísticamente as intenções
 * que mais geravam respostas ruins: taxa, prazo, pagamento, localização,
 * horário e preço de produto específico.
 */
async function handleInformationalQuestionBeforeAi(opts: {
  supabaseAdmin: any;
  conversationId: string;
  phone: string;
  text: string;
  draft: Draft;
  cfgStore: any;
  businessHoursText: string | null;
  bairrosAtendidos: string[];
  bairrosNaoAtendidos: string[];
  bairrosAtendidosLoadOk: boolean;
  firstContact?: boolean;
}): Promise<Response | null> {
  const {
    supabaseAdmin,
    conversationId,
    phone,
    text,
    draft,
    cfgStore,
    businessHoursText,
    bairrosAtendidos,
    bairrosNaoAtendidos,
    bairrosAtendidosLoadOk,
  } = opts;

  // 1) TAXA / VALOR DA ENTREGA — responde a intenção real, nunca pergunta produto.
  if (isDeliveryFeeQuestion(text)) {
    if (draft.delivery_mode === "pickup") {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        "Para retirada no local não há taxa de entrega.",
      );
      return Response.json({ ok: true, action: "info_delivery_fee_pickup" });
    }

    const servedNeighborhood = draft.address_neighborhood
      ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
      : null;

    if (!servedNeighborhood) {
      // Se existe um bairro salvo no rascunho, não repetimos a pergunta. Isso
      // protege inclusive contra pequenas diferenças de grafia enquanto a lista
      // autoritativa está temporariamente indisponível.
      if (draft.address_neighborhood?.trim()) {
        const authoritativeSaved = await findActiveNeighborhoodAuthoritatively(
          supabaseAdmin,
          draft.address_neighborhood,
        );
        if (authoritativeSaved) {
          draft.address_neighborhood = authoritativeSaved;
          draft.delivery_mode = "delivery";
          draft.out_of_delivery_area = false;
          await supabaseAdmin
            .from("order_drafts")
            .update({
              address_neighborhood: authoritativeSaved,
              delivery_mode: "delivery",
              out_of_delivery_area: false,
              updated_at: new Date().toISOString(),
            })
            .eq("conversation_id", conversationId);

          const recoveredQuote = await getNeighborhoodQuoteForInformation(
            supabaseAdmin,
            authoritativeSaved,
            draft.address_street || null,
          );
          if (recoveredQuote?.fee != null) {
            await replyAndLog(
              supabaseAdmin,
              conversationId,
              phone,
              `Para *${authoritativeSaved}*, a taxa de entrega é *${brl(Number(recoveredQuote.fee))}*.`,
            );
            return Response.json({ ok: true, action: "info_delivery_fee_recovered_neighborhood" });
          }
        }
      }

      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        "Claro! A taxa de entrega varia conforme a região. Qual é o seu bairro, por favor? Aí eu te passo o valor certinho.",
      );
      return Response.json({ ok: true, action: "info_delivery_fee_neighborhood_needed" });
    }

    if (draft.estimated_delivery_fee != null) {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        `Para esse endereço, a taxa de entrega é *${brl(Number(draft.estimated_delivery_fee))}*.`,
      );
      return Response.json({ ok: true, action: "info_delivery_fee_known" });
    }

    if (cfgStore?.delivery_pricing_mode === "distance") {
      if (!draft.address_street?.trim() || !draft.address_number?.trim()) {
        await replyAndLog(
          supabaseAdmin,
          conversationId,
          phone,
          `Para *${servedNeighborhood}*, a taxa é calculada pela distância do endereço. Se quiser saber o valor exato, poderia me informar a rua e o número, por favor?`,
        );
        return Response.json({ ok: true, action: "info_delivery_fee_address_needed" });
      }

      // Com endereço completo, o fluxo já existente calcula e pede aprovação da loja.
      return null;
    }

    const quote = await getNeighborhoodQuoteForInformation(
      supabaseAdmin,
      servedNeighborhood,
      draft.address_street || null,
    );

    if (quote?.supported === false) {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        formatOutOfAreaDirectReply(
          cfgStore?.ifood_store_link || null,
          cfgStore?.nfood_store_link || null,
        ),
      );
      return Response.json({ ok: true, action: "info_delivery_fee_external_area" });
    }

    const configuredFee =
      quote?.fee != null
        ? Number(quote.fee)
        : Number(cfgStore?.default_delivery_fee ?? 0);

    if (Number.isFinite(configuredFee) && configuredFee >= 0) {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        configuredFee === 0
          ? `Para *${servedNeighborhood}*, a entrega está *grátis*.`
          : `Para *${servedNeighborhood}*, a taxa de entrega é *${brl(configuredFee)}*.`,
      );
      return Response.json({ ok: true, action: "info_delivery_fee_by_neighborhood" });
    }

    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Consigo confirmar a taxa certinha para você. Poderia me informar a rua e o número, por favor?",
    );
    return Response.json({ ok: true, action: "info_delivery_fee_fallback_address_needed" });
  }

  // 2) PRAZO — não pergunta item, endereço ou pagamento.
  if (isDeliveryTimeQuestion(text)) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Nosso prazo de entrega é de *até 40 minutos* e normalmente chega antes. Quando o pedido estiver em andamento, você recebe as atualizações pelo WhatsApp.",
    );
    return Response.json({ ok: true, action: "info_delivery_time" });
  }

  // 3) PAGAMENTO — resposta curta e útil.
  if (isPaymentInfoQuestion(text)) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Aceitamos *Pix* e *cartão de crédito ou débito*. Não trabalhamos com dinheiro em espécie.",
    );
    return Response.json({ ok: true, action: "info_payment_methods" });
  }

  // 4) LOCALIZAÇÃO.
  if (isStoreLocationQuestion(text)) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      "Ficamos na *Rua Carlos Chagas, em Jardim Gramacho*. Trabalhamos somente com delivery e retirada.",
    );
    return Response.json({ ok: true, action: "info_store_location" });
  }

  // 5) HORÁRIO — só responde determinísticamente quando a configuração existe.
  if (isBusinessHoursQuestion(text) && businessHoursText) {
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      `Nosso horário de atendimento é: *${businessHoursText}*.`,
    );
    return Response.json({ ok: true, action: "info_business_hours" });
  }

  // 6) PREÇO DE UM PRODUTO ESPECÍFICO.
  const specificProduct = await findSpecificProductAskedForPrice(supabaseAdmin, text);
  if (specificProduct) {
    const servedNeighborhood = draft.address_neighborhood
      ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
      : null;

    if (draft.delivery_mode !== "pickup" && bairrosAtendidosLoadOk && !servedNeighborhood) {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        `Claro! Para eu te passar o valor correto de *${specificProduct.name}* para o seu atendimento, qual é o seu bairro, por favor?`,
      );
      return Response.json({ ok: true, action: "info_specific_price_neighborhood_needed" });
    }

    const effective = getEffectivePrice(specificProduct);
    await replyAndLog(
      supabaseAdmin,
      conversationId,
      phone,
      `${specificProduct.name}: *${brl(Number(effective.price || 0))}*.`,
    );
    return Response.json({ ok: true, action: "info_specific_product_price" });
  }

  // 7) CARDÁPIO / PREÇOS EM GERAL — antes do bairro, explica o motivo sem ser robótico.
  if (isGenericMenuOrPriceQuestion(text) && draft.delivery_mode !== "pickup") {
    const servedNeighborhood = draft.address_neighborhood
      ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
      : null;

    if (bairrosAtendidosLoadOk && !servedNeighborhood) {
      await replyAndLog(
        supabaseAdmin,
        conversationId,
        phone,
        "Claro! Para eu te mostrar o cardápio e os valores corretos para a sua região, qual é o seu bairro, por favor?",
      );
      return Response.json({ ok: true, action: "info_menu_neighborhood_needed" });
    }
  }

  return null;
}

function customerIsReadyToOrderWithoutItems(userText: string, draft: Draft): boolean {
  if ((draft.items ?? []).length > 0) return false;
  const t = normalizeStreet(userText);
  if (!t) return false;

  // Perguntas puramente informativas não devem ser transformadas em venda à força.
  if (/\b(quanto|qual (?:o )?valor|preco|taxa|frete|horario|onde fica|endereco da loja|entrega em|aceita|forma de pagamento)\b/.test(t) && /\?/.test(userText)) {
    return false;
  }

  // Intenção de compra/decisão já tomada. É um fail-safe; a interpretação
  // principal continua sendo feita pela IA com todo o histórico.
  return /\b(ja (?:sei|escolhi|decidi)|sei o que (?:quero|vou pedir)|quero (?:pedir|fazer (?:um )?pedido|comprar)|vou (?:pedir|querer)|pode (?:anotar|pegar) (?:meu )?pedido|nao (?:precisa|preciso|quero) (?:do |ver o )?cardapio|sem cardapio|ja tenho (?:meu )?pedido|vou te falar o que quero)\b/.test(t);
}

function assistantSkippedItemsAndAskedLaterStep(text: string): boolean {
  const t = normalizeStreet(text);
  if (!t) return false;
  return /\b(endereco|rua|numero da casa|nome de quem|nome para o pedido|forma de pagamento|pix|cartao|bebida|refrigerante|resumo|fechar o pedido|finalizar o pedido|confirmar o pedido)\b/.test(t);
}

function enforceNaturalSalesProgression(finalText: string, userText: string, draft: Draft): string {
  if (!finalText) return finalText;
  if (!customerIsReadyToOrderWithoutItems(userText, draft)) return finalText;
  if (!assistantSkippedItemsAndAskedLaterStep(finalText)) return finalText;

  return "Perfeito! Pode me dizer o que você gostaria de pedir e a quantidade de cada item, por favor?";
}

function extractAddonQuantityFromNotes(notes: string, addonName: string): number {
  const n = normalizeStreet(notes);
  const a = normalizeStreet(addonName);
  if (!n || !a) return 0;

  const addonTokens = a
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["extra", "adicional", "crocante", "cremoso", "cremosa"].includes(token));
  const aliases = Array.from(new Set([a, ...addonTokens])).filter(Boolean);

  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const negative = new RegExp(`\\b(?:sem|tirar|tira|retirar|retira|remove|remover)\\s+(?:o\\s+|a\\s+)?${escaped}\\b`);
    if (negative.test(n)) return 0;
  }

  // Só considera quantidade de adicional quando o número está junto do adicional.
  // "2 costelas com bacon" = 2 produtos com 1 bacon em cada, e não 2 bacons por unidade.
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const qtyMatch =
      n.match(new RegExp(`\\b(\\d{1,2})\\s*x?\\s*${escaped}\\b`)) ||
      n.match(new RegExp(`\\b${escaped}\\s*x\\s*(\\d{1,2})\\b`));
    if (qtyMatch) return Math.max(1, Math.min(20, Number(qtyMatch[1]) || 1));
  }

  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordQty: Array<[RegExp, number]> = [
      [new RegExp(`\\b(?:duas|dois)\\s+${escaped}\\b`), 2],
      [new RegExp(`\\btres\\s+${escaped}\\b`), 3],
      [new RegExp(`\\bquatro\\s+${escaped}\\b`), 4],
      [new RegExp(`\\bcinco\\s+${escaped}\\b`), 5],
    ];
    for (const [re, qty] of wordQty) if (re.test(n)) return qty;
  }

  return aliases.some((alias) =>
    new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n),
  ) ? 1 : 0;
}

function mergeStructuredAndNoteAddons(
  requested: DraftAddon[] | null | undefined,
  notes: string | null | undefined,
  availableOptions: any[],
): DraftAddon[] {
  const merged = new Map<string, DraftAddon>();
  for (const addon of requested ?? []) {
    const key = normalizeStreet(addon.name);
    if (!key) continue;
    merged.set(key, { name: addon.name, quantity: Math.max(1, Math.round(Number(addon.quantity) || 1)) });
  }
  const noteText = String(notes ?? "").trim();
  if (!noteText) return [...merged.values()];
  for (const option of availableOptions) {
    const names = [String(option.display_name || "").trim(), String(option.name || "").trim()].filter(Boolean);
    let qty = 0;
    let chosen = names[0] || "";
    for (const name of names) {
      const detected = extractAddonQuantityFromNotes(noteText, name);
      if (detected > qty) { qty = detected; chosen = name; }
    }
    if (!qty) continue;
    const key = normalizeStreet(chosen);
    if (!merged.has(key)) merged.set(key, { name: chosen, quantity: qty });
  }
  return [...merged.values()];
}

async function priceDraftItemsWithStructuredAddons(
  supabaseAdmin: any,
  draftItems: DraftItem[],
  productList: any[],
) {
  const { findProductMatch, findProductSuggestions } = await import("@/lib/product-match.server");

  const prelim = draftItems.map((it) => {
    const product = findProductMatch(productList, it.product_name);
    return { draft: it, product };
  });

  const productIds = prelim
    .map((row) => row.product?.id)
    .filter(Boolean);

  const optionsByProduct = new Map<string, any[]>();

  if (productIds.length) {
    const [{ data: links }, { data: groups }, { data: options }] = await Promise.all([
      supabaseAdmin.from("product_addon_groups").select("product_id,group_id").in("product_id", productIds),
      supabaseAdmin.from("menu_addon_groups").select("id,active").eq("active", true),
      supabaseAdmin
        .from("menu_addon_options")
        .select("id,group_id,name,display_name,price,linked_product_id,use_linked_product_price,active")
        .eq("active", true),
    ]);

    const linkedProductIds = Array.from(
      new Set(
        (options ?? [])
          .map((option: any) => option?.linked_product_id)
          .filter(Boolean)
          .map(String),
      ),
    );

    const { data: linkedProducts } = linkedProductIds.length
      ? await supabaseAdmin
          .from("products")
          .select("id,name,active,sale_price,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label")
          .in("id", linkedProductIds)
      : { data: [] as any[] };

    const linkedProductById = new Map(
      (linkedProducts ?? []).map((product: any) => [String(product.id), product]),
    );

    const activeGroups = new Set((groups ?? []).map((g: any) => String(g.id)));
    const groupOptions = new Map<string, any[]>();

    for (const option of options ?? []) {
      if (!activeGroups.has(String(option.group_id))) continue;

      if (option.linked_product_id) {
        const linked = linkedProductById.get(String(option.linked_product_id));
        if (!linked || linked.active !== true) continue;
      }

      const list = groupOptions.get(String(option.group_id)) ?? [];
      list.push(option);
      groupOptions.set(String(option.group_id), list);
    }

    for (const link of links ?? []) {
      const productId = String(link.product_id);
      const list = optionsByProduct.get(productId) ?? [];
      list.push(...(groupOptions.get(String(link.group_id)) ?? []));
      optionsByProduct.set(productId, list);
    }
  }

  const unmatchedProducts: { raw: string; closest: string[] }[] = [];
  const unmatchedAddons: { product: string; addon: string; available: string[] }[] = [];

  const priced = prelim.map(({ draft, product }) => {
    if (!product) {
      unmatchedProducts.push({
        raw: draft.product_name,
        closest: findProductSuggestions(productList, draft.product_name),
      });
    }

    const effective = product ? getEffectivePrice(product) : { price: 0, listPrice: null, isPromotion: false };
    const availableOptions = product ? optionsByProduct.get(String(product.id)) ?? [] : [];
    let addonExtra = 0;
    const addonLabels: string[] = [];

    const chargeableAddons = mergeStructuredAndNoteAddons(draft.addons, draft.notes, availableOptions);

    for (const requested of chargeableAddons) {
      const requestedKey = normalizeStreet(requested.name);
      const option =
        availableOptions.find(
          (candidate: any) =>
            normalizeStreet(String(candidate.display_name || candidate.name)) === requestedKey,
        ) ||
        availableOptions.find((candidate: any) => {
          const optionKey = normalizeStreet(String(candidate.display_name || candidate.name));
          return optionKey.includes(requestedKey) || requestedKey.includes(optionKey);
        });

      if (!option) {
        unmatchedAddons.push({
          product: product?.name || draft.product_name,
          addon: requested.name,
          available: availableOptions.map((candidate: any) =>
            String(candidate.display_name || candidate.name),
          ),
        });
        continue;
      }

      const addonQty = Math.max(1, Math.round(Number(requested.quantity) || 1));
      const linkedProduct = option.linked_product_id
        ? linkedProductById.get(String(option.linked_product_id))
        : null;
      const addonPrice =
        option.use_linked_product_price === true && linkedProduct
          ? Number(getEffectivePrice(linkedProduct).price || 0)
          : Number(option.price || 0);

      addonExtra += addonPrice * addonQty;
      addonLabels.push(
        `${addonQty}x ${String(option.display_name || option.name)} (+${brl(addonPrice * addonQty)})`,
      );
    }

    const noteParts = [
      draft.notes ? String(draft.notes).trim() : "",
      addonLabels.length ? `Adicionais: ${addonLabels.join(", ")}` : "",
    ].filter(Boolean);

    return {
      product_id: product?.id ?? null,
      product_name: product?.name ?? draft.product_name,
      quantity: Math.max(1, Math.round(Number(draft.quantity) || 1)),
      unit_price: Number(effective.price || 0) + addonExtra,
      list_price:
        effective.listPrice == null
          ? null
          : Number(effective.listPrice || 0) + addonExtra,
      is_promotion_price: Boolean(effective.isPromotion),
      notes: noteParts.length ? noteParts.join(" • ") : null,
    };
  });

  return { priced, unmatchedProducts, unmatchedAddons };
}

async function buildFinalConfirmationSummary(
  supabaseAdmin: any,
  d: Draft,
): Promise<{ text: string; subtotal: number; deliveryFee: number; total: number; unmatched: string[] }> {
  const { data: products } = await supabaseAdmin
    .from("products")
    .select("id,name,sale_price,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label")
    .eq("active", true);
  const productList = products ?? [];
  const { priced: pricedItemsRaw, unmatchedProducts, unmatchedAddons } =
    await priceDraftItemsWithStructuredAddons(supabaseAdmin, d.items ?? [], productList);

  const unmatched = [
    ...unmatchedProducts.map((row) => row.raw),
    ...unmatchedAddons.map((row) => `${row.product}: adicional ${row.addon}`),
  ];

  const pricedItems = pricedItemsRaw.map((it) => ({
    name: it.product_name,
    quantity: it.quantity,
    price: it.unit_price,
    notes: it.notes,
  }));
  const subtotal = pricedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  // O resumo oficial tem um contrato visual/comercial fixo. Ele mostra SOMENTE
  // os campos aprovados pela loja: Nome, Endereço (somente
  // quando for entrega), Itens, Taxa de entrega, Total a pagar e confirmação.
  const deliveryFee = d.delivery_mode === "pickup" ? 0 : Number(d.estimated_delivery_fee);
  const total = subtotal + deliveryFee;
  const itemsText = pricedItems
    .map((it) => `- ${it.quantity}x ${it.name}${it.notes ? ` (${it.notes})` : ""} — ${brl(it.price * it.quantity)}`)
    .join("\n");
  const addressText =
    d.delivery_mode === "delivery"
      ? [
          d.address_street && d.address_number
            ? `${d.address_street}, ${d.address_number}`
            : d.address_street || d.address_number || null,
          d.address_complement || null,
          d.address_neighborhood || null,
          d.address_city || null,
        ]
          .filter(Boolean)
          .join(" — ")
      : "";
  const text =
    `*Resumo do pedido*\n\n` +
    `*Nome:* ${d.customer_name ?? "—"}\n` +
    (d.delivery_mode === "delivery" ? `*Endereço:* ${addressText || "—"}\n` : "") +
    (d.delivery_mode === "delivery" && d.address_reference ? `*Referência:* ${d.address_reference}\n` : "") +
    `*Itens:*\n${itemsText || "—"}\n` +
    (d.notes ? `*Observações:* ${d.notes}\n` : "") +
    `*Subtotal:* ${brl(subtotal)}\n` +
    `*Taxa de entrega:* ${brl(deliveryFee)}\n` +
    `*Forma de pagamento:* ${d.payment_method === "pix" ? "Pix" : d.payment_method === "card" ? "Cartão" : "—"}\n` +
    `*Total a pagar:* ${brl(total)}\n\n` +
    `Está tudo certo? Posso fechar o pedido?`;
  return { text, subtotal, deliveryFee, total, unmatched };
}





function isExplicitActiveOrderModificationIntent(text: string): boolean {
  const t = normalizeStreet(String(text ?? ""));
  if (!t) return false;

  const explicitOrderReference =
    /\b(?:meu|o|esse|este|aquele)\s+pedido\b/.test(t) ||
    /\bpedido\s+(?:que\s+)?(?:fiz|acabei de fazer|ja fiz|anterior|atual|aberto|em andamento)\b/.test(t) ||
    /\bpedido\s*#?\s*\d+\b/.test(t);

  const explicitModification =
    /\b(?:adicionar|acrescentar|incluir|colocar|trocar|alterar|mudar|remover|retirar|cancelar|diminuir|aumentar)\b/.test(t);

  const directReference =
    /\b(?:adiciona|acrescenta|inclui|coloca|tira|remove)\b.{0,35}\b(?:no|do|desse|deste)\s+pedido\b/.test(t) ||
    /\b(?:no|do|desse|deste)\s+pedido\b.{0,35}\b(?:adicionar|acrescentar|incluir|trocar|alterar|remover|cancelar)\b/.test(t);

  return directReference || (explicitOrderReference && explicitModification);
}

function isDigitalPaymentLinkRequest(text: string): boolean {
  const t = normalizeStreet(String(text ?? ""));
  const cameFromDigitalMenu =
    /\bvim pelo cardapio digital da hotbox\b/.test(t) ||
    /\bcardapio digital\b/.test(t);
  const asksPaymentLink =
    /\blink de pagamento\b/.test(t) ||
    /\breceber um link\b/.test(t);
  const paymentProblem =
    /\bpagamento nao foi autorizado\b/.test(t) ||
    /\bajuda para concluir o pagamento\b/.test(t) ||
    /\bconcluir o pagamento\b/.test(t);

  return cameFromDigitalMenu && asksPaymentLink && paymentProblem;
}

function customerNameFromDigitalPaymentMessage(text: string): string | null {
  const match = String(text ?? "").match(/(?:^|\n)\s*Nome:\s*([^\n\r]+)/i);
  const name = String(match?.[1] ?? "").trim();
  return name || null;
}

// ============================================================
// SUPORTE A PEDIDOS DO CARDÁPIO DIGITAL / SITE
// ============================================================
// Esse fluxo é determinístico e roda ANTES do portão de bairro. Um cliente que
// já comprou pelo site não está iniciando um novo pedido pelo WhatsApp; portanto
// não faz sentido pedir bairro. Pedimos apenas nome ou número do pedido, buscamos
// o pedido real no banco e informamos o status sem deixar a IA inventar nada.
function digitalOrderSupportWasRequested(history: Array<{ role: string; content: string }>): boolean {
  const previousAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const p = normalizeStreet(previousAssistant);
  return /(?:nome).{0,45}(?:numero|número).{0,25}pedido|(?:numero|número).{0,45}pedido.{0,45}nome/.test(p);
}

function isDigitalOrderSupportIntent(text: string, history: Array<{ role: string; content: string }>): boolean {
  if (digitalOrderSupportWasRequested(history)) return true;
  const t = normalizeStreet(text);
  const mentionsDigitalChannel = /\b(?:cardapio digital|cardapio online|site|sistema da hotbox|sistema hotbox|sistema da loja|pedido online)\b/.test(t);
  const saysOrderAlreadyExists = /\b(?:fiz|realizei|efetuei|finalizei|conclui|conclui|acabei de fazer|ja fiz|já fiz|paguei|tenho)\b.{0,70}\bpedido\b|\bpedido\b.{0,70}\b(?:fiz|realizei|efetuei|finalizei|conclui|paguei)\b/.test(t);
  const asksStatus = /\b(?:status|andamento|acompanhar|acompanho|onde esta|onde está|como esta|como está|meu pedido|pedido chegou|pedido foi confirmado)\b/.test(t);
  return mentionsDigitalChannel && (saysOrderAlreadyExists || asksStatus);
}

function extractDigitalOrderReference(
  text: string,
  history: Array<{ role: string; content: string }>,
): { orderNumber?: number; customerName?: string } {
  const raw = String(text ?? "").trim();
  const normalized = normalizeStreet(raw);
  const waitingReference = digitalOrderSupportWasRequested(history);

  const explicitNumber = normalized.match(/(?:pedido|numero do pedido|número do pedido|n[ºo]\.?)[\s:#-]*(\d{1,9})\b/);
  if (explicitNumber) return { orderNumber: Number(explicitNumber[1]) };
  const hashNumber = raw.match(/#\s*(\d{1,9})\b/);
  if (hashNumber) return { orderNumber: Number(hashNumber[1]) };
  if (waitingReference && /^\s*\d{1,9}\s*$/.test(raw)) return { orderNumber: Number(raw.trim()) };

  const explicitName = raw.match(/(?:meu nome (?:é|e)|nome(?: do cliente)?\s*[:=-]?)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,70})/i);
  if (explicitName?.[1]) {
    const name = explicitName[1].replace(/\s+(?:pedido|numero|número|do pedido).*$/i, "").trim();
    if (name.length >= 2) return { customerName: name };
  }

  if (waitingReference && !/\d/.test(raw)) {
    const name = raw
      .replace(/^(?:meu nome (?:é|e)|sou|é no nome de|e no nome de)\s+/i, "")
      .replace(/[.!?]+$/g, "")
      .trim();
    if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,70}$/.test(name)) return { customerName: name };
  }

  return {};
}

function publicOrderStatusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    pending_review: "aguardando confirmação da loja",
    payment_pending: "aguardando confirmação do pagamento",
    pending: "confirmado e na fila de preparo",
    preparing: "em preparação",
    ready: "pronto",
    ready_pickup: "pronto e aguardando retirada/entregador",
    out_for_delivery: "saiu para entrega",
    delivered: "entregue",
    failed: "com uma ocorrência que precisa ser verificada pela loja",
    cancelled: "cancelado",
    canceled: "cancelado",
  };
  const key = String(status ?? "").trim();
  return labels[key] ?? (key || "em processamento");
}

async function findOrderForDigitalSupport(
  supabaseAdmin: any,
  ref: { orderNumber?: number; customerName?: string },
): Promise<{ order: any | null; ambiguous?: boolean }> {
  const selection = "id,order_number,customer_name,customer_phone,status,payment_status,source,total,created_at";
  if (ref.orderNumber != null && Number.isFinite(ref.orderNumber)) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(selection)
      .eq("order_number", ref.orderNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { order: data ?? null };
  }

  const name = String(ref.customerName ?? "").trim();
  if (!name) return { order: null };
  // Busca exata, sem diferenciar maiúsculas/minúsculas. Limita a poucos registros
  // recentes para não expor pedido de homônimo por engano.
  const escaped = name.replace(/[%_]/g, "");
  const { data } = await supabaseAdmin
    .from("orders")
    .select(selection)
    .ilike("customer_name", escaped)
    .order("created_at", { ascending: false })
    .limit(3);
  const rows = data ?? [];
  if (rows.length === 1) return { order: rows[0] };
  if (rows.length > 1) return { order: null, ambiguous: true };
  return { order: null };
}

async function handleDigitalOrderSupportIfNeeded(
  supabaseAdmin: any,
  conversation: any,
  phone: string,
  text: string,
  history: Array<{ role: string; content: string }>,
): Promise<Response | null> {
  if (!isDigitalOrderSupportIntent(text, history)) return null;

  const ref = extractDigitalOrderReference(text, history);
  if (ref.orderNumber == null && !ref.customerName) {
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      "Claro! Para consultar seu pedido, poderia me informar *o nome usado no pedido* ou *o número do pedido*, por favor?",
    );
    return Response.json({ ok: true, action: "digital_order_reference_requested" });
  }

  const found = await findOrderForDigitalSupport(supabaseAdmin, ref);
  if (found.ambiguous) {
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      "Encontrei mais de um pedido com esse nome. Para eu consultar o pedido correto, poderia me informar *o número do pedido*, por favor?",
    );
    return Response.json({ ok: true, action: "digital_order_number_required_for_ambiguity" });
  }

  if (!found.order) {
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      "Não localizei um pedido com essa informação. Poderia conferir e me enviar *o nome usado no pedido* ou *o número do pedido*, por favor?",
    );
    return Response.json({ ok: true, action: "digital_order_not_found" });
  }

  const order = found.order;
  const numberText = order.order_number != null ? ` *#${order.order_number}*` : "";
  const statusText = publicOrderStatusLabel(order.status);
  const message =
    `Localizei o pedido${numberText}. O status atual é: *${statusText}*.` +
    `\n\nTodas as próximas atualizações do seu pedido você pode acompanhar por aqui, pelo WhatsApp. Obrigado pelo contato e pela preferência!`;
  await replyAndLog(supabaseAdmin, conversation.id, phone, message, { systemMessage: true });
  return Response.json({ ok: true, action: "digital_order_status_informed", order_id: order.id });
}

async function loadLastOrderText(supabaseAdmin: any, phone: string): Promise<string | null> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, total, created_at")
    .eq("customer_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order) return null;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("product_name, quantity")
    .eq("order_id", order.id);
  const itemsText = (items ?? []).map((i: any) => `${i.quantity}x ${i.product_name}`).join(", ");
  const statusLabel: Record<string, string> = {
    pending_review: "aguardando confirmação da loja",
    pending: "confirmado, entrou na fila",
    preparing: "em preparação",
    ready_pickup: "pronto, aguardando entregador",
    out_for_delivery: "saiu para entrega",
    delivered: "já entregue",
    failed: "teve problema na entrega",
    cancelled: "cancelado",
  };
  const when = new Date(order.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Pedido #${order.order_number}, feito em ${when} — status: ${statusLabel[order.status] ?? order.status} — total: R$ ${Number(order.total).toFixed(2).replace(".", ",")}${itemsText ? ` — itens: ${itemsText}` : ""}`;
}

async function loadLastAddressText(supabaseAdmin: any, phone: string): Promise<string | null> {
  // ── 1. Tenta o endereço confirmado salvo no perfil do lead (mais confiável,
  //       foi gravado após a última entrega concluída)
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("address_street, address_number, address_complement, address_neighborhood, address_city, address_reference, last_delivery_fee")
    .eq("phone", phone)
    .maybeSingle();

  if (lead?.address_street) {
    const parts = [
      lead.address_number
        ? `${lead.address_street}, ${lead.address_number}`
        : lead.address_street,
      lead.address_complement  || null,
      lead.address_neighborhood || null,
      lead.address_city         || null,
      lead.address_reference ? `referência: ${lead.address_reference}` : null,
    ].filter(Boolean);

    const feeText = lead.last_delivery_fee != null
      ? ` | Taxa de entrega cobrada na última vez: R$ ${Number(lead.last_delivery_fee).toFixed(2).replace(".", ",")}`
      : "";

    return parts.join(" — ") + feeText;
  }

  // ── 2. Fallback: busca no histórico de pedidos (clien…41610 tokens truncated…====== CONTEXTO DE TURNO ============
  // O modelo não tem noção nativa de "primeiro contato vs conversa em andamento"
  // — o prompt é reconstruído do zero a cada mensagem e ele tende a tratar tudo
  // como início de atendimento (daí as reapresentações em loop). Aqui o CÓDIGO
  // conta o histórico e injeta essa informação de forma explícita e inequívoca.
  const assistantTurns = opts.history.filter((m) => m.role === "assistant").length;
  const hasManualAgentContext = opts.history.some((m) => m.role === "assistant" && m.content.includes("[ATENDENTE HUMANO DA LOJA]"));
  const isFirstContact = assistantTurns === 0;
  const manualContinuationRule = hasManualAgentContext
    ? `\n🤝 CONTINUIDADE APÓS ATENDIMENTO HUMANO: existem mensagens marcadas como [ATENDENTE HUMANO DA LOJA] no histórico. Trate tudo que esse atendente disse, combinou, confirmou ou perguntou como contexto oficial e já conhecido. Continue exatamente do ponto onde ele parou, sem reiniciar o atendimento, sem pedir novamente dados já informados e sem contradizer o atendente. NUNCA escreva a marca [ATENDENTE HUMANO DA LOJA] para o cliente.`
    : "";
  const conversationStageText = (isFirstContact
    ? `🟢 CONTEXTO: este é o PRIMEIRO CONTATO deste cliente com a loja (não há nenhuma resposta sua no histórico). Cumprimente UMA vez com "${greetingByTimeBR()}". Se o cliente não declarou RETIRADA, a única pergunta operacional permitida antes de qualquer outra informação é o BAIRRO; não pergunte "como posso ajudar" antes de validar o bairro.`
    : `⛔ CONTEXTO: esta é uma CONVERSA EM ANDAMENTO — você já respondeu ${assistantTurns} vez(es) neste chat. É PROIBIDO cumprimentar de novo, se apresentar, dizer o nome da loja como abertura ou perguntar "como posso ajudar". Leia o histórico abaixo e responda APENAS a última mensagem do cliente, continuando de onde a conversa parou.`) + manualContinuationRule;

  const systemPrompt = buildSystemPrompt(
    opts.storeName,
    opts.catalogText,
    opts.unavailableText,
    opts.categoriesText,
    opts.draft,
    deliveryInfoText,
    opts.deliveryTimeMinutes,
    opts.lastOrderText,
    opts.lastAddressText,
    opts.aiInstructionsText,
    opts.pushName,
    conversationStageText,
    opts.businessHoursText,
  );
  const messages: any[] = [{ role: "system", content: systemPrompt }, ...opts.history];

  // Contexto operacional dinâmico: deixa a IA raciocinar sobre a conversa como
  // um vendedor humano, mas informa claramente o estado real do pedido.
  // Isso evita que intenção de compra seja confundida com dados já coletados.
  if ((opts.draft.items ?? []).length === 0 && (opts.draft.address_neighborhood || opts.draft.delivery_mode === "pickup")) {
    messages.push({
      role: "system",
      content:
        "ESTADO COMERCIAL ATUAL: o bairro/modalidade já permite continuar o atendimento, mas ainda NÃO existe nenhum produto confirmado no pedido. Se a mensagem mais recente do cliente indicar que ele quer comprar, que já escolheu ou que já sabe o que deseja, conduza naturalmente perguntando quais produtos/sabores e quantidades ele quer. Não invente itens e não avance para endereço, nome, pagamento, bebida ou fechamento antes de saber o pedido. Se a mensagem for apenas uma dúvida informativa, responda a dúvida normalmente.",
    });
  }
  let pixBlock: string | null = null;
  let pixKeyLabel: string | null = null;
  let pixKeyMessage: string | null = null;
  let finalText = "";
  // Marcado quando o gerente recusa o valor de frete: a conversa vira manual e
  // a IA não responde nada nesse turno.
  const flags: { silenced?: boolean; sendMenuImage?: boolean } = {};
  const lastUserIndex = (() => {
    for (let i = opts.history.length - 1; i >= 0; i--) {
      if (opts.history[i]?.role === "user") return i;
    }
    return -1;
  })();
  const lastUserText = lastUserIndex >= 0 ? (opts.history[lastUserIndex]?.content ?? "") : "";

  // ============ CONFIRMAÇÃO DE ALTERAÇÃO/CANCELAMENTO DE PEDIDO JÁ CRIADO ============
  // Usa `order_drafts.stage` como estado persistente. Assim a intenção é pedida
  // em uma rodada e consumida na mensagem seguinte sem depender de a IA lembrar.
  if (!opts.forceNoTools && (opts.draft.stage === "confirm_cancel_active_order" || opts.draft.stage === "confirm_active_order_update")) {
    if (isExplicitPendingActionConfirmation(lastUserText)) {
      const pendingStage = opts.draft.stage;
      const direct = pendingStage === "confirm_cancel_active_order"
        ? await executeTool("cancel_active_order", { reason: opts.draft.notes ?? undefined, __confirmed: true }, {
            supabaseAdmin: opts.supabaseAdmin, conversation: opts.conversation, draft: opts.draft, flags,
            finalConfirmationAllowed: false, bairrosAtendidos: opts.bairrosAtendidos, bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
            ruasNaoAtendidas: opts.ruasNaoAtendidas, currentUserText: lastUserText,
          })
        : await executeTool("update_active_order_items", { items: opts.draft.items ?? [], __confirmed: true }, {
            supabaseAdmin: opts.supabaseAdmin, conversation: opts.conversation, draft: opts.draft, flags,
            finalConfirmationAllowed: false, bairrosAtendidos: opts.bairrosAtendidos, bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
            ruasNaoAtendidas: opts.ruasNaoAtendidas, currentUserText: lastUserText,
          });
      if (direct.result?.status !== "ok") {
        await replyAndLog(
          opts.supabaseAdmin, opts.conversation.id, opts.conversation.phone,
          "Não consegui concluir essa alteração agora. Vou deixar o pedido como está e a equipe pode conferir para você.",
          { systemMessage: true },
        );
      }
      return { silenced: true, finalText: "", pixBlock: null, pixKeyLabel: null, pixKeyMessage: null, sendMenuImage: false };
    }
    if (isExplicitOrderRejection(lastUserText)) {
      await opts.supabaseAdmin.from("order_drafts").update({
        stage: "collecting", items: [], notes: null, awaiting_final_confirmation: false, updated_at: new Date().toISOString(),
      }).eq("conversation_id", opts.conversation.id);
      opts.draft.stage = "collecting"; opts.draft.items = []; opts.draft.notes = null;
      await replyAndLog(opts.supabaseAdmin, opts.conversation.id, opts.conversation.phone,
        "Tudo bem. Mantive o pedido como estava.", { systemMessage: true });
      return { silenced: true, finalText: "", pixBlock: null, pixKeyLabel: null, pixKeyMessage: null, sendMenuImage: false };
    }
  }

  // Resposta negativa à oferta de bebida: não depende da IA. Se o cliente
  // disser que não quer bebida, o backend gera imediatamente o resumo oficial
  // com TOTAL e pede a única confirmação final.
  const previousAssistantText = lastUserIndex > 0
    ? [...opts.history.slice(0, lastUserIndex)].reverse().find((m) => m.role === "assistant")?.content ?? ""
    : "";
  if (!opts.forceNoTools && isBeverageOfferMessage(previousAssistantText) && isBeverageDecline(lastUserText)) {
    const directSummary = await executeTool("finalize_order", {}, {
      supabaseAdmin: opts.supabaseAdmin,
      conversation: opts.conversation,
      draft: opts.draft,
      flags,
      finalConfirmationAllowed: false,
      bairrosAtendidos: opts.bairrosAtendidos,
      bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
      ruasNaoAtendidas: opts.ruasNaoAtendidas,
      currentUserText: lastUserText,
    });
    if (flags.silenced || directSummary.result?.status === "final_confirmation_summary_sent") {
      return {
        silenced: true,
        finalText: "",
        pixBlock: null,
        pixKeyLabel: null,
        pixKeyMessage: null,
        sendMenuImage: false,
      };
    }
  }

  // Confirmação dos ITENS é uma etapa intermediária, não a confirmação final.
  // A versão anterior deixava "Isso" voltar para a IA e ela podia repetir a mesma
  // pergunta; além disso, "Correto" era confundido com confirmação final. Quando
  // a fala anterior apenas confirmou a composição dos itens, consumimos a resposta
  // aqui e seguimos deterministicamente para o próximo dado realmente faltante.
  if (
    !opts.forceNoTools &&
    isSimpleConversationAffirmative(lastUserText) &&
    isIntermediateItemsConfirmationPrompt(previousAssistantText) &&
    (opts.draft.items ?? []).length > 0 &&
    !opts.draft.awaiting_final_confirmation
  ) {
    return {
      silenced: false,
      finalText: buildContinuityFallback(opts.draft),
      pixBlock: null,
      pixKeyLabel: null,
      pixKeyMessage: null,
      sendMenuImage: false,
    };
  }

  // A confirmação final não depende mais de uma frase exata da IA. Procura a
  // última mensagem real do atendente imediatamente antes da resposta atual,
  // ignorando eventuais mensagens internas/ferramentas que possam ter entrado
  // entre o resumo e o "sim" do cliente. Isso elimina o loop em que o backend
  // esquecia que já havia pedido confirmação e mandava o mesmo resumo de novo.
  const confirmationRequestPattern =
    /(resumo do (?:seu )?pedido|total a pagar|posso fechar o pedido|pode fechar o pedido|podemos fechar o pedido|confirmar o pedido final)/i;
  let previousAssistantRequestedConfirmation = false;
  if (lastUserIndex > 0) {
    for (let i = lastUserIndex - 1; i >= Math.max(0, lastUserIndex - 6); i--) {
      const msg = opts.history[i];
      if (msg?.role === "assistant" && confirmationRequestPattern.test(msg.content ?? "")) {
        previousAssistantRequestedConfirmation = true;
        break;
      }
      // Outra fala do cliente antes de encontrarmos a confirmação significa que
      // o "sim" atual não pertence mais àquele resumo antigo.
      if (msg?.role === "user") break;
    }
  }
  // O resumo oficial é salvo como mensagem de sistema e pode ficar fora do
  // histórico reduzido que a IA recebe. Por isso a confirmação final também
  // consulta o histórico REAL do banco. Isso impede o loop em que o cliente
  // diz "sim", o backend não enxerga o resumo e a IA manda o mesmo resumo de novo.
  let recentOfficialSummaryInDb = false;
  if (isExplicitOrderConfirmation(lastUserText)) {
    try {
      const { data: recentOut } = await opts.supabaseAdmin
        .from("whatsapp_messages")
        .select("body,direction,media_type,created_at")
        .eq("conversation_id", opts.conversation.id)
        .eq("direction", "out")
        .not("body", "is", null)
        .order("created_at", { ascending: false })
        .limit(8);
      recentOfficialSummaryInDb = (recentOut ?? []).some((m: any) => {
        const body = String(m?.body ?? "");
        return m?.media_type === "system" &&
          /resumo do (?:seu )?pedido/i.test(body) &&
          /total a pagar/i.test(body) &&
          /(posso fechar o pedido|est[aá] tudo certo|pode fechar)/i.test(body);
      });
    } catch (err) {
      console.error("[final-confirmation] falha ao consultar resumo recente:", err);
    }
  }

  const finalConfirmationAllowed =
    isExplicitOrderConfirmation(lastUserText) &&
    (Boolean(opts.draft.awaiting_final_confirmation) || recentOfficialSummaryInDb);

  // Se o cliente NEGAR o fechamento depois do resumo, não repete o resumo e
  // não tenta fechar. Libera o rascunho para edição e pergunta objetivamente o
  // que ele deseja modificar. A próxima mensagem volta ao fluxo normal da IA,
  // que pode alterar apenas o dado/item solicitado e depois gerar um novo resumo.
  if (opts.draft.awaiting_final_confirmation && isExplicitOrderRejection(lastUserText)) {
    opts.draft.awaiting_final_confirmation = false;
    await opts.supabaseAdmin
      .from("order_drafts")
      .update({ awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
      .eq("conversation_id", opts.conversation.id);

    return {
      finalText: "Ok, deseja modificar algo do pedido?",
      pixBlock: null,
      pixKeyLabel: null,
      pixKeyMessage: null,
      sendMenuImage: false,
    };
  }

  // Caminho determinístico: se o cliente acabou de confirmar explicitamente o
  // resumo, o backend fecha o pedido antes de consultar a IA. Assim o modelo
  // não consegue decidir repetir o resumo/pergunta e criar um loop infinito.
  if (finalConfirmationAllowed && !opts.forceNoTools) {
    // LOCK OTIMISTA CONTRA WEBHOOK DUPLICADO/RACE CONDITION:
    // apenas uma execução pode consumir awaiting_final_confirmation=true.
    // Se a Evolution reenviar o mesmo evento ou dois workers processarem o
    // mesmo "sim" ao mesmo tempo, o segundo é silenciado e NÃO repete resumo.
    // Se a flag ainda está true, fazemos o claim atômico para proteger contra
    // webhook duplicado. Se a flag já foi perdida, mas acabamos de comprovar
    // pelo histórico real que um resumo oficial foi enviado, NÃO descartamos
    // a confirmação: seguimos para finalize_order. Esse era um dos motivos do
    // "sim" ser consumido sem fechar o pedido.
    if (opts.draft.awaiting_final_confirmation) {
      const { data: claimedConfirmation, error: claimError } = await opts.supabaseAdmin
        .from("order_drafts")
        .update({ awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
        .eq("conversation_id", opts.conversation.id)
        .eq("awaiting_final_confirmation", true)
        .select("conversation_id")
        .maybeSingle();
      if (claimError) {
        messages.push({ role: "system", content: `[falha ao reservar confirmação final] ${claimError.message}` });
      } else if (!claimedConfirmation && !recentOfficialSummaryInDb) {
        return {
          silenced: true,
          finalText: "",
          pixBlock: null,
          pixKeyLabel: null,
          pixKeyMessage: null,
          sendMenuImage: false,
        };
      }
    }
    opts.draft.awaiting_final_confirmation = false;

    const direct = await executeTool("finalize_order", {}, {
      supabaseAdmin: opts.supabaseAdmin,
      conversation: opts.conversation,
      draft: opts.draft,
      flags,
      finalConfirmationAllowed: true,
      bairrosAtendidos: opts.bairrosAtendidos,
      bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
      ruasNaoAtendidas: opts.ruasNaoAtendidas,
      currentUserText: lastUserText,
    });

    if (direct.result?.status === "ok") {
      return {
        finalText: "",
        pixBlock: direct.pixBlock ?? null,
        pixKeyLabel: direct.pixKeyLabel ?? null,
        pixKeyMessage: direct.pixKeyMessage ?? null,
        sendMenuImage: false,
      };
    }

    // A confirmação já foi consumida. Qualquer novo ajuste de dados precisa
    // gerar um NOVO resumo; nunca reaproveite o resumo anterior.
    opts.draft.awaiting_final_confirmation = false;
    await opts.supabaseAdmin
      .from("order_drafts")
      .update({ awaiting_final_confirmation: false, updated_at: new Date().toISOString() })
      .eq("conversation_id", opts.conversation.id);

    // Se a validação estrutural impedir o fechamento (campo faltando, estoque,
    // etc.), não tenta finalizar de novo nesta mesma rodada. Entrega o motivo
    // para a IA pedir SOMENTE o que falta.
    messages.push({
      role: "system",
      content: `[tentativa direta de finalizar após confirmação] ${JSON.stringify(direct.result)}`,
    });
  }

  for (let round = 0; round < 6; round++) {
    const json = await callChatCompletion(opts.supabaseAdmin, {
      messages,
      tools: TOOLS,
      tool_choice: opts.forceNoTools ? "none" : "auto",
    });
    if (!json) {
      // Os dois provedores de IA falharam nessa chamada (chave inválida, sem
      // crédito, endpoint fora do ar, etc). Isso é o que gera o fallback
      // genérico em TODA mensagem — e sem alerta, o lojista não sabe o motivo.
      // Registra um alerta visível em /loja (painel) pra facilitar o diagnóstico.
      try {
        await opts.supabaseAdmin.rpc("record_system_alert", {
          _kind: "ia_indisponivel",
          _message:
            "A IA não respondeu (ChatGPT e Groq falharam ou não estão configurados). O cliente está recebendo mensagem de instabilidade. Confira as chaves em Configurações → IA / Failover.",
          _severity: "error",
        });
      } catch {
        /* alerta não pode quebrar o fluxo */
      }
      break;
    }
    const msg = json?.choices?.[0]?.message;
    if (!msg) break;

    // Blindagem: alguns provedores (Groq/Llama, principalmente) às vezes
    // escrevem a chamada de ferramenta como texto cru dentro de `content`
    // (formato "<function=nome>{...}</function>") em vez de usar o campo
    // estruturado `tool_calls`. Extrai e executa essas chamadas aqui, e
    // NUNCA deixa esse texto cru entrar no histórico ou chegar ao cliente.
    const { calls: inlineCalls, cleanedText } = extractInlineFunctionCalls(msg.content);
    messages.push({ ...msg, content: cleanedText });

    let executedAnyTool = false;

    if (msg.tool_calls?.length) {
      executedAnyTool = true;
      for (const call of msg.tool_calls) {
        let args: any = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* ignore */
        }
        const {
          result,
          pixBlock: pb,
          pixKeyLabel: pkl,
          pixKeyMessage: pkm,
        } = await executeTool(call.function.name, args, {
          supabaseAdmin: opts.supabaseAdmin,
          conversation: opts.conversation,
          draft: opts.draft,
          flags,
          finalConfirmationAllowed,
          bairrosAtendidos: opts.bairrosAtendidos,
          bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
          ruasNaoAtendidas: opts.ruasNaoAtendidas,
          currentUserText: lastUserText,
        });
        if (pb) pixBlock = pb;
        if (pkl) pixKeyLabel = pkl;
        if (pkm) pixKeyMessage = pkm;
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        if (flags.silenced)
          return {
            silenced: true,
            finalText: "",
            pixBlock: null,
            pixKeyLabel: null,
            pixKeyMessage: null,
          };
      }
    }

    if (inlineCalls.length) {
      executedAnyTool = true;
      for (const inline of inlineCalls) {
        const {
          result,
          pixBlock: pb,
          pixKeyLabel: pkl,
          pixKeyMessage: pkm,
        } = await executeTool(inline.name, inline.args, {
          supabaseAdmin: opts.supabaseAdmin,
          conversation: opts.conversation,
          draft: opts.draft,
          flags,
          finalConfirmationAllowed,
          bairrosAtendidos: opts.bairrosAtendidos,
          bairrosNaoAtendidos: opts.bairrosNaoAtendidos,
          ruasNaoAtendidas: opts.ruasNaoAtendidas,
          currentUserText: lastUserText,
        });
        if (pb) pixBlock = pb;
        if (pkl) pixKeyLabel = pkl;
        if (pkm) pixKeyMessage = pkm;
        // Não existe tool_call_id de verdade pra essas (o modelo não usou o
        // formato estruturado), então avisa o resultado como uma mensagem de
        // sistema — o suficiente pra próxima rodada saber o que aconteceu.
        messages.push({
          role: "system",
          content: `[resultado de ${inline.name}] ${JSON.stringify(result)}`,
        });
        if (flags.silenced)
          return {
            silenced: true,
            finalText: "",
            pixBlock: null,
            pixKeyLabel: null,
            pixKeyMessage: null,
          };
      }
    }

    if (executedAnyTool) {
      // Se a rodada só tinha chamada(s) de ferramenta (com ou sem texto
      // sobrando contaminado), força uma rodada nova pra gerar uma resposta
      // limpa em vez de confiar no texto que veio junto da chamada crua.
      continue;
    }

    // O resumo final NÃO pode ser escrito livremente pela IA. Se o modelo tentar
    // montar um resumo em texto (mesmo com todos os dados corretos), convertemos
    // a intenção em `finalize_order`, que é quem calcula valores, grava o estado
    // awaiting_final_confirmation e envia o resumo oficial do backend.
    const looksLikeAiFinalSummary =
      /resumo do (?:seu )?pedido/i.test(cleanedText) &&
      /total a pagar/i.test(cleanedText) &&
      /(posso fechar o pedido|est[aá] tudo certo|pode fechar)/i.test(cleanedText);
    if (looksLikeAiFinalSummary && !opts.forceNoTools) {
      const official = await executeTool("finalize_order", {}, {
        supabaseAdmin: opts.supabaseAdmin, conversation: opts.conversation, draft: opts.draft, flags,
        finalConfirmationAllowed: false, bairrosAtendidos: opts.bairrosAtendidos,
        bairrosNaoAtendidos: opts.bairrosNaoAtendidos, ruasNaoAtendidas: opts.ruasNaoAtendidas,
        currentUserText: lastUserText,
      });
      const officialStatus = String(official.result?.status ?? "");
      if (flags.silenced || ["beverage_offer_sent", "final_confirmation_summary_sent"].includes(officialStatus)) {
        return { silenced: true, finalText: "", pixBlock: null, pixKeyLabel: null, pixKeyMessage: null, sendMenuImage: flags.sendMenuImage ?? false };
      }
      if (officialStatus === "missing_fields") {
        finalText = buildContinuityFallback(opts.draft);
        break;
      }
      messages.push({ role: "system", content: `[resumo livre bloqueado; resultado do fechamento oficial] ${JSON.stringify(official.result)}` });
      continue;
    }

    // "Vou finalizar, um momento" sem ferramenta é um beco sem saída: depois
    // que esta resposta for enviada não existe execução futura automática.
    // O backend converte essa promessa vazia em progresso real.
    if (assistantPromisesActionButDoesNothing(cleanedText)) {
      const hasMissing =
        !(opts.draft.items ?? []).length ||
        !opts.draft.delivery_mode ||
        (opts.draft.delivery_mode === "delivery" && (!opts.draft.address_street || !opts.draft.address_number || !opts.draft.address_neighborhood)) ||
        !opts.draft.customer_name ||
        (opts.draft.delivery_mode === "delivery" && opts.draft.estimated_delivery_fee == null) ||
        !opts.draft.payment_method;

      if (hasMissing) {
        finalText = buildContinuityFallback(opts.draft);
        break;
      }
      if (opts.draft.awaiting_final_confirmation) {
        finalText = "Fico aguardando sua confirmação para fechar o pedido.";
        break;
      }

      const deterministicClose = await executeTool("finalize_order", {}, {
        supabaseAdmin: opts.supabaseAdmin, conversation: opts.conversation, draft: opts.draft, flags,
        finalConfirmationAllowed: false, bairrosAtendidos: opts.bairrosAtendidos,
        bairrosNaoAtendidos: opts.bairrosNaoAtendidos, ruasNaoAtendidas: opts.ruasNaoAtendidas,
      });
      if (flags.silenced || ["beverage_offer_sent", "final_confirmation_summary_sent"].includes(String(deterministicClose.result?.status ?? ""))) {
        return { silenced: true, finalText: "", pixBlock: null, pixKeyLabel: null, pixKeyMessage: null, sendMenuImage: flags.sendMenuImage ?? false };
      }
      messages.push({ role: "system", content: `[continuidade determinística] ${JSON.stringify(deterministicClose.result)}` });
      continue;
    }

    // Nunca permita que a IA anuncie pedido confirmado/finalizado por texto.
    // A confirmação real só sai do retorno status=ok de finalize_order, que já
    // gravou orders + order_items. Isso impede "pedido confirmado" sem pedido
    // existente no sistema.
    if (/\b(?:pedido|compra)\b.{0,25}\b(?:confirmad[oa]|finalizad[oa]|fechad[oa]|gerad[oa])\b/i.test(cleanedText)) {
      finalText = buildContinuityFallback(opts.draft);
      break;
    }

    finalText = cleanedText;
    break;
  }

  // Se os rounds acabaram e o modelo ficou só chamando ferramentas sem nunca
  // devolver texto (loop de tool calls), finalText continua vazio aqui. Em vez
  // de cair direto no fallback genérico — que se repetiria em TODA mensagem
  // enquanto esse padrão persistir — força uma última chamada SEM ferramentas
  // (tool_choice: "none") pra garantir uma resposta real com o que já foi
  // apurado até aqui.
  if (!finalText) {
    const forcedMessages = [
      ...messages,
      {
        role: "system",
        content:
          "REGRA DE CONTINUIDADE: gere AGORA uma resposta não vazia para a última mensagem do cliente. Continue exatamente do ponto em que o atendimento parou. Se ele acabou de esclarecer uma ambiguidade, aceite a escolha/correção e peça o próximo dado que falta. Não reinicie o atendimento, não fique em silêncio e não encerre enquanto o pedido estiver em andamento.",
      },
    ];
    const forced = await callChatCompletion(opts.supabaseAdmin, {
      messages: forcedMessages,
      tools: TOOLS,
      tool_choice: "none",
    });
    const forcedMsg = forced?.choices?.[0]?.message;
    const { cleanedText: forcedCleanedText } = extractInlineFunctionCalls(forcedMsg?.content);
    if (forcedCleanedText) {
      finalText = forcedCleanedText;
    } else {
      try {
        await opts.supabaseAdmin.rpc("record_system_alert", {
          _kind: "ia_loop_ferramentas",
          _message:
            "A IA ficou vários rounds seguidos só chamando ferramentas sem gerar uma resposta em texto pro cliente. Vale revisar o prompt ou o modelo em uso.",
          _severity: "warn",
        });
      } catch {
        /* alerta não pode quebrar o fluxo */
      }
    }
  }

  const freightSafeText = enforceApprovedFreight(finalText, opts.draft);
  const salesFlowSafeText = enforceNaturalSalesProgression(freightSafeText, lastUserText, opts.draft);
  const noRepeatSafeText = enforceNoRepeatedKnownQuestion(salesFlowSafeText, opts.draft);
  const paymentSafeText = enforcePaymentQuestionPresentation(noRepeatSafeText, opts.draft);

  // Se o backend já anunciou a taxa aprovada anteriormente, a IA não pode
  // anunciá-la de novo em outro balão. A única exceção é quando o próprio
  // cliente pergunta novamente pelo frete/taxa. O resumo oficial não passa por
  // este texto livre: ele é enviado diretamente pelo backend e continua
  // mostrando a taxa normalmente.
  let duplicateFeeSafeText = paymentSafeText;
  const customerAskedFeeAgain = /\b(taxa|frete|valor da entrega|quanto.*entrega)\b/i.test(lastUserText);
  if (!customerAskedFeeAgain && opts.draft.delivery_mode !== "pickup" && opts.draft.estimated_delivery_fee != null) {
    const feeWasAlreadyAnnounced = await wasDeliveryFeeAlreadyAnnounced(
      opts.supabaseAdmin,
      opts.conversation.id,
      Number(opts.draft.estimated_delivery_fee),
    );
    if (feeWasAlreadyAnnounced) duplicateFeeSafeText = removeRedundantDeliveryFeeAnnouncement(paymentSafeText);
  }

  return {
    finalText: duplicateFeeSafeText,
    pixBlock,
    pixKeyLabel,
    pixKeyMessage,
    sendMenuImage: flags.sendMenuImage ?? false,
  };
}

// ============================================================
// Handler principal
// ============================================================

export const Route = createFileRoute("/api/public/webhooks/evolution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        // O webhook da Meta reaproveita esse endpoint internamente (repassa a
        // mensagem já traduzida pra cá, pra usar a mesma lógica de IA/pedido).
        // Esse cabeçalho identifica esse caso — importante porque o botão de
        // desligar a Evolution por completo NÃO pode bloquear o canal da Meta,
        // mesmo as duas passando pelo mesmo código de processamento.
        const isFromMeta = request.headers.get("x-forwarded-provider") === "meta";

        try {
          return await handleIncomingMessage(payload, { skipEvolutionKillSwitch: isFromMeta });
        } catch (err: any) {
          console.error("[evolution webhook] erro não tratado:", err);
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { logApi } = await import("@/lib/api-log.server");
            await logApi(supabaseAdmin, {
              source: "evolution_webhook",
              direction: "in",
              request_payload: payload,
              response_status: 500,
              error_message: String(err?.message ?? err),
            });
            await supabaseAdmin.rpc("record_system_alert", {
              _kind: "evolution_webhook_error",
              _message: `Webhook Evolution falhou: ${String(err?.message ?? err).slice(0, 400)}`,
              _context: { stack: String(err?.stack ?? "").slice(0, 1000) },
              _severity: "error",
            });
          } catch {
            /* nunca deixa o log/alerta quebrar a resposta */
          }
          return Response.json(
            { ok: false, error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
            { status: 500 },
          );
        }
      },
    },
  },
});

async function handleIncomingMessageUnlocked(
  payload: any,
  opts?: {
    skipEvolutionKillSwitch?: boolean;
    preloggedConversation?: any;
    preloggedText?: string;
    skipTextLog?: boolean;
  },
): Promise<Response> {
  const event = String(payload?.event ?? payload?.type ?? "").toLowerCase();

  // aceita qualquer evento de mensagem — filtra o que não é mensagem nova dentro
  if (!event.includes("message")) {
    console.log("[evolution webhook] evento ignorado:", event);
    return Response.json({ ignored: true, event });
  }

  // Botão de emergência (Configurações → WhatsApp): com a Evolution
  // desabilitada, o sistema ignora QUALQUER coisa que chegue por esse
  // webhook — mesmo que a instância continue rodando e mandando eventos.
  // Isso é intencional e separado do seletor de provedor: dá pra desligar
  // a Evolution por completo sem precisar reconfigurar nada. NÃO se aplica
  // quando a chamada é o encaminhamento interno do webhook da Meta.
  if (!opts?.skipEvolutionKillSwitch) {
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const { isEvolutionDisabled } = await import("@/lib/whatsapp-send.server");
    if (await isEvolutionDisabled(sb)) {
      return Response.json({ ignored: "evolution_disabled" });
    }
  }

  // ============ CONFIRMAÇÃO DE LEITURA ============
  // Evento de status da mensagem (entregue/lida/tocada). "READ" e "PLAYED"
  // (áudio ouvido) contam como "o cliente leu" — casa pelo ID da mensagem
  // (guardado em external_id quando a mensagem foi enviada) e marca
  // read_at. DELIVERY_ACK/SERVER_ACK não significam leitura, só ignora.
  const msgStatus = String(payload?.data?.status ?? "").toUpperCase();
  if (["DELIVERY_ACK", "READ", "PLAYED", "SERVER_ACK"].includes(msgStatus)) {
    if (msgStatus === "READ" || msgStatus === "PLAYED") {
      const externalId: string | undefined = payload?.data?.key?.id;
      if (externalId) {
        try {
          const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
          await sb
            .from("whatsapp_messages")
            .update({ read_at: new Date().toISOString() })
            .eq("external_id", externalId)
            .is("read_at", null);
        } catch (err) {
          console.error("[evolution webhook] falha ao gravar confirmação de leitura:", err);
        }
      }
    }
    return Response.json({ ignored: "delivery_ack" });
  }

  // A Evolution API varia o formato conforme a versão: às vezes "data" já é o
  // objeto da mensagem (key/message direto), às vezes vem cru do Baileys como
  // { messages: [ {...} ], type: "notify" }. Aceitamos os dois formatos.
  const rawData = payload?.data ?? payload?.message ?? payload;
  const data = Array.isArray(rawData?.messages) ? rawData.messages[0] : rawData;
  if (!data) return Response.json({ ignored: "empty_payload" });

  const fromMe = data?.key?.fromMe;
  if (fromMe) return Response.json({ ignored: "from_me" });

  const remoteJid: string = data?.key?.remoteJid ?? "";
  if (!remoteJid || remoteJid.endsWith("@g.us")) return Response.json({ ignored: "group_or_empty" });
  const phone = remoteJid.split("@")[0].replace(/\D/g, "");
  const pushName: string = data?.pushName ?? "";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const conversation = opts?.preloggedConversation ?? await getOrCreateConversation(supabaseAdmin, phone, pushName);

  // Interruptor global do atendimento automático (Configurações → WhatsApp).
  // Desligado, a IA não responde NENHUMA conversa — igual a "pausado" pra
  // todo mundo — mas as mensagens continuam chegando no chat normalmente.
  const { data: botToggle } = await supabaseAdmin.from("store_config").select("bot_global_active").maybeSingle();
  const botGloballyOff = botToggle?.bot_global_active === false;

  // ============ IMAGEM (inclui comprovante Pix) ============
  const imageMsg = data?.message?.imageMessage;
  const base64Image: string | undefined = data?.message?.base64 ?? imageMsg?.base64 ?? payload?.data?.message?.base64;
  if (imageMsg && base64Image) {
    const mimeType = imageMsg.mimetype || "image/jpeg";
    // Faz upload para o Supabase Storage para exibir no painel do chat
    const imageMediaUrl = await uploadMediaToStorage(
      supabaseAdmin, base64Image, mimeType, conversation.id,
    );
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: imageMsg.caption || null,
      media_type: "image",
      media_url: imageMediaUrl,
    });
    if (!conversation.bot_paused && !botGloballyOff) {
      await handleReceiptImage(supabaseAdmin, conversation.id, phone, base64Image, mimeType);
    }
    return Response.json({ ok: true, action: "image_received" });
  }

  // ============ DOCUMENTO / PDF ============
  const documentMsg = data?.message?.documentMessage;
  const base64Document: string | undefined = data?.message?.base64 ?? documentMsg?.base64;
  if (documentMsg && base64Document) {
    const mimeType = documentMsg.mimetype || "application/octet-stream";
    const fileName = documentMsg.fileName || documentMsg.title || undefined;
    const docMediaUrl = await uploadMediaToStorage(
      supabaseAdmin, base64Document, mimeType, conversation.id, fileName,
    );
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: documentMsg.caption || documentMsg.fileName || null,
      media_type: "document",
      media_url: docMediaUrl,
    });
    return Response.json({ ok: true, action: "document_received" });
  }

  // ============ ÁUDIO (mensagem de voz ou arquivo de áudio) ============
  const audioMsg = data?.message?.audioMessage ?? data?.message?.pttMessage;
  const base64Audio: string | undefined = data?.message?.base64 ?? audioMsg?.base64;
  if (audioMsg && base64Audio) {
    const mimeType = audioMsg.mimetype || "audio/ogg; codecs=opus";
    const audioMediaUrl = await uploadMediaToStorage(
      supabaseAdmin, base64Audio, mimeType, conversation.id,
    );
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: null,
      media_type: "audio",
      media_url: audioMediaUrl,
    });
    if (!conversation.bot_paused && !botGloballyOff) {
      await replyAndLog(
        supabaseAdmin,
        conversation.id,
        phone,
        "Para eu conseguir registrar seu atendimento corretamente, por favor escreva sua mensagem aqui no WhatsApp.",
      );
    }
    return Response.json({ ok: true, action: "audio_received" });
  }

  // ============ LOCALIZAÇÃO ============
  const locationMsg = data?.message?.locationMessage;
  if (locationMsg) {
    const lat = Number(locationMsg.degreesLatitude);
    const lng = Number(locationMsg.degreesLongitude);
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: Number.isFinite(lat) && Number.isFinite(lng) ? `Localização compartilhada: ${lat}, ${lng}` : "Localização compartilhada",
      media_type: "location",
    });
    if (!conversation.bot_paused && !botGloballyOff) {
      await replyAndLog(
        supabaseAdmin,
        conversation.id,
        phone,
        "Recebi sua localização. Para registrar a entrega corretamente, escreva por favor a rua, o número e o bairro.",
      );
    }
    return Response.json({ ok: true, action: "location_received" });
  }

  // ============ VÍDEO ============
  const videoMsg = data?.message?.videoMessage;
  const base64Video: string | undefined = data?.message?.base64 ?? videoMsg?.base64;
  if (videoMsg && base64Video) {
    const mimeType = videoMsg.mimetype || "video/mp4";
    const videoMediaUrl = await uploadMediaToStorage(
      supabaseAdmin, base64Video, mimeType, conversation.id,
    );
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: videoMsg.caption || null,
      media_type: "video",
      media_url: videoMediaUrl,
    });
    return Response.json({ ok: true, action: "video_received" });
  }

  let text: string = opts?.preloggedText ?? (
    data?.message?.conversation ??
    data?.message?.extendedTextMessage?.text ??
    data?.message?.ephemeralMessage?.message?.conversation ??
    data?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ??
    data?.message?.text ??
    ""
  );

  if (!text.trim()) {
    // Tipo de mídia não reconhecido (figurinha, localização, reação, etc.)
    // — só registra para aparecer no histórico sem travar o fluxo
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: null,
      media_type: "document",
    });
    return Response.json({ ignored: "unsupported_media_type" });
  }

  if (!opts?.skipTextLog) {
    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: text,
      external_id: data?.key?.id ?? null,
    });
  }


  // ============ CARDÁPIO DIGITAL → LINK DE PAGAMENTO ============
  // Este caso NÃO entra no fluxo comercial comum e NÃO pede bairro.
  // O cliente já montou o pedido no cardápio e está pedindo ajuda para pagar.
  // Responde uma única vez, pausa a IA e chama atendimento manual com alarme.
  if (!botGloballyOff && !conversation.bot_paused && isDigitalPaymentLinkRequest(text)) {
    const greeting = greetingByTimeBR();
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      `${greeting}! Só um momento, por favor, que iremos gerar seu link de pagamento.`,
    );

    await requestSilentHumanHandoff(supabaseAdmin, {
      conversationId: conversation.id,
      phone,
      customerName: customerNameFromDigitalPaymentMessage(text) || conversation.customer_name || null,
      reason: "CLIENTE SOLICITANDO LINK DE PAGAMENTO",
      severity: "warn",
    });

    return Response.json({
      ok: true,
      action: "digital_payment_link_handoff",
    });
  }

  // Admin assumiu essa conversa manualmente, ou o atendimento automático está
  // desligado globalmente — em ambos os casos não responde automaticamente.
  if (conversation.bot_paused || botGloballyOff) {
    return Response.json({
      ok: true,
      action: botGloballyOff ? "bot_globally_off" : "bot_paused_skipped",
    });
  }

  // Horário de atendimento (Configurações → Horário de atendimento). Se
  // ativado e a mensagem chegar fora dos dias/horas configurados, avisa que
  // a loja está fechada (citando os dias e horários certos) e NÃO processa
  // pedido nenhum — a IA só volta a responder normalmente dentro do horário.
  const { data: hoursCfg, error: hoursCfgError } = await supabaseAdmin
    .from("store_config")
    .select("manual_store_status, business_hours_enabled, business_hours, business_hours_closed_message")
    .maybeSingle();
  if (hoursCfgError) {
    // Se a consulta falhar (ex: migration do horário de atendimento ainda
    // não rodou no banco e as colunas não existem), isso NUNCA pode passar
    // em silêncio — sem esse log, o sintoma é exatamente "configurei o
    // horário mas a IA responde normal fora de hora", sem pista nenhuma do
    // motivo. Loga e registra um alerta visível pra loja investigar.
    console.error("[business-hours] falha ao consultar store_config:", hoursCfgError.message);
    try {
      await supabaseAdmin.rpc("record_system_alert", {
        _kind: "horario_atendimento_falhou",
        _message: `Não foi possível checar o horário de atendimento configurado (erro: ${hoursCfgError.message}). Confira se a migration de horário de atendimento foi aplicada no banco.`,
        _severity: "error",
      });
    } catch {
      /* alerta não pode quebrar o fluxo */
    }
  }
  const manuallyOpen = hoursCfg?.manual_store_status === "open";
  const manuallyClosed = hoursCfg?.manual_store_status === "closed";
  const scheduledClosed =
    !manuallyOpen &&
    hoursCfg?.business_hours_enabled === true &&
    Array.isArray(hoursCfg.business_hours) &&
    hoursCfg.business_hours.length > 0 &&
    !isWithinBusinessHours(hoursCfg.business_hours as BusinessHourRange[], new Date());
  if (manuallyClosed || scheduledClosed) {
      const closedMessage =
        (hoursCfg.business_hours_closed_message as string | null)?.trim() ||
        (Array.isArray(hoursCfg.business_hours) && hoursCfg.business_hours.length > 0
          ? `Olá, obrigado pelo seu contato! Estamos fechados no momento. Nossos dias e horários de funcionamento são: ${formatBusinessHoursText(
              hoursCfg.business_hours as BusinessHourRange[],
            )}. Assim que abrirmos, respondemos por aqui.`
          : "Olá, obrigado pelo seu contato! Estamos fechados no momento. Assim que abrirmos, respondemos por aqui.");
      // Evita mandar o aviso de "fechado" repetidas vezes seguidas pro mesmo
      // cliente — só manda de novo se a última mensagem de saída não foi
      // esse mesmo aviso (ex: cliente manda 3 mensagens seguidas fora de hora).
      const { data: lastOut } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("body, media_type")
        .eq("conversation_id", conversation.id)
        .eq("direction", "out")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const alreadyWarned = lastOut?.media_type === "system" && lastOut?.body === closedMessage;
      if (!alreadyWarned) {
        await replyAndLog(supabaseAdmin, conversation.id, phone, closedMessage, {
          systemMessage: true,
        });
      }
      return Response.json({ ok: true, action: "outside_business_hours" });
  }

  const { data: cfgStore } = await supabaseAdmin
    .from("store_config")
    .select(
      "store_name, default_delivery_fee, estimated_delivery_time_minutes, delivery_pricing_mode, delivery_fee_tiers, business_hours_enabled, business_hours, ifood_store_link, nfood_store_link, ai_temperature",
    )
    .maybeSingle();
  const businessHoursText =
    cfgStore?.business_hours_enabled && Array.isArray(cfgStore?.business_hours) && cfgStore.business_hours.length
      ? formatBusinessHoursText(cfgStore.business_hours as BusinessHourRange[])
      : null;
  const maxRadiusKm =
    cfgStore?.delivery_pricing_mode === "distance" &&
    Array.isArray(cfgStore?.delivery_fee_tiers) &&
    cfgStore.delivery_fee_tiers.length
      ? Math.max(...cfgStore.delivery_fee_tiers.map((t: any) => Number(t.km_to) || 0))
      : null;
  // Links da loja no iFood/99Food (Configurações → Integrações), usados pelo
  // fluxo de REDIRECIONAMENTO FORA DE ÁREA — quando o entregador fixo do
  // WhatsApp não atende o endereço do cliente, a IA oferece esses links em
  // vez de simplesmente recusar a entrega.
  const outOfAreaLinksText = buildOutOfAreaLinksText(
    cfgStore?.ifood_store_link || null,
    cfgStore?.nfood_store_link || null,
  );
  const { catalogText, unavailableText, categoriesText } = await loadCatalogText(supabaseAdmin);
  const draft = await loadOrCreateDraft(supabaseAdmin, conversation.id);
  const lastOrderText = await loadLastOrderText(supabaseAdmin, phone);
  const lastAddressText = await loadLastAddressText(supabaseAdmin, phone);

  // carrega instruções ativas da IA — globais + as do dia de hoje (fuso Brasília)
  // resiliente: se a tabela ainda não existir no banco, ignora e continua
  let aiInstructionsText: string | null = null;
  try {
    const todayBR = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const { data: aiInstructions } = await supabaseAdmin
      .from("ai_instructions")
      .select("type, content, valid_date")
      .eq("active", true)
      .or(`type.eq.global,and(type.eq.daily,valid_date.eq.${todayBR})`);
    aiInstructionsText =
      (aiInstructions ?? []).length > 0
        ? (aiInstructions ?? [])
            .map((i: any) => `- [${i.type === "daily" ? "INSTRUÇÃO DO DIA" : "INSTRUÇÃO GERAL"}] ${i.content}`)
            .join("\n")
        : null;
  } catch {
    // tabela ai_instructions ainda não existe — continua sem instruções extras
  }

  // Diagnóstico de conexão: a tela web normalmente usa VITE_SUPABASE_URL e
  // este webhook usa SUPABASE_URL. Se ambas existirem no Railway e forem
  // diferentes, Configurações e webhook estão olhando bancos distintos.
  const serverSupabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const frontendSupabaseUrl = String(process.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const supabaseProjectMismatch = Boolean(
    serverSupabaseUrl && frontendSupabaseUrl && serverSupabaseUrl !== frontendSupabaseUrl,
  );
  if (supabaseProjectMismatch) {
    console.error(
      "[SUPABASE_CONFIG] ERRO: SUPABASE_URL e VITE_SUPABASE_URL apontam para projetos diferentes. " +
      "A tela e o webhook não estão lendo o mesmo banco.",
      { serverSupabaseUrl, frontendSupabaseUrl },
    );
  }

  // carrega a lista oficial de bairros atendidos (Configurações → Bairros
  // atendidos) — quando existe pelo menos 1 bairro ativo, ela vira a fonte
  // de verdade sobre área de entrega, veja applyBairroOverride().
  let bairrosAtendidos: string[] = [];
  let bairrosAtendidosText: string | null = null;
  let bairrosAtendidosLoadOk = false;
  try {
    // A tela de Configurações grava exatamente `nome` e `ativo` nesta tabela.
    // O webhook usa o MESMO schema e trata qualquer erro como falha de fonte,
    // em vez de interpretar silenciosamente lista vazia como "todos externos".
    const { data: bairrosRows, error: bairrosError } = await (supabaseAdmin as any)
      .from("bairros_atendidos")
      .select("id,nome,ativo")
      .order("nome");
    if (bairrosError) {
      bairrosAtendidosLoadOk = false;
      console.error("[BAIRROS_ATENDIDOS] Falha ao carregar lista oficial:", {
        code: bairrosError.code,
        message: bairrosError.message,
      });
    } else {
      bairrosAtendidosLoadOk = true;
      // Carrega todas as linhas e filtra o estado ativo em código. Isso mantém
      // o webhook fiel ao que a própria tela de Configurações exibe e evita que
      // uma diferença de serialização do campo `ativo` no PostgREST faça um
      // bairro visivelmente ativo desaparecer da lista usada pelo atendimento.
      const bairrosAtivosRows = (bairrosRows ?? []).filter((r: any) => {
        const ativo = r?.ativo;
        return ativo === true || ativo === 1 || String(ativo ?? "").toLowerCase() === "true";
      });
      bairrosAtendidos = bairrosAtivosRows
        .map((r: any) => String(r?.nome ?? "").trim())
        .filter(Boolean);
      // remove duplicados equivalentes, preservando a grafia cadastrada mais recente
      const seen = new Set<string>();
      bairrosAtendidos = bairrosAtendidos.filter((nome) => {
        const key = normalizeNeighborhoodKey(nome);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      bairrosAtendidosText = bairrosAtendidos.length ? bairrosAtendidos.join(", ") : null;
      console.info("[BAIRROS_ATENDIDOS] Lista oficial carregada", {
        count: bairrosAtendidos.length,
        bairros: bairrosAtendidos,
      });
      if (bairrosAtendidos.length === 0) {
        console.warn("[BAIRROS_ATENDIDOS] A consulta foi concluída, mas nenhum bairro ATIVO foi encontrado no banco usado pelo webhook.");
      }
    }
  } catch (err) {
    console.error("[BAIRROS_ATENDIDOS] Exceção ao carregar lista oficial:", err);
    bairrosAtendidosLoadOk = false;
  }

  // Em caso de mismatch conhecido entre o banco do frontend e o do backend,
  // a lista lida aqui NÃO pode ser tratada como fonte confiável para mandar
  // cliente para plataforma.
  if (supabaseProjectMismatch) bairrosAtendidosLoadOk = false;

  // carrega a lista de BAIRROS NÃO ATENDIDOS (Configurações → Bairros não
  // atendidos). Ela é apenas auxiliar: um bairro ATIVO em `bairros_atendidos`
  // sempre vence eventual duplicidade nesta lista.
  let bairrosNaoAtendidos: string[] = [];
  let bairrosNaoAtendidosText: string | null = null;
  try {
    const { data: bairrosNaoAtendidosRows, error: bairrosNaoError } = await (supabaseAdmin as any)
      .from("bairros_nao_atendidos")
      .select("*");
    if (!bairrosNaoError) {
      bairrosNaoAtendidos = (bairrosNaoAtendidosRows ?? [])
        .filter((r: any) => {
          const flag = r?.ativo ?? r?.active;
          return flag === undefined || flag === null ? true : Boolean(flag);
        })
        .map((r: any) => String(r?.nome ?? r?.bairro ?? r?.name ?? "").trim())
        .filter(Boolean);
      bairrosNaoAtendidosText = bairrosNaoAtendidos.length ? bairrosNaoAtendidos.join(", ") : null;
    } else {
      console.warn("[BAIRROS_NAO_ATENDIDOS] Falha ao carregar lista negativa:", bairrosNaoError);
    }
  } catch (err) {
    console.warn("[BAIRROS_NAO_ATENDIDOS] Exceção ao carregar lista negativa:", err);
  }

  // carrega a lista de RUAS NÃO ATENDIDAS (Configurações → Ruas não
  // atendidas) — mesmo princípio da lista de bairros não atendidos, mas por
  // rua específica (útil quando só um trecho/rua do bairro não é atendido).
  let ruasNaoAtendidas: string[] = [];
  let ruasNaoAtendidasText: string | null = null;
  try {
    const { data: ruasNaoAtendidasRows } = await (supabaseAdmin as any)
      .from("ruas_nao_atendidas")
      .select("nome, bairro")
      .eq("ativo", true);
    ruasNaoAtendidas = (ruasNaoAtendidasRows ?? []).map((r: any) => String(r.nome)).filter(Boolean);
    ruasNaoAtendidasText = (ruasNaoAtendidasRows ?? []).length
      ? (ruasNaoAtendidasRows ?? [])
          .map((r: any) => (r.bairro ? `${r.nome} (${r.bairro})` : String(r.nome)))
          .filter(Boolean)
          .join(", ")
      : null;
  } catch {
    // tabela ruas_nao_atendidas ainda não existe — continua sem a lista estruturada
  }

  const { data: recentMessages } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("direction, sender_type, body, media_type, created_at")
    .eq("conversation_id", conversation.id)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const filteredConversationMessages = (recentMessages ?? [])
    .filter((m: any) => {
      if (m.media_type === "system") return false;
      const b = String(m.body ?? "");
      if (m.direction === "out" && (b.startsWith("📋 Pedido") || b.startsWith("🔑"))) return false;
      return true;
    })
    .reverse();

  // Histórico completo serve apenas para saber se este telefone já teve contato
  // e para suporte. O histórico comercial do PEDIDO ATUAL começa depois do
  // último pedido WhatsApp realmente criado para este telefone.
  const allHistory = filteredConversationMessages
    .slice(-60)
    .map((m: any) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content:
        m.direction === "out" && m.sender_type === "admin"
          ? `[ATENDENTE HUMANO DA LOJA] ${m.body ?? ""}`
          : (m.body ?? ""),
    }));

  const { data: lastWhatsappOrder } = await supabaseAdmin
    .from("orders")
    .select("id,created_at,order_number")
    .eq("customer_phone", conversation.phone)
    .eq("source", "whatsapp")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentOrderMessages = lastWhatsappOrder?.created_at
    ? filteredConversationMessages.filter(
        (m: any) =>
          !m.created_at ||
          new Date(m.created_at).getTime() > new Date(lastWhatsappOrder.created_at).getTime(),
      )
    : filteredConversationMessages;

  const history = currentOrderMessages
    .slice(-40)
    .map((m: any) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content:
        m.direction === "out" && m.sender_type === "admin"
          ? `[ATENDENTE HUMANO DA LOJA] ${m.body ?? ""}`
          : (m.body ?? ""),
    }));

  // ============ SUPORTE A PEDIDO JÁ FEITO PELO SITE / CARDÁPIO DIGITAL ============
  // Tem prioridade sobre BAIRRO PRIMEIRO: aqui o cliente não está começando uma
  // compra no WhatsApp, está consultando um pedido que já existe no sistema.
  const digitalOrderSupportResponse = await handleDigitalOrderSupportIfNeeded(
    supabaseAdmin, conversation, phone, text, allHistory,
  );
  if (digitalOrderSupportResponse) return digitalOrderSupportResponse;

  // ============ PRIMEIRO CONTATO: NATURAL, SEM IGNORAR A PERGUNTA ============
  // Se o cliente abriu a conversa com uma pergunta simples (taxa, prazo,
  // pagamento, localização, horário ou preço específico), responda primeiro
  // à intenção real dele. Só peça bairro quando ele for necessário para
  // responder corretamente (taxa/cardápio/preço por região). Isso evita o
  // comportamento robótico de ignorar "qual o valor da entrega?" e começar
  // a coletar produtos.
  const assistantTurnsBeforeThisContact = allHistory.filter((m) => m.role === "assistant").length;
  if (assistantTurnsBeforeThisContact === 0) {
    // O próprio PRIMEIRO texto do cliente pode já conter o bairro. Antes de
    // pedir qualquer coisa novamente, tentamos reconhecer e persistir o bairro
    // ativo. Assim "Vila São Luís" ou "sou de Vila São Luís, qual a taxa?"
    // já deixa o atendimento validado nessa mesma rodada.
    const firstTurnNeighborhood =
      findConfiguredBairroMatch(text, bairrosAtendidos) ||
      (await findActiveNeighborhoodAuthoritatively(supabaseAdmin, text));

    if (firstTurnNeighborhood) {
      draft.delivery_mode = "delivery";
      draft.address_neighborhood = firstTurnNeighborhood;
      draft.out_of_delivery_area = false;

      const { error: firstNeighborhoodSaveError } = await supabaseAdmin
        .from("order_drafts")
        .update({
          delivery_mode: "delivery",
          address_neighborhood: firstTurnNeighborhood,
          out_of_delivery_area: false,
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversation.id);

      if (firstNeighborhoodSaveError) {
        console.error("[ORDER_MEMORY] Falha ao persistir bairro informado no primeiro turno:", firstNeighborhoodSaveError);
      }

      const normalizedFirstText = normalizeNeighborhoodKey(text);
      const normalizedFirstNeighborhood = normalizeNeighborhoodKey(firstTurnNeighborhood);
      const onlyNeighborhood =
        normalizedFirstText === normalizedFirstNeighborhood ||
        (similarity(normalizedFirstText, normalizedFirstNeighborhood) >= 0.92 &&
          normalizedFirstText.length <= normalizedFirstNeighborhood.length + 6);

      if (onlyNeighborhood) {
        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
        );
        return Response.json({ ok: true, action: "first_contact_neighborhood_accepted" });
      }
      // Se o cliente escreveu bairro + pergunta na mesma mensagem, NÃO retorna:
      // o handler informativo abaixo usa o bairro já salvo e responde a pergunta
      // sem pedi-lo novamente.
    }

    const firstContactInfo = await handleInformationalQuestionBeforeAi({
      supabaseAdmin,
      conversationId: conversation.id,
      phone,
      text,
      draft,
      cfgStore,
      businessHoursText,
      bairrosAtendidos,
      bairrosNaoAtendidos,
      bairrosAtendidosLoadOk,
      firstContact: true,
    });
    if (firstContactInfo) return firstContactInfo;

    // Só pede bairro se ele realmente ainda não foi identificado nesta rodada.
    if (!draft.address_neighborhood) {
      const greetingText = `${greetingByTimeBR()}! Para eu verificar o atendimento certinho para você, qual é o seu bairro, por favor?`;
      await replyAndLog(supabaseAdmin, conversation.id, phone, greetingText);
      return Response.json({ ok: true, action: "first_contact_neighborhood_required" });
    }
  }

  // ============ RECONCILIAÇÃO DETERMINÍSTICA DO BAIRRO ============
  // A lista POSITIVA ativa de bairros atendidos é a fonte de verdade absoluta.
  // Se um bairro atendido já foi validado no início do atendimento, ele pertence
  // ao pedido atual e não pode desaparecer só porque o cliente depois informou
  // apenas rua + número. Também não permitimos que um out_of_delivery_area antigo
  // contradiga um bairro que está ATIVO no painel.
  let canonicalServedNeighborhood = draft.address_neighborhood
    ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
    : null;

  // Se o rascunho perdeu o bairro, recupera SOMENTE um bairro real da lista ativa
  // que já tenha sido informado pelo cliente anteriormente nesta conversa.
  if (!canonicalServedNeighborhood && bairrosAtendidos.length > 0) {
    const historicalUserMessages = history
      .filter((m) => m.role === "user")
      .map((m) => String(m.content ?? ""))
      .reverse();
    for (const oldUserText of historicalUserMessages) {
      const recovered = findConfiguredBairroMatch(oldUserText, bairrosAtendidos);
      if (recovered) {
        canonicalServedNeighborhood = recovered;
        break;
      }
    }
  }

  if (canonicalServedNeighborhood) {
    const needsNeighborhoodRepair =
      normalizeNeighborhoodKey(draft.address_neighborhood) !== normalizeNeighborhoodKey(canonicalServedNeighborhood) ||
      draft.out_of_delivery_area === true ||
      draft.delivery_mode !== "delivery";

    draft.address_neighborhood = canonicalServedNeighborhood;
    draft.out_of_delivery_area = false;
    if (draft.delivery_mode !== "pickup") draft.delivery_mode = "delivery";

    if (needsNeighborhoodRepair) {
      await supabaseAdmin
        .from("order_drafts")
        .update({
          address_neighborhood: canonicalServedNeighborhood,
          out_of_delivery_area: false,
          delivery_mode: draft.delivery_mode === "pickup" ? "pickup" : "delivery",
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversation.id);
    }
  }

  // ============ PORTÃO POSITIVO AUTORITATIVO — PRIORIDADE ABSOLUTA ============
  // Antes de memória de itens/endereço/pagamento e, principalmente, antes de
  // QUALQUER possibilidade de redirecionamento, confere a mensagem atual contra
  // a tabela real `bairros_atendidos`. Se houver match ativo, a decisão termina
  // aqui: atendimento pelo WhatsApp. Nenhum histórico antigo, lista negativa,
  // cálculo por distância ou estado anterior do draft pode sobrescrever isso.
  if (draft.delivery_mode !== "pickup") {
    const authoritativeActiveNeighborhood = await findActiveNeighborhoodAuthoritatively(supabaseAdmin, text);
    if (authoritativeActiveNeighborhood) {
      draft.delivery_mode = "delivery";
      draft.address_neighborhood = authoritativeActiveNeighborhood;
      draft.out_of_delivery_area = false;
      const { error: authoritativeNeighborhoodSaveError } = await supabaseAdmin
        .from("order_drafts")
        .update({
          delivery_mode: "delivery",
          address_neighborhood: authoritativeActiveNeighborhood,
          out_of_delivery_area: false,
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversation.id);
      if (authoritativeNeighborhoodSaveError) {
        console.error("[DELIVERY_AREA] falha ao persistir bairro ativo autoritativo:", authoritativeNeighborhoodSaveError);
      }
      console.info("[DELIVERY_AREA] bairro ativo confirmado diretamente na fonte", {
        input: text,
        match: authoritativeActiveNeighborhood,
        decision: "WHATSAPP",
      });

      // Se a mensagem é essencialmente o nome do bairro (caso normal após a
      // saudação), responde o fluxo oficial e encerra esta rodada. Se o cliente
      // informou bairro + pedido na mesma mensagem, mantém o bairro travado e
      // deixa a IA processar o restante da frase.
      const normalizedInputNeighborhood = normalizeNeighborhoodKey(text);
      const normalizedMatchedNeighborhood = normalizeNeighborhoodKey(authoritativeActiveNeighborhood);
      const essentiallyOnlyNeighborhood =
        normalizedInputNeighborhood === normalizedMatchedNeighborhood ||
        (similarity(normalizedInputNeighborhood, normalizedMatchedNeighborhood) >= 0.92 &&
          normalizedInputNeighborhood.length <= normalizedMatchedNeighborhood.length + 6);
      if (essentiallyOnlyNeighborhood) {
        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
        );
        return Response.json({ ok: true, action: "active_neighborhood_authoritative" });
      }
    }
  }

  // ============ PERGUNTA INFORMATIVA TEM PRIORIDADE SOBRE COLETA DO PEDIDO ============
  // Ex.: "Valor da entrega??" nunca pode virar "Quais produtos você quer?".
  // Respondemos/solicitamos somente o dado mínimo necessário e encerramos a rodada.
  const informationalResponse = await handleInformationalQuestionBeforeAi({
    supabaseAdmin,
    conversationId: conversation.id,
    phone,
    text,
    draft,
    cfgStore,
    businessHoursText,
    bairrosAtendidos,
    bairrosNaoAtendidos,
    bairrosAtendidosLoadOk,
  });
  if (informationalResponse) return informationalResponse;

  // ============ RECOMEÇO EXPLÍCITO DO PEDIDO ============
  // "Vamos recomeçar / esqueça tudo" limpa os dados comerciais do pedido, mas
  // preserva o bairro já validado nesta conversa. Recomeçar o pedido não deve
  // obrigar o cliente a provar novamente uma informação logística já conhecida.
  if (isExplicitOrderRestartIntent(text)) {
    await resetCurrentOrderKeepingValidatedNeighborhood(supabaseAdmin, conversation.id, draft, bairrosAtendidos);
  }

  // ============ MEMÓRIA DETERMINÍSTICA DE ITENS/QUANTIDADE ============
  // Reforça o order_drafts antes de chamar a IA. Ex.: "uma batata de brócolis"
  // ou "apenas 1" após uma pergunta de quantidade não podem ser esquecidos.
  try {
    await persistObviousProductMemoryFromTurn(supabaseAdmin, conversation.id, text, history, draft);
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha ao persistir item/quantidade:", err);
  }
  try {
    await persistPaidAddonMemoryFromTurn(supabaseAdmin, conversation.id, text, draft);
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha ao persistir adicional pago:", err);
  }

  // ============ PRÉ-CAPTURA DA COLETA AGRUPADA ============
  // Quando a pergunta pede nome + endereço, salvamos o nome ANTES do cálculo
  // do frete. Se o cliente também informar pagamento espontaneamente na mesma
  // resposta, aproveitamos esse dado sem perguntar novamente depois.
  try {
    await persistDeterministicCustomerNameFromTurn(supabaseAdmin, conversation.id, text, history, draft);
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha na pré-captura de nome:", err);
  }
  try {
    const groupedPayment = inferPaymentFromCustomerTurn(text, history, draft);
    if (groupedPayment && !draft.payment_method) {
      await persistDeterministicPayment(supabaseAdmin, conversation.id, draft, groupedPayment);
    }
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha na pré-captura de pagamento:", err);
  }

  // ============ MEMÓRIA DETERMINÍSTICA DE ENDEREÇO + FRETE ============
  // "Av Brasil 324" já contém rua + número. Captura os dois e, quando isso
  // completa o endereço com o bairro já validado, calcula IMEDIATAMENTE a taxa,
  // abre o popup de aprovação e continua o atendimento na mesma rodada.
  const addressBeforeDeterministic = [draft.address_street, draft.address_number, draft.address_neighborhood]
    .map((x) => String(x ?? "").trim())
    .join("|");
  try {
    await persistDeterministicAddressFromTurn(supabaseAdmin, conversation.id, text, history, draft);
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha ao persistir endereço:", err);
  }
  const addressAfterDeterministic = [draft.address_street, draft.address_number, draft.address_neighborhood]
    .map((x) => String(x ?? "").trim())
    .join("|");
  const deterministicAddressChanged = addressAfterDeterministic !== addressBeforeDeterministic;
  const deterministicAddressComplete = Boolean(
    draft.delivery_mode === "delivery" &&
    draft.address_street?.trim() && draft.address_number?.trim() && draft.address_neighborhood?.trim(),
  );

  if (deterministicAddressChanged && deterministicAddressComplete && draft.estimated_delivery_fee == null) {
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      "Só um instante enquanto confirmo a taxa de entrega para esse endereço.",
    );

    const immediateFreight = await resolveFreightImmediatelyForCompleteDraft(
      supabaseAdmin,
      conversation,
      draft,
      bairrosAtendidos,
      bairrosNaoAtendidos,
      ruasNaoAtendidas,
    );

    if (immediateFreight.status === "manual") {
      return Response.json({ ok: true, action: "freight_manual_takeover" });
    }

    if (immediateFreight.status === "resolved" && immediateFreight.fee != null) {
      const feeText = Number(immediateFreight.fee).toFixed(2).replace(".", ",");
      const feeAlreadySent = await wasDeliveryFeeAlreadyAnnounced(
        supabaseAdmin, conversation.id, Number(immediateFreight.fee),
      );
      if (!feeAlreadySent) {
        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          `${draft.customer_name ? `${String(draft.customer_name).trim().split(/\s+/)[0]}, ` : ""}a taxa de entrega para seu endereço é de R$ ${feeText}.`,
          { systemMessage: true },
        );
      }

      // Se endereço + nome + pagamento vieram todos na mesma resposta, não
      // desperdiçamos outra rodada perguntando dados já recebidos. Com a taxa
      // aprovada, avançamos imediatamente para a etapa de bebida/resumo.
      const readyAfterFreight = Boolean(
        draft.customer_name && draft.payment_method && draft.delivery_mode && (draft.items ?? []).length &&
        draft.address_street && draft.address_number && draft.address_neighborhood && draft.estimated_delivery_fee != null,
      );

      if (readyAfterFreight && !draft.awaiting_final_confirmation) {
        const fastFlowFlags: { silenced?: boolean; sendMenuImage?: boolean } = {};
        const fastFlow = await executeTool("finalize_order", {}, {
          supabaseAdmin,
          conversation,
          draft,
          flags: fastFlowFlags,
          finalConfirmationAllowed: false,
          bairrosAtendidos,
          bairrosNaoAtendidos,
          ruasNaoAtendidas,
          currentUserText: text,
        });
        const fastStatus = String(fastFlow.result?.status ?? "");
        if (fastFlowFlags.silenced || ["beverage_offer_sent", "final_confirmation_summary_sent", "awaiting_final_confirmation"].includes(fastStatus)) {
          return Response.json({ ok: true, action: fastStatus || "freight_confirmed_fast_flow" });
        }
      }

      // Se ainda faltou algum dado, pede SOMENTE o que falta. O fallback conhece
      // tudo que já está persistido e jamais repete endereço/nome/pagamento já recebidos.
      const nextStep = buildContinuityFallback(draft);
      if (!/taxa de entrega|s[oó] um instante/i.test(nextStep)) {
        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          nextStep,
          { systemMessage: true },
        );
      }
      return Response.json({ ok: true, action: "freight_confirmed_and_flow_continued" });
    }
    // Se houve falha excepcional no cálculo, não encerra a conversa em silêncio:
    // deixa a IA continuar com o draft completo e o guardrail de continuidade.
  }

  // ============ MEMÓRIA DETERMINÍSTICA DO NOME ============
  // Se a pergunta anterior pediu o nome e o cliente respondeu "Fábio",
  // "Meu nome é Fábio", etc., o nome é salvo antes da IA. Assim o modelo não
  // consegue usar o nome apenas no texto e esquecer de persistir no rascunho.
  try {
    await persistDeterministicCustomerNameFromTurn(supabaseAdmin, conversation.id, text, history, draft);
  } catch (err) {
    console.warn("[ORDER_MEMORY] Falha ao persistir nome:", err);
  }

  // ============ CAPTURA DETERMINÍSTICA DE PAGAMENTO ============
  // Forma/momento de pagamento são dados transacionais; não dependem da memória
  // probabilística da IA. Interpreta o turno do cliente com o contexto da pergunta
  // anterior e persiste antes de qualquer nova decisão do modelo.
  const deterministicPayment = inferPaymentFromCustomerTurn(text, history, draft);
  if (deterministicPayment) {
    await persistDeterministicPayment(supabaseAdmin, conversation.id, draft, deterministicPayment);

    // Depois que a forma de pagamento foi registrada, o backend assume a
    // sequência final do atendimento. Não deixamos a IA decidir se já pode
    // perguntar "Posso fechar?". Se todos os demais dados obrigatórios estão
    // completos, finalize_order oferece a bebida (uma única vez) e somente
    // depois da resposta do cliente envia o resumo oficial com total + pergunta
    // de confirmação. Isso elimina o salto PAGAMENTO -> POSSO FECHAR.
    const structurallyReadyAfterPayment =
      Boolean(draft.customer_name && draft.delivery_mode && (draft.items ?? []).length && draft.payment_method) &&
      (draft.delivery_mode === "pickup" ||
        Boolean(draft.address_street && draft.address_number && draft.address_neighborhood && draft.estimated_delivery_fee != null));

    if (structurallyReadyAfterPayment && !draft.awaiting_final_confirmation) {
      const deterministicFlags: { silenced?: boolean; sendMenuImage?: boolean } = {};
      const next = await executeTool("finalize_order", {}, {
        supabaseAdmin,
        conversation,
        draft,
        flags: deterministicFlags,
        finalConfirmationAllowed: false,
        bairrosAtendidos,
        bairrosNaoAtendidos,
        ruasNaoAtendidas,
        currentUserText: text,
      });
      const nextStatus = String(next.result?.status ?? "");
      if (deterministicFlags.silenced || ["beverage_offer_sent", "final_confirmation_summary_sent", "awaiting_final_confirmation"].includes(nextStatus)) {
        return Response.json({ ok: true, action: nextStatus || "post_payment_flow_continued" });
      }
    }
  }

  // ============ CARDÁPIO RESPEITA O CANAL DEFINIDO PELO BAIRRO ============
  // Não existe mais atalho de cardápio antes da validação do bairro. Para entrega,
  // primeiro identificamos o bairro: atendido => cardápio/preços do WhatsApp;
  // externo => plataformas, sem expor o cardápio/preços do WhatsApp. Retirada é exceção.

  // ============ TRAVA DE BAIRRO ATENDIDO + "SIM" PARA CARDÁPIO ============
  // Depois que o sistema aceitou um bairro atendido e perguntou
  // "Gostaria de ver nosso cardápio?", uma resposta curta como "sim" NÃO pode
  // voltar para a classificação de bairro. Esse era o bug que fazia Vila São Luís
  // ser aceita e, no turno seguinte, o cliente ser redirecionado para iFood/99Food.
  const recentAssistantMessages = history
    .filter((m) => m.role === "assistant")
    .map((m) => String(m.content ?? ""));
  const previousAssistantForNeighborhood = recentAssistantMessages[recentAssistantMessages.length - 1] ?? "";
  const recentAssistantWindow = recentAssistantMessages.slice(-3).join("\n");
  const servedNeighborhoodAlreadyValidated = (() => {
    const byDraft = draft.address_neighborhood
      ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
      : null;
    if (byDraft && draft.out_of_delivery_area !== true) return byDraft;
    const previousUserMessages = history
      .filter((m) => m.role === "user")
      .map((m) => String(m.content ?? ""))
      .reverse();
    for (const userMessage of previousUserMessages) {
      if (normalizeStreet(userMessage) === normalizeStreet(text)) continue;
      const match = findConfiguredBairroMatch(userMessage, bairrosAtendidos);
      if (match) return match;
    }
    return null;
  })();
  const justAcceptedServedNeighborhood =
    /obrigado pela informa[cç][aã]o[!,. ]+.*gostaria de ver nosso card[aá]pio\?/i.test(previousAssistantForNeighborhood) ||
    /gostaria de ver nosso card[aá]pio\?/i.test(recentAssistantWindow);
  const currentTurnWantsMenuAfterServedNeighborhood =
    !!servedNeighborhoodAlreadyValidated && (
      isExplicitMenuRequest(text) ||
      (isPositiveMenuReply(text) && justAcceptedServedNeighborhood)
    );

  if (currentTurnWantsMenuAfterServedNeighborhood) {
    const servedNeighborhood = servedNeighborhoodAlreadyValidated;
    if (servedNeighborhood) {
      draft.delivery_mode = "delivery";
      draft.address_neighborhood = servedNeighborhood;
      draft.out_of_delivery_area = false;
      await supabaseAdmin
        .from("order_drafts")
        .update({
          delivery_mode: "delivery",
          address_neighborhood: servedNeighborhood,
          out_of_delivery_area: false,
          updated_at: new Date().toISOString(),
        })
        .eq("conversation_id", conversation.id);

      await replyAndLog(supabaseAdmin, conversation.id, phone, "Claro! Aqui está nosso cardápio:");
      await sendMenuImagesOnce(supabaseAdmin, conversation.id, phone, true);
      return Response.json({ ok: true, action: "served_neighborhood_menu_confirmed" });
    }
  }

  // ============ PORTÃO DETERMINÍSTICO DE BAIRRO ============
  // Para decisões de entrega, preço/promoção, cardápio e continuidade do pedido,
  // o bairro precisa ser validado. Bairro atendido segue pelo WhatsApp; bairro
  // externo segue pelas plataformas. Retirada não exige bairro.
  if (bairrosAtendidosLoadOk && draft.delivery_mode !== "pickup") {
    if (looksLikePickupIntent(text)) {
      draft.delivery_mode = "pickup";
      draft.out_of_delivery_area = false;
      await supabaseAdmin
        .from("order_drafts")
        .update({ delivery_mode: "pickup", out_of_delivery_area: false, updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation.id);
    } else if (!draft.address_neighborhood) {
      const previousAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const awaitingNeighborhood = /bairro/i.test(previousAssistant) && /(informe|qual|diga)/i.test(previousAssistant);
      const pendingSpecial = pendingSpecialNeighborhoodFromHistory(history);
      // Compatibilidade com conversas antigas: se havia uma pergunta especial
      // pendente, a lista ATIVA atual continua soberana. Se esse bairro está
      // ativo agora, aceita imediatamente; nunca redireciona por regra legada.
      if (pendingSpecial) {
        const pendingActiveMatch = findConfiguredBairroMatch(pendingSpecial, bairrosAtendidos);
        if (pendingActiveMatch) {
          draft.delivery_mode = "delivery";
          draft.address_neighborhood = pendingActiveMatch;
          draft.out_of_delivery_area = false;
          await supabaseAdmin
            .from("order_drafts")
            .update({
              delivery_mode: "delivery",
              address_neighborhood: pendingActiveMatch,
              out_of_delivery_area: false,
              updated_at: new Date().toISOString(),
            })
            .eq("conversation_id", conversation.id);
          await replyAndLog(supabaseAdmin, conversation.id, phone, "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?");
          return Response.json({ ok: true, action: "legacy_special_neighborhood_recovered_as_active" });
        }
      }

      // PRIORIDADE ABSOLUTA: antes de consultar qualquer base municipal, lista
      // negativa ou heurística, compara a mensagem diretamente com TODOS os
      // bairros ATIVOS configurados no painel. Se houver match, o bairro é
      // atendido e nenhuma outra regra pode reclassificá-lo como externo.
      const directActiveNeighborhoodMatch = findConfiguredBairroMatch(text, bairrosAtendidos);
      if (directActiveNeighborhoodMatch) {
        // DECISÃO FINAL E SOBERANA: se houve match com um bairro ATIVO do painel,
        // nenhuma regra especial, lista negativa, heurística, histórico ou cálculo
        // por distância pode transformar este cliente em "fora da área".
        console.info("[DELIVERY_AREA] bairro ativo reconhecido", {
          input: text,
          match: directActiveNeighborhoodMatch,
          decision: "WHATSAPP",
        });
        draft.delivery_mode = "delivery";
        draft.address_neighborhood = directActiveNeighborhoodMatch;
        draft.out_of_delivery_area = false;
        await supabaseAdmin
          .from("order_drafts")
          .update({
            delivery_mode: "delivery",
            address_neighborhood: directActiveNeighborhoodMatch,
            out_of_delivery_area: false,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id);

        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
        );
        return Response.json({ ok: true, action: "active_neighborhood_accepted_directly" });
      }

      const pendingNeighborhoodConfirmation = pendingNeighborhoodConfirmationFromHistory(history);
      let candidate = extractNeighborhoodCandidate(
        text,
        [...bairrosAtendidos, ...bairrosNaoAtendidos],
        awaitingNeighborhood,
      );

      // Se acabamos de pedir confirmação de um nome de bairro desconhecido e
      // o cliente respondeu "sim", agora sim esse nome passa a ser confiável.
      // Se respondeu "não", voltamos a pedir o bairro em vez de redirecionar.
      if (pendingNeighborhoodConfirmation && isExplicitOrderConfirmation(text)) {
        const best = bestKnownLocality(
          pendingNeighborhoodConfirmation,
          allKnownDuqueLocalities([...bairrosAtendidos, ...bairrosNaoAtendidos]),
        );
        candidate = best && best.score >= 0.86 ? { value: best.value, source: "known" } : null;
        if (!candidate) {
          await replyAndLog(
            supabaseAdmin,
            conversation.id,
            phone,
            "Para evitar te direcionar para o lugar errado, preciso do nome exato do seu bairro em Duque de Caxias. Pode me informar, por favor?",
          );
          return Response.json({ ok: true, action: "neighborhood_exact_name_required" });
        }
      } else if (pendingNeighborhoodConfirmation && isExplicitNegative(text)) {
        await replyAndLog(supabaseAdmin, conversation.id, phone, "Sem problema. Por favor, informe somente o nome do seu bairro para eu verificar o atendimento corretamente.");
        return Response.json({ ok: true, action: "neighborhood_required_after_correction" });
      }

      if (!candidate) {
        const hasPreviousAssistant = history.some((m) => m.role === "assistant");
        const ask = hasPreviousAssistant
          ? "Antes de continuar, informe seu bairro por favor."
          : `${greetingByTimeBR()}! Para que o atendente possa dar continuidade no seu atendimento, informe seu bairro por favor.`;
        await replyAndLog(supabaseAdmin, conversation.id, phone, ask);
        return Response.json({ ok: true, action: "neighborhood_required" });
      }

      const candidateValue = candidate.value;

      // A lista POSITIVA ativa decide primeiro e de forma definitiva.
      const attendedMatch = findConfiguredBairroMatch(candidateValue, bairrosAtendidos);
      if (attendedMatch) {
        draft.delivery_mode = "delivery";
        draft.address_neighborhood = attendedMatch;
        draft.out_of_delivery_area = false;
        await supabaseAdmin
          .from("order_drafts")
          .update({
            delivery_mode: "delivery",
            address_neighborhood: attendedMatch,
            out_of_delivery_area: false,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id);

        console.info("[DELIVERY_AREA] decisão final", {
          input: text,
          normalized: normalizeNeighborhoodKey(text),
          match: attendedMatch,
          decision: "WHATSAPP",
        });

        const onlyNeighborhood =
          similarity(normalizeNeighborhoodKey(text), normalizeNeighborhoodKey(attendedMatch)) >= 0.9 &&
          normalizeNeighborhoodKey(text).length <= normalizeNeighborhoodKey(attendedMatch).length + 8;
        if (onlyNeighborhood || awaitingNeighborhood) {
          await replyAndLog(
            supabaseAdmin,
            conversation.id,
            phone,
            "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
          );
          return Response.json({ ok: true, action: "neighborhood_accepted" });
        }
        // Se a mesma mensagem contém bairro + outro pedido/pergunta, segue o
        // fluxo normal da IA já com o bairro travado como atendido.
      } else {
        // ÚLTIMA BARREIRA antes de qualquer redirecionamento: consulta novamente
        // a fonte real do painel. Uma decisão negativa nunca pode depender apenas
        // da cópia carregada no início da execução.
        const authoritativeCandidateMatch = await findActiveNeighborhoodAuthoritatively(supabaseAdmin, candidateValue);
        if (authoritativeCandidateMatch) {
          draft.delivery_mode = "delivery";
          draft.address_neighborhood = authoritativeCandidateMatch;
          draft.out_of_delivery_area = false;
          const { error: saveError } = await supabaseAdmin
            .from("order_drafts")
            .update({
              delivery_mode: "delivery",
              address_neighborhood: authoritativeCandidateMatch,
              out_of_delivery_area: false,
              updated_at: new Date().toISOString(),
            })
            .eq("conversation_id", conversation.id);
          if (saveError) console.error("[DELIVERY_AREA] falha ao salvar recuperação autoritativa:", saveError);
          await replyAndLog(
            supabaseAdmin,
            conversation.id,
            phone,
            "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
          );
          return Response.json({ ok: true, action: "active_neighborhood_authoritative_recovery" });
        }

        // Somente um bairro/localidade REALMENTE reconhecido e AUSENTE da lista
        // positiva pode ser enviado às plataformas. Texto aleatório nunca vira
        // automaticamente "fora da área".
        const blockedMatch = findConfiguredBairroMatch(candidateValue, bairrosNaoAtendidos);
        const recognizedMunicipalityLocality = candidate.source === "known" || !!blockedMatch;
        if (!recognizedMunicipalityLocality) {
          await replyAndLog(
            supabaseAdmin,
            conversation.id,
            phone,
            "Não consegui identificar esse nome como um bairro/localidade de Duque de Caxias. Pode conferir e me informar somente o nome do bairro, por favor?",
          );
          return Response.json({ ok: true, action: "neighborhood_not_recognized" });
        }

        const externalNeighborhood = blockedMatch || candidateValue;
        draft.delivery_mode = "delivery";
        draft.address_neighborhood = externalNeighborhood;
        draft.out_of_delivery_area = true;
        await supabaseAdmin
          .from("order_drafts")
          .update({
            delivery_mode: "delivery",
            address_neighborhood: externalNeighborhood,
            out_of_delivery_area: true,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id);

        console.info("[DELIVERY_AREA] decisão final", {
          input: text,
          normalized: normalizeNeighborhoodKey(text),
          activeMatch: null,
          recognizedLocality: externalNeighborhood,
          decision: "PLATAFORMA",
        });

        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          formatOutOfAreaDirectReply(cfgStore?.ifood_store_link || null, cfgStore?.nfood_store_link || null),
        );
        return Response.json({ ok: true, action: "redirect_platforms_by_neighborhood" });
      }
    } else if (draft.out_of_delivery_area) {
      // Antes de qualquer redirecionamento, a lista POSITIVA ativa vence.
      // Se o bairro salvo está ativo no painel, corrige o estado imediatamente
      // e continua o pedido pelo WhatsApp — nunca manda esse cliente para app.
      const positiveSavedMatchFromMemory = draft.address_neighborhood
        ? findConfiguredBairroMatch(draft.address_neighborhood, bairrosAtendidos)
        : null;
      const positiveSavedMatch = positiveSavedMatchFromMemory ||
        (draft.address_neighborhood
          ? await findActiveNeighborhoodAuthoritatively(supabaseAdmin, draft.address_neighborhood)
          : null);
      if (positiveSavedMatch) {
        draft.address_neighborhood = positiveSavedMatch;
        draft.out_of_delivery_area = false;
        draft.delivery_mode = "delivery";
        await supabaseAdmin
          .from("order_drafts")
          .update({
            address_neighborhood: positiveSavedMatch,
            out_of_delivery_area: false,
            delivery_mode: "delivery",
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id);
        // Não retorna aqui: segue o fluxo normal da mensagem atual.
      } else {
      // O cliente pode corrigir o bairro depois de uma informação anterior.
      // Nunca "prendemos" a conversa no redirecionamento: se ele informar um
      // bairro atendido agora, recuperamos a venda e seguimos pelo WhatsApp.
      const correction = extractNeighborhoodCandidate(
        text,
        [...bairrosAtendidos, ...bairrosNaoAtendidos],
        true,
      );
      const correctedAttended = correction ? findConfiguredBairroMatch(correction.value, bairrosAtendidos) : null;
      // Se está na lista positiva ativa, recupera a conversa imediatamente,
      // mesmo que exista lixo/duplicidade antiga na tabela negativa.
      if (correction && correctedAttended) {
        draft.address_neighborhood = correctedAttended;
        draft.out_of_delivery_area = false;
        await supabaseAdmin
          .from("order_drafts")
          .update({
            address_neighborhood: correctedAttended,
            out_of_delivery_area: false,
            updated_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id);
        await replyAndLog(
          supabaseAdmin,
          conversation.id,
          phone,
          "Obrigado pela informação! Em que posso ajudar? Gostaria de ver nosso cardápio?",
        );
        return Response.json({ ok: true, action: "neighborhood_corrected_to_attended" });
      }

      await replyAndLog(
        supabaseAdmin,
        conversation.id,
        phone,
        formatOutOfAreaDirectReply(cfgStore?.ifood_store_link || null, cfgStore?.nfood_store_link || null),
      );
      return Response.json({ ok: true, action: "redirect_platforms_existing_neighborhood" });
      }
    }
  }

  // SEGURANÇA CRÍTICA: se a tabela oficial de bairros não pôde ser carregada,
  // jamais classifique o cliente como "fora da área" com base em heurística,
  // prompt antigo ou lista municipal. Uma falha de banco não pode virar perda
  // de venda. Mantém o atendimento sem redirecionamento e registra o erro no log.
  if (!bairrosAtendidosLoadOk && draft.delivery_mode !== "pickup") {
    if (draft.out_of_delivery_area) {
      draft.out_of_delivery_area = false;
      await supabaseAdmin
        .from("order_drafts")
        .update({ out_of_delivery_area: false, updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation.id);
    }
    console.error("[BAIRROS_ATENDIDOS] Lista oficial indisponível; redirecionamento automático bloqueado por segurança.");
  }

  // Saudação pura ("bom dia", "oi", etc, sozinha) NUNCA pode acionar nenhuma
  // ferramenta nesta rodada — nem update_order_draft, nem finalize_order —
  // não importa o que já esteja salvo no rascunho dessa conversa. Isso é o
  // que impede a IA de "fechar pedido sozinha" em cima de dado antigo quando
  // o cliente só deu um oi.
  const forceNoTools = isPureGreeting(text);

  // ============ ATALHO DETERMINÍSTICO PRO PRIMEIRO CONTATO ============
  // Quando o cliente manda só uma saudação pura ("oi", "bom dia"...) NO
  // PRIMEIRO CONTATO da conversa, a resposta NÃO passa pela IA — é montada
  // aqui, em código, sempre igual: cumprimento + pergunta curta de como
  // ajudar. Depender só da instrução no prompt ("não despeje o cardápio
  // inteiro numa saudação") é frágil — o modelo pode ignorá-la, como
  // aconteceu de fato em produção (cliente mandou "boa tarde" e a IA
  // respondeu com a loja inteira de categorias e preços). Com esse atalho,
  // uma saudação pura no primeiro contato é estruturalmente impossível de
  // virar um despejo de cardápio: o código nunca chama o modelo pra essa
  // resposta, então não existe texto pra ele gerar errado.
  // OBS: a imagem do cardápio NÃO é mais enviada aqui — só quando o cliente
  // pedir (ver ferramenta send_menu_image).
  const assistantTurnsSoFar = history.filter((m) => m.role === "assistant").length;
  const isFirstContactTurn = assistantTurnsSoFar === 0;
  if (forceNoTools && isFirstContactTurn) {
    const storeNameForGreeting = cfgStore?.store_name || "a loja";
    const greetingText = `${greetingByTimeBR()}! Para que o atendente possa dar continuidade no seu atendimento, informe seu bairro por favor.`;
    await replyAndLog(supabaseAdmin, conversation.id, phone, greetingText);
    return Response.json({ ok: true, action: "conversation_turn" });
  }

  const { silenced, finalText, pixBlock, pixKeyLabel, pixKeyMessage, sendMenuImage } = await runConversationalTurn({
    supabaseAdmin,
    conversation,
    draft,
    history,
    storeName: cfgStore?.store_name || "a loja",
    catalogText,
    unavailableText,
    categoriesText,
    pushName,
    pricingMode: cfgStore?.delivery_pricing_mode || "flat",
    maxRadiusKm,
    flatFee: Number(cfgStore?.default_delivery_fee ?? 0),
    deliveryTimeMinutes: cfgStore?.estimated_delivery_time_minutes ?? null,
    lastOrderText,
    lastAddressText,
    aiInstructionsText,
    bairrosAtendidos,
    bairrosAtendidosText,
    bairrosNaoAtendidos,
    bairrosNaoAtendidosText,
    ruasNaoAtendidas,
    ruasNaoAtendidasText,
    forceNoTools,
    businessHoursText,
    outOfAreaLinksText,
  });

  // Gerente recusou a taxa de entrega calculada: a conversa passou pro modo
  // manual e a IA não manda nada — quem responde agora é a loja.
  if (silenced) {
    return Response.json({ ok: true, action: "freight_manual_takeover" });
  }

  if (finalText) {
    await replyAndLog(supabaseAdmin, conversation.id, phone, finalText);
  }
  // A imagem do cardápio só é enviada quando a IA chamou a ferramenta
  // send_menu_image nesta rodada (cliente pediu o cardápio ou perguntou
  // preço/valor de forma genérica) — nunca mais automaticamente no primeiro
  // contato. force=true porque, se a IA decidiu chamar a ferramenta, é
  // porque o cliente pediu — inclusive se for um reenvio.
  if (sendMenuImage) {
    await sendMenuImagesOnce(supabaseAdmin, conversation.id, phone, isExplicitMenuRequest(text));
  }
  if (pixBlock) {
    await replyAndLog(supabaseAdmin, conversation.id, phone, pixBlock, { systemMessage: true });
  }
  // Título da chave e a chave em si vão em DUAS mensagens separadas — assim o
  // cliente consegue segurar e copiar só o código, sem o texto "chave
  // aleatória" grudado junto (o WhatsApp copia a mensagem inteira).
  if (pixKeyLabel) {
    await replyAndLog(supabaseAdmin, conversation.id, phone, pixKeyLabel, { systemMessage: true });
  }
  if (pixKeyMessage) {
    await replyAndLog(supabaseAdmin, conversation.id, phone, pixKeyMessage, {
      systemMessage: true,
    });
  }
  if (!finalText && !pixBlock && !pixKeyLabel && !pixKeyMessage) {
    // PROTEÇÃO DE CONTINUIDADE: mesmo se a IA falhar depois de uma correção,
    // ambiguidade ou sequência de ferramentas, o cliente não fica abandonado.
    // O backend pergunta o próximo dado estrutural que falta no rascunho.
    await replyAndLog(
      supabaseAdmin,
      conversation.id,
      phone,
      buildContinuityFallback(draft),
      { systemMessage: true },
    );
  }

  return Response.json({ ok: true, action: "conversation_turn" });
}

export async function handleIncomingMessage(
  payload: any,
  opts?: { skipEvolutionKillSwitch?: boolean },
): Promise<Response> {
  const phone = extractPhoneFromEvolutionPayload(payload);
  if (!phone) return handleIncomingMessageUnlocked(payload, opts);

  const event = String(payload?.event ?? payload?.type ?? "").toLowerCase();
  const msgStatus = String(payload?.data?.status ?? "").toUpperCase();
  // Eventos de status/ack e eventos que não são mensagem continuam no caminho
  // original; nunca entram no debounce nem são gravados como fala do cliente.
  if (!event.includes("message") || ["DELIVERY_ACK", "READ", "PLAYED", "SERVER_ACK"].includes(msgStatus)) {
    return handleIncomingMessageUnlocked(payload, opts);
  }

  // Mantém o kill-switch da Evolution também na etapa de pré-ingestão.
  if (!opts?.skipEvolutionKillSwitch) {
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const { isEvolutionDisabled } = await import("@/lib/whatsapp-send.server");
    if (await isEvolutionDisabled(sb)) return Response.json({ ignored: "evolution_disabled" });
  }

  // Para mensagens de texto, fazemos a ingestão ANTES do lock e esperamos um
  // curto período de silêncio. Assim duas mensagens enviadas uma atrás da outra
  // entram juntas no histórico antes de a IA responder. Só um dos webhooks
  // processa o lote; os demais percebem que já houve resposta e encerram.
  const rawData = payload?.data ?? payload?.message ?? payload;
  const data = Array.isArray(rawData?.messages) ? rawData.messages[0] : rawData;
  const fromMe = data?.key?.fromMe;
  const remoteJid: string = data?.key?.remoteJid ?? "";
  const incomingText: string =
    data?.message?.conversation ??
    data?.message?.extendedTextMessage?.text ??
    data?.message?.ephemeralMessage?.message?.conversation ??
    data?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ??
    data?.message?.text ??
    "";

  const isPlainText = Boolean(
    incomingText.trim() && !fromMe && remoteJid && !remoteJid.endsWith("@g.us"),
  );

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (isPlainText) {
    const pushName: string = data?.pushName ?? "";
    const conversation = await getOrCreateConversation(supabaseAdmin, phone, pushName);
    const externalId = data?.key?.id ?? null;

    // Deduplicação do webhook: se o provedor reenviar a mesma mensagem, ela não
    // entra duas vezes no histórico nem dispara uma segunda resposta/cardápio.
    if (externalId) {
      const { data: existing } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("id")
        .eq("conversation_id", conversation.id)
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing) return Response.json({ ok: true, action: "duplicate_message_ignored" });
    }

    await logMessage(supabaseAdmin, conversation.id, {
      direction: "in",
      sender_type: "customer",
      body: incomingText,
      external_id: externalId,
    });

    // Debounce humano: clientes frequentemente mandam 2 ou 3 mensagens em
    // sequência. Damos 1,2 s para elas chegarem antes de montar a resposta.
    await new Promise((r) => setTimeout(r, 1200));

    const locked = await acquireWhatsappProcessingLock(supabaseAdmin, phone);
    if (!locked) {
      console.warn(`[conversation-lock] timeout aguardando turno anterior de ${phone}`);
      return Response.json({ ok: true, action: "conversation_queued" });
    }

    try {
      const { data: pendingInbound } = await (supabaseAdmin as any)
        .from("whatsapp_messages")
        .select("id, body, created_at")
        .eq("conversation_id", conversation.id)
        .eq("direction", "in")
        .is("media_type", null)
        .is("ai_processed_at", null)
        .not("body", "is", null)
        .order("created_at", { ascending: true })
        .limit(10);

      if (!pendingInbound?.length) {
        // Outro webhook do mesmo lote já processou essas mensagens.
        return Response.json({ ok: true, action: "batched_message_already_answered" });
      }

      const batchIds = pendingInbound.map((m: any) => m.id).filter(Boolean);
      const combinedText = pendingInbound
        .map((m: any) => String(m.body ?? "").trim())
        .filter(Boolean)
        .join("\n");

      const response = await handleIncomingMessageUnlocked(payload, {
        ...opts,
        preloggedConversation: conversation,
        preloggedText: combinedText || incomingText,
        skipTextLog: true,
      });

      // Só marca como processado depois que o turno terminou com sucesso.
      // Mensagens que chegarem DURANTE a resposta não pertencem a batchIds e
      // continuam pendentes para o próximo turno — nunca somem silenciosamente.
      if (batchIds.length) {
        await (supabaseAdmin as any)
          .from("whatsapp_messages")
          .update({ ai_processed_at: new Date().toISOString() })
          .in("id", batchIds)
          .is("ai_processed_at", null);
      }
      return response;
    } finally {
      await releaseWhatsappProcessingLock(supabaseAdmin, phone);
    }
  }

  // Mídias/status continuam serializados pelo lock antigo.
  const locked = await acquireWhatsappProcessingLock(supabaseAdmin, phone);
  if (!locked) {
    console.warn(`[conversation-lock] timeout aguardando turno anterior de ${phone}`);
    return Response.json({ ok: true, action: "conversation_queued" });
  }
  try {
    return await handleIncomingMessageUnlocked(payload, opts);
  } finally {
    await releaseWhatsappProcessingLock(supabaseAdmin, phone);
  }
}

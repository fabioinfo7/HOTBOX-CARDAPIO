import { createServerFn } from "@tanstack/react-start";
import { getEffectivePrice } from "./promotions";

// ============================================================
// "Gerar pedido com IA" — botão do chat manual.
//
// Quando o admin assume uma conversa e fecha o pedido "no papo" (sem passar
// pelo fluxo automático da IA), nada grava o pedido sozinho — foi por isso
// que esse botão existe. Ele pega TODO o histórico daquela conversa (as
// mensagens do cliente E as do atendente), manda pra uma IA só de extração
// (ela NÃO conversa com ninguém, só lê e organiza) e usa o resultado pra
// rodar exatamente a mesma validação e o mesmo fluxo de criação de pedido
// que o robô usa quando fecha um pedido sozinho — mesma checagem de campo
// obrigatório, mesmo casamento de produto com o cardápio real, mesmo cálculo
// de taxa de entrega. Não existe um "segundo caminho" mais frouxo pra pedido
// manual: é a mesma régua.
// ============================================================

type AiProvider = "openai" | "groq1";

const AI_PROVIDERS: Record<AiProvider, { endpoint: string; model: string }> = {
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  groq1: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
};

/** Mesmo esquema de failover do atendimento automático — ChatGPT é o principal, Groq é a reserva. */
async function callExtractionAi(supabaseAdmin: any, messages: any[]): Promise<string | null> {
  const { data } = await supabaseAdmin.from("store_config").select("openai_api_key, groq_api_key").maybeSingle();

  const order: { provider: AiProvider; key: string | null }[] = [
    { provider: "openai", key: data?.openai_api_key || null },
    { provider: "groq1", key: data?.groq_api_key || null },
  ];

  for (const { provider, key } of order) {
    if (!key) continue;
    const cfg = AI_PROVIDERS[provider];
    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (content) return content;
    } catch {
      continue;
    }
  }
  return null;
}

type ExtractedAddon = { name: string; quantity?: number | null };
type ExtractedItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
  addons?: ExtractedAddon[];
};
export type ExtractedOrderFromChat = {
  customer_name: string | null;
  delivery_mode: "delivery" | "pickup" | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_reference: string | null;
  items: ExtractedItem[];
  payment_method: "pix" | "card" | null;
  card_type: "credit" | "debit" | null;
  payment_timing: "now" | "delivery" | null;
  notes: string | null;
};

function buildExtractionPrompt(catalogLines: string[], transcript: string): any[] {
  const system = `Você lê uma conversa de WhatsApp entre um ATENDENTE e um CLIENTE de uma loja de delivery e extrai, SÓ dela, os dados do pedido que o cliente confirmou.

🚨 REGRA MÁXIMA: só preencha um campo se ele foi CLARAMENTE dito ou confirmado na conversa. Nunca invente, nunca deduza, nunca complete com "o mais comum". Se algo não apareceu na conversa, deixe null (ou lista vazia pra itens). A loja NÃO aceita dinheiro em espécie: se o cliente mencionar dinheiro, deixe payment_method como null; as únicas formas válidas são Pix ou cartão.

Produtos e adicionais válidos: use APENAS os nomes EXATOS abaixo. Cada linha mostra um produto e, quando houver, seus adicionais cadastrados com os preços atuais.
${catalogLines.map((line) => `- ${line}`).join("\n")}

REGRA DE ADICIONAIS: só registre um adicional se ele estiver listado para aquele produto. Nunca invente adicional ou preço.

Responda SOMENTE um JSON, sem nenhum texto antes ou depois, no formato exato:
{
  "customer_name": string ou null,
  "delivery_mode": "delivery" ou "pickup" ou null,
  "address_street": string ou null,
  "address_number": string ou null,
  "address_complement": string ou null,
  "address_neighborhood": string ou null,
  "address_reference": string ou null,
  "items": [{"product_name": string, "quantity": number, "notes": string ou null, "addons": [{"name": string, "quantity": number}]}],
  "payment_method": "pix" ou "card" ou null,
  "card_type": "credit" ou "debit" ou null,
  "payment_timing": "now" ou "delivery" ou null,
  "notes": string ou null
}`;

  const user = `Conversa SOMENTE do pedido atual (C = cliente, A = atendente):\n\n${transcript}

IMPORTANTE: nunca misture este pedido com pedidos anteriores. Se uma informação não estiver neste trecho atual da conversa, deixe o campo vazio/null.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

type GenerateOrderOverrides = Partial<Pick<ExtractedOrderFromChat,
  | "customer_name"
  | "delivery_mode"
  | "address_street"
  | "address_number"
  | "address_complement"
  | "address_neighborhood"
  | "address_reference"
  | "payment_method"
  | "notes"
>> & { items_text?: string | null };

function parseManualItemsText(text: string): ExtractedItem[] {
  return String(text || "")
    .split(/\n|;/)
    .flatMap((line) => line.split(/,(?=\s*\d+\s*[xX])/))
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(\d+)\s*[xX]?\s*(.+)$/);
      if (m) return { product_name: m[2].trim(), quantity: Math.max(1, Number(m[1]) || 1), notes: null };
      return { product_name: raw, quantity: 1, notes: null };
    });
}

function applyOverrides(extracted: ExtractedOrderFromChat, overrides?: GenerateOrderOverrides | null) {
  if (!overrides) return extracted;
  const next: ExtractedOrderFromChat = { ...extracted };
  const scalarKeys: (keyof GenerateOrderOverrides)[] = [
    "customer_name", "delivery_mode", "address_street", "address_number",
    "address_complement", "address_neighborhood", "address_reference",
    "payment_method", "notes",
  ];
  for (const key of scalarKeys) {
    const value = overrides[key];
    if (typeof value === "string" && value.trim()) (next as any)[key] = value.trim();
  }
  if (overrides.items_text?.trim()) next.items = parseManualItemsText(overrides.items_text);
  return next;
}

export const generateOrderFromConversation = createServerFn({ method: "POST" })
  .inputValidator((data: { conversationId: string; overrides?: GenerateOrderOverrides }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conversation } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("id, phone, customer_name")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conversation) return { status: "error", detail: "Conversa não encontrada." };

    const { data: msgs } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("direction, sender_type, body, media_type, created_at")
      .eq("conversation_id", data.conversationId)
      .not("body", "is", null)
      .order("created_at", { ascending: true })
      .limit(200);

    const { data: lastWhatsappOrder } = await supabaseAdmin
      .from("orders")
      .select("id,created_at,order_number")
      .eq("customer_phone", conversation.phone)
      .eq("source", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const relevant = (msgs ?? []).filter((m: any) => {
      if (m.media_type === "system" || !String(m.body ?? "").trim()) return false;
      if (!lastWhatsappOrder?.created_at || !m.created_at) return true;
      return new Date(m.created_at).getTime() > new Date(lastWhatsappOrder.created_at).getTime();
    });

    if (!relevant.length) {
      return {
        status: "empty_conversation",
        detail: "Não há mensagens de um novo pedido depois do último pedido já criado.",
      };
    }

    const transcript = relevant
      .map((m: any) => `${m.direction === "in" ? "C" : "A"}: ${m.body}`)
      .join("\n");

    const { data: products } = await supabaseAdmin.from("products").select("id,name,sale_price,promotion_active,promotion_price,promotion_type,promotion_start_at,promotion_end_at,promotion_days_of_week,promotion_time_start,promotion_time_end,promotion_label").eq("active", true);
    const productList = products ?? [];
    if (!productList.length) return { status: "error", detail: "Nenhum produto ativo cadastrado no cardápio." };

    const productIds = productList.map((p: any) => String(p.id));
    const [{ data: links }, { data: groups }, { data: addonOptions }] = await Promise.all([
      supabaseAdmin.from("product_addon_groups").select("product_id,group_id").in("product_id", productIds),
      supabaseAdmin.from("menu_addon_groups").select("id,active").eq("active", true),
      supabaseAdmin
        .from("menu_addon_options")
        .select("id,group_id,name,display_name,price,linked_product_id,use_linked_product_price,active")
        .eq("active", true),
    ]);

    const linkedIds = Array.from(
      new Set(
        (addonOptions ?? [])
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

    for (const option of addonOptions ?? []) {
      if (!activeGroupIds.has(String(option.group_id))) continue;

      const linked = option.linked_product_id
        ? linkedById.get(String(option.linked_product_id))
        : null;

      if (option.linked_product_id && (!linked || linked.active !== true)) continue;

      const price =
        option.use_linked_product_price === true && linked
          ? Number(getEffectivePrice(linked).price || 0)
          : Number(option.price || 0);

      const list = optionsByGroup.get(String(option.group_id)) ?? [];
      list.push({ ...option, effective_price: price });
      optionsByGroup.set(String(option.group_id), list);
    }

    const addonsByProduct = new Map<string, any[]>();
    for (const link of links ?? []) {
      const list = addonsByProduct.get(String(link.product_id)) ?? [];
      list.push(...(optionsByGroup.get(String(link.group_id)) ?? []));
      addonsByProduct.set(String(link.product_id), list);
    }

    const catalogLines = productList.map((product: any) => {
      const addons = addonsByProduct.get(String(product.id)) ?? [];
      const addonText = addons.length
        ? ` | Adicionais: ${addons
            .map(
              (option: any) =>
                `${String(option.display_name || option.name)} (+R$ ${Number(option.effective_price || 0)
                  .toFixed(2)
                  .replace(".", ",")})`,
            )
            .join(", ")}`
        : "";

      return `${product.name}${addonText}`;
    });

    const aiMessages = buildExtractionPrompt(catalogLines, transcript);
    const raw = await callExtractionAi(supabaseAdmin, aiMessages);
    if (!raw) return { status: "ai_unavailable" };

    let extracted: ExtractedOrderFromChat;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      extracted = JSON.parse(cleaned);
      extracted.items = Array.isArray(extracted.items)
        ? extracted.items.map((item: any) => ({
            ...item,
            product_name: String(item?.product_name || "").trim(),
            quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)),
            notes: item?.notes == null ? null : String(item.notes),
            addons: Array.isArray(item?.addons)
              ? item.addons
                  .map((addon: any) => ({
                    name: String(addon?.name || "").trim(),
                    quantity: Math.max(1, Math.round(Number(addon?.quantity) || 1)),
                  }))
                  .filter((addon: ExtractedAddon) => Boolean(addon.name))
              : [],
          }))
        : [];
    } catch {
      return { status: "error", detail: "A IA não retornou um JSON válido — tente de novo." };
    }

    if ((extracted.payment_method as any) === "cash") extracted.payment_method = null;
    if (extracted.payment_method !== "card") extracted.card_type = null;

    // O botão manual pode complementar somente o que a conversa não trouxe.
    // Os overrides nunca alteram o fluxo automático do WhatsApp: são usados
    // exclusivamente quando o operador clica em “Gerar pedido com IA”.
    extracted = applyOverrides(extracted, data.overrides);

    // Se há endereço completo, a intenção de entrega está materialmente clara.
    // Isso evita bloquear o operador só porque a conversa não usou a palavra “entrega”.
    if (!extracted.delivery_mode && extracted.address_street && extracted.address_number) {
      extracted.delivery_mode = "delivery";
    }

    const isPickup = extracted.delivery_mode === "pickup";

    const missing: string[] = [];
    if (!extracted.customer_name) missing.push("nome do cliente");
    if (!extracted.delivery_mode) missing.push("se é entrega ou retirada no local");
    if (!isPickup) {
      if (!extracted.address_street) missing.push("rua do endereço");
      if (!extracted.address_number) missing.push("número do endereço");
      if (!extracted.address_neighborhood) missing.push("bairro");
    }
    if (!extracted.items?.length) missing.push("itens do pedido");
    if (!extracted.payment_method) missing.push("forma de pagamento");
    if (missing.length) {
      const missingKeys: string[] = [];
      if (!extracted.customer_name) missingKeys.push("customer_name");
      if (!extracted.delivery_mode) missingKeys.push("delivery_mode");
      if (!isPickup) {
        if (!extracted.address_street) missingKeys.push("address_street");
        if (!extracted.address_number) missingKeys.push("address_number");
        if (!extracted.address_neighborhood) missingKeys.push("address_neighborhood");
      }
      if (!extracted.items?.length) missingKeys.push("items");
      if (!extracted.payment_method) missingKeys.push("payment_method");
      return { status: "missing_fields", missing, missingKeys, extracted };
    }

    // Produto + adicionais são precificados exclusivamente pelo cadastro atual.
    const { findProductMatch, findProductSuggestions } = await import("./product-match.server");
    const unmatchedNames: string[] = [];
    const suggestions: { raw: string; closest: string[] }[] = [];
    const unmatchedAddons: Array<{ product: string; addon: string; available: string[] }> = [];

    const items = extracted.items.map((it) => {
      const match = findProductMatch(productList, it.product_name);
      if (!match) {
        unmatchedNames.push(it.product_name);
        suggestions.push({
          raw: it.product_name,
          closest: findProductSuggestions(productList, it.product_name),
        });
      }

      const base = match
        ? getEffectivePrice(match)
        : { price: 0, listPrice: null, isPromotion: false };
      const availableOptions = match
        ? addonsByProduct.get(String(match.id)) ?? []
        : [];

      let addonExtra = 0;
      const addonDescriptions: string[] = [];

      for (const requested of it.addons ?? []) {
        const key = String(requested.name || "").trim().toLowerCase();
        const option =
          availableOptions.find(
            (candidate: any) =>
              String(candidate.display_name || candidate.name)
                .trim()
                .toLowerCase() === key,
          ) ||
          availableOptions.find((candidate: any) => {
            const candidateKey = String(candidate.display_name || candidate.name)
              .trim()
              .toLowerCase();
            return candidateKey.includes(key) || key.includes(candidateKey);
          });

        if (!option) {
          unmatchedAddons.push({
            product: match?.name || it.product_name,
            addon: requested.name,
            available: availableOptions.map((candidate: any) =>
              String(candidate.display_name || candidate.name),
            ),
          });
          continue;
        }

        const addonQty = Math.max(1, Math.round(Number(requested.quantity) || 1));
        const addonValue = Number(option.effective_price || 0);
        addonExtra += addonValue * addonQty;
        addonDescriptions.push(
          `${addonQty}x ${String(option.display_name || option.name)} (+R$ ${(addonValue * addonQty)
            .toFixed(2)
            .replace(".", ",")})`,
        );
      }

      const noteParts = [
        it.notes ? String(it.notes).trim() : "",
        addonDescriptions.length ? `Adicionais: ${addonDescriptions.join(", ")}` : "",
      ].filter(Boolean);

      return {
        product_id: match?.id ?? null,
        product_name: match?.name ?? it.product_name,
        quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
        unit_price: Number(base.price || 0) + addonExtra,
        list_price:
          base.listPrice == null ? null : Number(base.listPrice || 0) + addonExtra,
        is_promotion_price: Boolean(base.isPromotion),
        notes: noteParts.length ? noteParts.join(" • ") : null,
      };
    });

    if (unmatchedNames.length)
      return {
        status: "unmatched_products",
        items: unmatchedNames,
        suggestions,
        extracted,
      };

    if (unmatchedAddons.length)
      return {
        status: "unmatched_addons",
        items: unmatchedAddons,
        extracted,
      };

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select(
        "default_delivery_fee, pix_key, pix_copia_cola, fixed_delivery_city, delivery_pricing_mode, store_lat, store_lng, google_maps_api_key, delivery_fee_tiers",
      )
      .maybeSingle();

    let deliveryFee = 0;
    let distanceKm: number | null = null;
    if (!isPickup) {
      if (cfg?.delivery_pricing_mode === "distance") {
        const fullAddress = [extracted.address_street, extracted.address_number, extracted.address_neighborhood]
          .filter(Boolean)
          .join(", ");
        try {
          const { calculateDeliveryFee } = await import("./delivery-distance.server");
          const result = await calculateDeliveryFee(cfg as any, fullAddress, {
            supabaseAdmin,
            phone: conversation.phone,
          });
          if (result.outOfArea) return { status: "out_of_delivery_area", extracted };
          deliveryFee = result.fee;
          distanceKm = result.distanceKm;
        } catch {
          return { status: "delivery_fee_unavailable", extracted };
        }
      } else {
        const { data: areaQuote, error: areaQuoteError } = await supabaseAdmin.rpc(
          "check_delivery_area_public",
          {
            p_neighborhood: extracted.address_neighborhood,
            p_street: extracted.address_street || null,
          },
        );

        if (!areaQuoteError && areaQuote?.supported === false) {
          return { status: "out_of_delivery_area", extracted };
        }

        deliveryFee =
          !areaQuoteError && areaQuote?.fee != null
            ? Number(areaQuote.fee || 0)
            : Number(cfg?.default_delivery_fee ?? 0);
      }
    }

    const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const total = subtotal + deliveryFee;

    const changeForValue: number | null = null;

    const resolvedPaymentTiming = extracted.payment_timing ?? (extracted.payment_method !== "pix" ? "delivery" : null);
    const paymentStatus =
      extracted.payment_method === "pix" && extracted.payment_timing === "now" ? "awaiting_payment" : "pending";

    const orderPayload = {
      source: "whatsapp",
      created_at: new Date().toISOString(),
      customer_name: extracted.customer_name,
      customer_phone: conversation.phone,
      delivery_mode: isPickup ? "pickup" : "delivery",
      address_street: isPickup ? null : extracted.address_street,
      address_number: isPickup ? null : extracted.address_number,
      address_complement: isPickup ? null : extracted.address_complement,
      address_neighborhood: isPickup ? null : extracted.address_neighborhood,
      address_city: isPickup ? null : cfg?.fixed_delivery_city || null,
      address_reference: isPickup ? null : extracted.address_reference,
      notes: extracted.notes ?? null,
      payment_method: extracted.payment_method,
      card_type: extracted.payment_method === "card" ? extracted.card_type : null,
      payment_timing: resolvedPaymentTiming,
      payment_status: paymentStatus,
      change_for: null,
      pix_code: extracted.payment_method === "pix" ? cfg?.pix_copia_cola || cfg?.pix_key || null : null,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      delivery_distance_km: distanceKm,
      status: "pending_review",
    };

    const { data: atomicOrder, error: atomicError } = await supabaseAdmin.rpc("create_whatsapp_order_atomic", {
      p_order: orderPayload,
      p_items: items,
    });
    let order: { id: string; order_number: number | null } | null = atomicOrder
      ? { id: String((atomicOrder as any).id), order_number: Number((atomicOrder as any).order_number) }
      : null;

    if (atomicError && /create_whatsapp_order_atomic|PGRST202|schema cache/i.test(String(atomicError.message ?? atomicError.code))) {
      const { data: legacyOrder, error: legacyError } = await supabaseAdmin
        .from("orders")
        .insert(orderPayload)
        .select("id, order_number")
        .single();
      if (legacyError || !legacyOrder) return { status: "error", detail: String(legacyError?.message ?? "erro ao gravar pedido") };
      const { error: itemsError } = await supabaseAdmin
        .from("order_items")
        .insert(items.map((i) => ({ ...i, order_id: legacyOrder.id })));
      if (itemsError) {
        await supabaseAdmin.from("orders").delete().eq("id", legacyOrder.id);
        return { status: "error", detail: `Falha ao gravar itens do pedido: ${itemsError.message}` };
      }
      order = legacyOrder;
    } else if (atomicError || !order) {
      return { status: "error", detail: String(atomicError?.message ?? "erro ao gravar pedido e itens") };
    }

    // ── Conversions API: evento Purchase ────────────────────────────────────
    // Dispara somente se a conversa veio de um anúncio (tem ctwa_clid salvo).
    // Não aguarda — o pedido já foi criado com sucesso, CAPI é best-effort.
    try {
      const { data: conv } = await supabaseAdmin
        .from("whatsapp_conversations")
        .select("id, ctwa_clid, capi_purchase_sent_at")
        .eq("phone", conversation.phone)
        .maybeSingle();

      if (conv?.ctwa_clid && !conv?.capi_purchase_sent_at) {
        const { firePurchaseEvent } = await import("@/lib/meta-capi.server");
        firePurchaseEvent(supabaseAdmin, {
          phone: conversation.phone,
          name: extracted.customer_name ?? undefined,
          orderId: order.id,
          value: total,
          ctwaClid: conv.ctwa_clid,
          conversationId: conv.id,
        }).catch((err) => console.error("[CAPI] erro ao enviar Purchase:", err));
      }
    } catch (err) {
      console.error("[CAPI] erro inesperado ao verificar Purchase:", err);
    }
    // ─────────────────────────────────────────────────────────────────────────

    return { status: "ok", order_number: order.order_number, order_id: order.id, total };
  });

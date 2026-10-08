import { createServerFn } from "@tanstack/react-start";

function normalizeTranscript(rows: any[]) {
  return rows
    .filter((m) => m?.body || m?.media_type)
    .slice(-120)
    .map((m) => `${m.direction === "in" ? "CLIENTE" : "ATENDENTE"}: ${m.body || `[${m.media_type || "mídia"}]`}`)
    .join("\n");
}

async function extractAddress(supabaseAdmin: any, transcript: string, fallbackCity: string) {
  const { data: aiCfg } = await supabaseAdmin.from("store_config").select("openai_api_key, groq_api_key").maybeSingle();
  const key = aiCfg?.openai_api_key || aiCfg?.groq_api_key;
  if (!key) return null;
  const endpoint = aiCfg?.openai_api_key
    ? { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" }
    : { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" };
  const prompt = `Analise a conversa e extraia somente o endereço de entrega que o CLIENTE informou/confirmou. Não invente dados. A cidade padrão é ${fallbackCity} - RJ. Retorne JSON puro no formato {"street":"","number":"","neighborhood":"","complement":"","city":""}. Se não houver endereço suficiente, deixe os campos desconhecidos vazios.`;
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [{ role: "system", content: prompt }, { role: "user", content: transcript }],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return null;
  const json: any = await response.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").replace(/\`\`\`json|\`\`\`/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      street: String(parsed.street || "").trim(),
      number: String(parsed.number || "").trim(),
      neighborhood: String(parsed.neighborhood || "").trim(),
      complement: String(parsed.complement || "").trim(),
      city: String(parsed.city || fallbackCity).trim(),
    };
  } catch {
    return null;
  }
}

export const verifyConversationDeliveryFeeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conversation } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select("id,phone,customer_name")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conversation) return { error: "Conversa não encontrada." };

    const { data: messages } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("direction,body,media_type,created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    const transcript = normalizeTranscript(messages ?? []);
    if (!transcript) return { error: "Não há mensagens suficientes para identificar o endereço." };

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select("fixed_delivery_city,delivery_pricing_mode,default_delivery_fee,delivery_fee_tiers,store_lat,store_lng,google_maps_api_key,store_address")
      .maybeSingle();
    if (!cfg) return { error: "Configuração da loja não encontrada." };

    const city = cfg.fixed_delivery_city || "Duque de Caxias";
    const address = await extractAddress(supabaseAdmin, transcript, city);
    if (!address?.neighborhood) return { error: "A IA não conseguiu identificar o bairro do cliente na conversa." };

    const cleanAddress = [address.street, address.number, address.neighborhood, address.complement, address.city || city]
      .filter(Boolean)
      .join(", ");

    if (cfg.delivery_pricing_mode !== "distance") {
      const { data: area, error } = await (supabaseAdmin as any).rpc("check_delivery_area_public", {
        p_neighborhood: address.neighborhood,
        p_street: address.street || null,
      });
      if (error) return { error: "Não foi possível consultar o cadastro de bairros para esta taxa." };
      if (!area?.supported) return { cleanAddress, neighborhood: address.neighborhood, outOfArea: true, pricingMode: "neighborhood", fee: 0 };
      return {
        cleanAddress,
        neighborhood: area.neighborhood || address.neighborhood,
        outOfArea: false,
        pricingMode: "neighborhood",
        fee: Number(area.fee ?? cfg.default_delivery_fee ?? 0),
        matchedCep: area.matched_cep === true,
      };
    }

    if (cfg.store_lat == null || cfg.store_lng == null) return { error: "Endereço/localização da loja não está configurado para cálculo por distância." };
    const { calculateDeliveryFee } = await import("./delivery-distance.server");
    const result = await calculateDeliveryFee({
      delivery_pricing_mode: cfg.delivery_pricing_mode,
      store_lat: Number(cfg.store_lat),
      store_lng: Number(cfg.store_lng),
      google_maps_api_key: cfg.google_maps_api_key,
      delivery_fee_tiers: cfg.delivery_fee_tiers as any,
      default_delivery_fee: Number(cfg.default_delivery_fee),
      fixed_delivery_city: city,
    } as any, cleanAddress, { supabaseAdmin, phone: conversation.phone });
    return {
      cleanAddress,
      neighborhood: address.neighborhood,
      outOfArea: result.outOfArea,
      pricingMode: "distance",
      fee: Number(result.fee || 0),
      distanceKm: result.distanceKm,
      uncertain: result.uncertain ?? false,
    };
  });

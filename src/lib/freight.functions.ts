import { createServerFn } from "@tanstack/react-start";

/**
 * Calculadora de frete com IA:
 * 1. IA (Gemini) recebe um endereço "sujo" (ex: "rua x perto do mercado do
 *    zé, bairro tal") e devolve um endereço formatado ideal para geocodificar.
 * 2. Passa esse endereço no motor de cálculo existente (delivery-distance.server.ts),
 *    que geocodifica, mede a distância REAL de rota pelo OSRM/Google e aplica
 *    a faixa de km configurada em Configurações → Entrega.
 * O usuário só vê o resultado final: km + faixa aplicada + valor.
 */
export const calculateFreightFn = createServerFn({ method: "POST" })
  .inputValidator((data: { rawAddress: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { calculateDeliveryFee } = await import("./delivery-distance.server");

    const raw = (data.rawAddress ?? "").trim();
    if (!raw) return { error: "Digite o endereço do cliente." };

    const { data: cfg } = await supabaseAdmin
      .from("store_config")
      .select(
        "delivery_pricing_mode, store_lat, store_lng, google_maps_api_key, delivery_fee_tiers, default_delivery_fee, fixed_delivery_city, store_address",
      )
      .maybeSingle();

    if (!cfg) return { error: "Configuração da loja não encontrada." };
    if (cfg.delivery_pricing_mode !== "distance" || cfg.store_lat == null || cfg.store_lng == null) {
      return {
        error:
          "O modo de cálculo por distância não está ativado. Vá em Configurações → Entrega, ative 'Cobrar por distância', defina o endereço da loja e as faixas de km antes de usar esta calculadora.",
      };
    }
    if (!Array.isArray(cfg.delivery_fee_tiers) || cfg.delivery_fee_tiers.length === 0) {
      return { error: "Nenhuma faixa de km cadastrada em Configurações → Entrega." };
    }

    // Passo 1 — IA "limpa" o endereço bagunçado antes de geocodificar
    // Independente do Lovable: usa as chaves de IA já cadastradas em
    // Configurações (mesmo esquema do bot de atendimento do WhatsApp).
    let cleanAddress = raw;
    let aiUsed = false;
    const { data: aiCfg } = await supabaseAdmin
      .from("store_config")
      .select("openai_api_key, groq_api_key")
      .maybeSingle();
    const key = aiCfg?.openai_api_key || aiCfg?.groq_api_key || null;
    const aiEndpoint = aiCfg?.openai_api_key
      ? { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" }
      : { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" };
    if (key) {
      try {
        // A loja entrega SEMPRE em Duque de Caxias (RJ) — se não houver cidade
        // padrão configurada, ainda assim forçamos Duque de Caxias/RJ, porque
        // sem cidade a geocodificação vira loteria (uma "Rua das Flores" tem
        // dezenas de resultados no Brasil inteiro) e o valor sai errado.
        const cityFallback = cfg.fixed_delivery_city || "Duque de Caxias";
        const sysPrompt = `Você recebe um endereço em português brasileiro que pode estar bagunçado, incompleto, com pontos de referência, com erros de digitação ou informal (ex: "rua x perto do mercado do zé, atrás da praça, casa amarela"). Sua tarefa é reescrevê-lo no formato EXATO ideal para geocodificação no Google Maps: "Rua/Avenida <nome completo>, <número>, <bairro>, ${cityFallback} - RJ, Brasil".

REGRAS ABSOLUTAS:
1. A cidade é SEMPRE "${cityFallback}" e o estado é SEMPRE "RJ" — mesmo que o cliente não tenha mencionado, mesmo que tenha escrito outra cidade parecida por engano. Nunca deixe sem cidade.
2. Descarte totalmente pontos de referência ("perto do mercado", "atrás da praça", "casa amarela", "portão azul", nome de comércio) — eles atrapalham a geocodificação.
3. Se não houver número, escreva apenas o nome da rua + bairro + cidade + UF (sem número). Nunca invente número.
4. Corrija erros óbvios de digitação/abreviação em nomes de rua e bairro ("R." → "Rua", "Av." → "Avenida", "Jd." → "Jardim").
5. Nunca invente rua nem bairro que o cliente não mencionou.
6. Devolva SOMENTE a linha do endereço formatado, sem explicação, sem aspas, sem markdown.`;
        const res = await fetch(aiEndpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: aiEndpoint.model,
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: raw },
            ],
            temperature: 0,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) {
          const json: any = await res.json();
          let out = String(json?.choices?.[0]?.message?.content ?? "")
            .trim()
            .replace(/^["']|["']$/g, "");
          // Blindagem: se a IA esqueceu de anexar a cidade, força aqui — sem
          // cidade a geocodificação erra o cálculo do frete.
          if (out) {
            const lower = out.toLowerCase();
            if (!lower.includes(cityFallback.toLowerCase())) {
              out = `${out.replace(/,\s*$/, "")}, ${cityFallback} - RJ, Brasil`;
            } else if (!/\brj\b|rio de janeiro/i.test(out)) {
              out = `${out.replace(/,\s*$/, "")} - RJ, Brasil`;
            }
            cleanAddress = out;
            aiUsed = true;
          }
        }
      } catch {
        /* segue com o endereço bruto */
      }
    }
    // Última linha de defesa: mesmo sem IA, garante cidade/UF no endereço bruto.
    if (!aiUsed) {
      const cityFallback = cfg.fixed_delivery_city || "Duque de Caxias";
      const lower = cleanAddress.toLowerCase();
      if (!lower.includes(cityFallback.toLowerCase())) {
        cleanAddress = `${cleanAddress.replace(/,\s*$/, "")}, ${cityFallback} - RJ, Brasil`;
      }
    }

    // Passo 2 — motor de cálculo existente
    const result = await calculateDeliveryFee(
      {
        delivery_pricing_mode: cfg.delivery_pricing_mode,
        store_lat: Number(cfg.store_lat),
        store_lng: Number(cfg.store_lng),
        google_maps_api_key: cfg.google_maps_api_key,
        delivery_fee_tiers: cfg.delivery_fee_tiers as any,
        default_delivery_fee: Number(cfg.default_delivery_fee),
        fixed_delivery_city: cfg.fixed_delivery_city,
      },
      cleanAddress,
      undefined,
      supabaseAdmin,
    );


    // Quando a geocodificação falha totalmente (não achou o endereço no mapa),
    // o motor de cálculo volta silenciosamente pra taxa fixa (fallback pensado
    // pra não travar pedido no WhatsApp) — mas aqui, na calculadora manual, isso
    // fazia a tela simplesmente não mostrar nada (nem erro, nem valor), porque o
    // bloco de resultado só aparece quando distanceKm != null. Deixa isso
    // explícito como erro pra o gerente saber que precisa ajustar o endereço.
    if (result.distanceKm == null) {
      return {
        error:
          `Não foi possível localizar "${cleanAddress}" no mapa (a geocodificação não encontrou esse endereço). ` +
          `Confira se está completo (rua, número, bairro e cidade) e tente de novo — endereços incompletos ou com nome de rua ambíguo costumam falhar aqui.`,
        rawAddress: raw,
        cleanAddress,
        aiUsed,
      };
    }

    // Detecta a faixa aplicada, para exibir no resultado
    const tiers = (cfg.delivery_fee_tiers as any[]).slice().sort((a, b) => a.km_from - b.km_from);
    let appliedTier: any = null;
    appliedTier = tiers.find((t) => result.distanceKm! >= t.km_from && result.distanceKm! < t.km_to) ?? null;

    return {
      rawAddress: raw,
      cleanAddress,
      aiUsed,
      storeAddress: cfg.store_address ?? null,
      distanceKm: result.distanceKm,
      fee: result.fee,
      outOfArea: result.outOfArea,
      uncertain: result.uncertain ?? false,
      usedDistancePricing: result.usedDistancePricing,
      appliedTier,
      tiers,
    };
  });

export type WhatsappDeliveryDispatchMode = "fixed_by_neighborhood" | "partner_quote";

export type WhatsappDeliveryResolution = {
  mode: WhatsappDeliveryDispatchMode;
  fee: number | null;
  source:
    | "street_exception_fixed"
    | "street_exception_partner"
    | "global_fixed_neighborhood"
    | "global_partner"
    | "fixed_missing_fee_partner_fallback";
  matchedStreetExceptionId?: string | null;
  matchedStreet?: string | null;
  matchedNeighborhood?: string | null;
  reason?: string | null;
};

function normalizeBase(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[º°ª#]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalização pensada para endereço brasileiro.
 * "Avenida Doutor Laureano", "Av. Dr Laureano" e "AV DOUTOR LAUREANO"
 * convergem para uma chave equivalente.
 */
export function normalizeWhatsappStreetKey(value: string | null | undefined) {
  return normalizeBase(value)
    .replace(/\bavenida\b/g, "av")
    .replace(/\bav\b/g, "av")
    .replace(/\brua\b/g, "r")
    .replace(/\btravessa\b/g, "tv")
    .replace(/\bestrada\b/g, "est")
    .replace(/\brodovia\b/g, "rod")
    .replace(/\balameda\b/g, "al")
    .replace(/\bdoutor\b/g, "dr")
    .replace(/\bdoutora\b/g, "dra")
    .replace(/\bprofessor\b/g, "prof")
    .replace(/\bprofessora\b/g, "profa")
    .replace(/\bsao\b/g, "sao")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWhatsappNeighborhoodKey(value: string | null | undefined) {
  return normalizeBase(value)
    .replace(/\bjardim\b/g, "jd")
    .replace(/\bparque\b/g, "pq")
    .replace(/\bvila\b/g, "vl")
    .replace(/\bsao\b/g, "sao")
    .replace(/\s+/g, " ")
    .trim();
}

function activeFlag(value: any) {
  return value === true || value === 1 || String(value ?? "").toLowerCase() === "true";
}

function neighborhoodEquivalent(a: string | null | undefined, b: string | null | undefined) {
  const ka = normalizeWhatsappNeighborhoodKey(a);
  const kb = normalizeWhatsappNeighborhoodKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Permite "Laureano" casar com "Doutor Laureano" sem abrir demais a comparação.
  return ka.length >= 5 && kb.length >= 5 && (ka.endsWith(kb) || kb.endsWith(ka));
}

export async function resolveWhatsappDeliveryPolicy(
  supabaseAdmin: any,
  input: {
    neighborhood: string;
    street: string;
  },
): Promise<WhatsappDeliveryResolution> {
  const neighborhood = String(input.neighborhood || "").trim();
  const street = String(input.street || "").trim();
  const streetKey = normalizeWhatsappStreetKey(street);

  const [{ data: cfg, error: cfgError }, { data: exceptions, error: exceptionsError }] =
    await Promise.all([
      supabaseAdmin
        .from("store_config")
        .select("whatsapp_delivery_dispatch_mode")
        .maybeSingle(),
      supabaseAdmin
        .from("delivery_street_exceptions")
        .select("id,street_name,neighborhood,dispatch_mode,fixed_fee,active")
        .eq("active", true),
    ]);

  if (cfgError) throw new Error(`Falha ao carregar modo de entrega do WhatsApp: ${cfgError.message}`);
  if (exceptionsError) throw new Error(`Falha ao carregar exceções por rua: ${exceptionsError.message}`);

  const matchedException = (exceptions ?? []).find((row: any) => {
    if (!activeFlag(row?.active)) return false;
    if (normalizeWhatsappStreetKey(row?.street_name) !== streetKey) return false;
    const configuredNeighborhood = String(row?.neighborhood || "").trim();
    return !configuredNeighborhood || neighborhoodEquivalent(configuredNeighborhood, neighborhood);
  });

  if (matchedException) {
    const mode = String(matchedException.dispatch_mode || "");
    if (mode === "partner_quote") {
      return {
        mode: "partner_quote",
        fee: null,
        source: "street_exception_partner",
        matchedStreetExceptionId: String(matchedException.id),
        matchedStreet: String(matchedException.street_name || street),
        matchedNeighborhood: String(matchedException.neighborhood || neighborhood),
      };
    }

    if (mode === "fixed") {
      const fee = Number(matchedException.fixed_fee);
      if (Number.isFinite(fee) && fee > 0) {
        return {
          mode: "fixed_by_neighborhood",
          fee: Number(fee.toFixed(2)),
          source: "street_exception_fixed",
          matchedStreetExceptionId: String(matchedException.id),
          matchedStreet: String(matchedException.street_name || street),
          matchedNeighborhood: String(matchedException.neighborhood || neighborhood),
        };
      }
      // Exceção fixa sem valor não pode produzir R$ 0 nem inventar taxa.
      return {
        mode: "partner_quote",
        fee: null,
        source: "fixed_missing_fee_partner_fallback",
        matchedStreetExceptionId: String(matchedException.id),
        matchedStreet: String(matchedException.street_name || street),
        matchedNeighborhood: String(matchedException.neighborhood || neighborhood),
        reason: "A exceção de rua está marcada como taxa fixa, mas não possui valor válido.",
      };
    }
  }

  const globalMode: WhatsappDeliveryDispatchMode =
    String(cfg?.whatsapp_delivery_dispatch_mode || "fixed_by_neighborhood") === "partner_quote"
      ? "partner_quote"
      : "fixed_by_neighborhood";

  if (globalMode === "partner_quote") {
    return {
      mode: "partner_quote",
      fee: null,
      source: "global_partner",
    };
  }

  const { data: neighborhoods, error: neighborhoodsError } = await supabaseAdmin
    .from("bairros_atendidos")
    .select("nome,ativo,delivery_fee");

  if (neighborhoodsError) {
    throw new Error(`Falha ao consultar taxa fixa do bairro: ${neighborhoodsError.message}`);
  }

  const matchedNeighborhood = (neighborhoods ?? []).find((row: any) => {
    if (!activeFlag(row?.ativo)) return false;
    return neighborhoodEquivalent(String(row?.nome || ""), neighborhood);
  });

  const fee = matchedNeighborhood?.delivery_fee == null ? null : Number(matchedNeighborhood.delivery_fee);
  if (fee != null && Number.isFinite(fee) && fee > 0) {
    return {
      mode: "fixed_by_neighborhood",
      fee: Number(fee.toFixed(2)),
      source: "global_fixed_neighborhood",
      matchedNeighborhood: String(matchedNeighborhood.nome || neighborhood),
    };
  }

  // Falta de taxa fixa é tratada como cotação operacional, nunca como taxa zero
  // e nunca como motivo para a IA inventar um valor.
  return {
    mode: "partner_quote",
    fee: null,
    source: "fixed_missing_fee_partner_fallback",
    matchedNeighborhood: String(matchedNeighborhood?.nome || neighborhood),
    reason: "O bairro está atendido, mas não possui taxa fixa válida cadastrada.",
  };
}

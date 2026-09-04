import { createServerFn } from "@tanstack/react-start";
import { geocodeAddress } from "./delivery-distance.server";

/** Chamado pelo botão "Buscar coordenadas" em Configurações — geocodifica o endereço da loja uma vez. */
export const geocodeStoreAddressFn = createServerFn({ method: "POST" })
  .inputValidator((data: { address: string; googleMapsApiKey?: string | null }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logApi } = await import("./api-log.server");

    const result = await geocodeAddress(data.address, data.googleMapsApiKey || null);

    if (!result) {
      await logApi(supabaseAdmin, {
        source: "geocode_store_address",
        direction: "out",
        request_payload: { address: data.address, has_google_key: !!data.googleMapsApiKey },
        error_message: "Nenhum serviço de geocodificação (Google/Nominatim) encontrou esse endereço",
      });
      return {
        error:
          "Não foi possível localizar esse endereço. Tente ser mais específico (rua, número, bairro, cidade) — se persistir, confira em /loja/logs os detalhes técnicos.",
      };
    }

    await logApi(supabaseAdmin, {
      source: "geocode_store_address",
      direction: "out",
      request_payload: { address: data.address },
      response_status: 200,
      response_body: `lat=${result.lat}, lng=${result.lng}`,
    });
    return { lat: result.lat, lng: result.lng };
  });

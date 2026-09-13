// Log central de tudo que acontece nas integrações externas (iFood, Evolution,
// etc). Nunca deixa um log quebrar o fluxo principal — se o log falhar, só
// registra no console e segue em frente.

export async function logApi(
  supabaseAdmin: any,
  entry: {
    source: string;
    direction?: "in" | "out";
    request_payload?: any;
    response_status?: number | null;
    response_body?: string | null;
    error_message?: string | null;
    order_id?: string | null;
    [key: string]: any;
  },
): Promise<void> {

  try {
    await supabaseAdmin.from("api_logs").insert({
      source: entry.source,
      direction: entry.direction ?? "in",
      request_payload: entry.request_payload ?? null,
      response_status: entry.response_status ?? null,
      response_body: entry.response_body ? String(entry.response_body).slice(0, 5000) : null,
      error_message: entry.error_message ? String(entry.error_message).slice(0, 2000) : null,
      order_id: entry.order_id ?? null,
    });

  } catch (err) {
    console.error("[logApi] falha ao gravar log (não crítico):", err);
  }
}

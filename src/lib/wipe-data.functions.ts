import { createServerFn } from "@tanstack/react-start";

export type WipeCategory = "leads" | "pedidos" | "historico" | "insumos" | "produtos" | "entregadores" | "chat";

/** Apaga dados de teste, categoria por categoria, respeitando dependências entre tabelas. */
export const wipeDataFn = createServerFn({ method: "POST" })
  .inputValidator((data: { categories: WipeCategory[] }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cats = new Set(data.categories);
    const results: Record<string, string> = {};

    try {
      if (cats.has("pedidos")) {
        await supabaseAdmin.from("order_items").delete().not("id", "is", null);
        await supabaseAdmin.from("orders").delete().not("id", "is", null);
        results.pedidos = "ok";
      }
      if (cats.has("leads")) {
        await supabaseAdmin.from("leads").delete().not("id", "is", null);
        results.leads = "ok";
      }
      if (cats.has("insumos") || cats.has("produtos")) {
        // recipe_items depende dos dois — apaga se qualquer um dos dois for selecionado
        await supabaseAdmin.from("recipe_items").delete().not("id", "is", null);
      }
      if (cats.has("insumos")) {
        await supabaseAdmin.from("ingredients").delete().not("id", "is", null);
        results.insumos = "ok";
      }
      if (cats.has("produtos")) {
        await supabaseAdmin.from("products").delete().not("id", "is", null);
        results.produtos = "ok";
      }
      if (cats.has("entregadores")) {
        const { data: dels } = await supabaseAdmin.from("deliverers").select("id");
        const ids = (dels ?? []).map((d: any) => d.id);
        if (ids.length) await supabaseAdmin.from("user_roles").delete().eq("role", "deliverer").in("user_id", ids);
        await supabaseAdmin.from("deliverers").delete().not("id", "is", null);
        results.entregadores = "ok";
      }
      if (cats.has("chat")) {
        await supabaseAdmin.from("whatsapp_messages").delete().not("id", "is", null);
        await supabaseAdmin.from("order_drafts").delete().not("conversation_id", "is", null);
        await supabaseAdmin.from("whatsapp_conversations").delete().not("id", "is", null);
        results.chat = "ok";
      }
      return { ok: true, results };
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

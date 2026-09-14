
// Teste de fumaça (smoke test) dos cenários de pagamento que já quebraram de
// verdade nessa conversa: falta de valor no enum, comparação de tipo errada,
// forma de pagamento fora do formato esperado. Em vez de mockar o banco (o
// que não pegaria justamente esse tipo de bug), esse teste cria pedidos de
// teste DE VERDADE no seu banco e confere se o INSERT passa sem erro — depois
// apaga tudo. Roda em segundos, e pega exatamente a classe de bug que já nos
// pegou de surpresa mais de uma vez.

export type ScenarioResult = { name: string; ok: boolean; detail?: string };

const TEST_PHONE = "55000000000TESTE".slice(0, 15);
const TEST_MARKER = "__AUTOTEST_HOTBOX__";

type Scenario = {
  name: string;
  payment_method: "pix" | "card";
  payment_timing: "now" | "delivery" | null;
  change_for: number | null;
};

const SCENARIOS: Scenario[] = [
  { name: "Pix — pago agora", payment_method: "pix", payment_timing: "now", change_for: null },
  { name: "Pix — pago na entrega", payment_method: "pix", payment_timing: "delivery", change_for: null },
  { name: "Cartão", payment_method: "card", payment_timing: "delivery", change_for: null },
  { name: "Endereço sem bairro (deve ser aceito, bairro não é obrigatório no banco)", payment_method: "pix", payment_timing: "delivery", change_for: null },
];

export async function runPaymentScenarioTests(supabaseAdmin: any): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const createdOrderIds: string[] = [];

  // Verifica primeiro a integridade estrutural que sustenta configuração,
  // cardápio, atendimento e checkout. Todas estas leituras são sem efeito colateral.
  const requiredTables = [
    "store_config",
    "products",
    "site_checkout_sessions",
    "coupons",
    "coupon_redemptions",
    "bairros_nao_atendidos",
    "ruas_nao_atendidas",
    "pending_human_handoffs",
    "reengagement_queue",
  ];

  for (const table of requiredTables) {
    try {
      const { error } = await supabaseAdmin.from(table).select("id", { head: true, count: "exact" }).limit(1);
      results.push({
        name: `Tabela ${table}`,
        ok: !error,
        detail: error?.message,
      });
    } catch (err: any) {
      results.push({ name: `Tabela ${table}`, ok: false, detail: String(err?.message ?? err) });
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("store_config")
      .select("digital_payment_provider,digital_pix_provider,digital_card_provider")
      .eq("id", 1)
      .maybeSingle();
    const provider = String(data?.digital_payment_provider || "");
    const allowed = ["mercadopago", "pagarme", "efi"].includes(provider);
    const synchronized = data?.digital_pix_provider === provider && data?.digital_card_provider === provider;
    results.push({
      name: "Checkout único configurado",
      ok: !error && allowed && synchronized,
      detail: error?.message || (!allowed ? "Gateway fora da lista permitida" : !synchronized ? "Provedores Pix/cartão não estão sincronizados" : undefined),
    });
  } catch (err: any) {
    results.push({ name: "Checkout único configurado", ok: false, detail: String(err?.message ?? err) });
  }

  for (const rpc of ["get_public_menu_products", "get_public_payment_config"]) {
    try {
      const { error } = await supabaseAdmin.rpc(rpc);
      results.push({ name: `RPC ${rpc}`, ok: !error, detail: error?.message });
    } catch (err: any) {
      results.push({ name: `RPC ${rpc}`, ok: false, detail: String(err?.message ?? err) });
    }
  }

  for (const scenario of SCENARIOS) {
    try {
      const { data: order, error } = await supabaseAdmin.from("orders").insert({
        source: "whatsapp",
        customer_name: TEST_MARKER,
        customer_phone: TEST_PHONE,
        delivery_mode: "delivery",
        address_street: "Rua de Teste", address_number: "123",
        address_neighborhood: scenario.name.includes("sem bairro") ? null : "Bairro Teste",
        payment_method: scenario.payment_method,
        payment_timing: scenario.payment_timing,
        change_for: scenario.change_for,
        subtotal: 10, delivery_fee: 0, total: 10,
        status: "pending_review",
        notes: TEST_MARKER,
      }).select("id").single();

      if (error) {
        results.push({ name: scenario.name, ok: false, detail: error.message });
      } else {
        createdOrderIds.push(order.id);
        results.push({ name: scenario.name, ok: true });
      }
    } catch (err: any) {
      results.push({ name: scenario.name, ok: false, detail: String(err?.message ?? err) });
    }
  }

  // limpa tudo que foi criado no teste, sem deixar rastro no sistema
  if (createdOrderIds.length) {
    await supabaseAdmin.from("order_items").delete().in("order_id", createdOrderIds);
    await supabaseAdmin.from("orders").delete().in("id", createdOrderIds);
  }
  // segurança extra: apaga qualquer coisa marcada como teste que porventura tenha sobrado
  await supabaseAdmin.from("orders").delete().eq("notes", TEST_MARKER);

  return results;
}

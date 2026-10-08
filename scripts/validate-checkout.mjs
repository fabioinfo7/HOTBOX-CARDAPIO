import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const fail = (message) => {
  console.error(`[checkout-validation] ${message}`);
  process.exitCode = 1;
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const menu = read("src/routes/index.tsx");
const checkout = read("src/lib/site-checkout.functions.ts");
const thanks = read("src/routes/obrigado.tsx");
const config = read("src/routes/_authenticated/loja.config.tsx");
const migration = read("supabase/migrations/20260914190000_checkout_unico_integridade.sql");

for (const [name, source] of [["cardápio", menu], ["checkout", checkout], ["obrigado", thanks]]) {
  assert(!/infinitepay|appmax/i.test(source), `${name} ainda contém gateway legado`);
}

for (const provider of ["mercadopago", "efi", "pagarme"]) {
  assert(config.includes(`<SelectItem value="${provider}"`), `checkout ${provider} não aparece na configuração`);
}
assert(!config.includes('<SelectItem value="infinitepay"'), "InfinitePay ainda aparece como opção");
assert(!config.includes('<SelectItem value="appmax"'), "Appmax ainda aparece como opção");
assert(checkout.includes("cfg.digital_payment_provider"), "checkout não usa o provedor único");
assert(!checkout.includes("digital_pix_provider") && !checkout.includes("digital_card_provider"), "checkout ainda roteia Pix e cartão separadamente");

for (const object of [
  "bairros_nao_atendidos",
  "ruas_nao_atendidas",
  "pending_human_handoffs",
  "reengagement_queue",
  "coupons",
  "coupon_redemptions",
  "get_public_menu_products",
  "get_public_payment_config",
]) {
  assert(migration.includes(object), `migration de integridade não contém ${object}`);
}

if (!process.exitCode) {
  console.log("[checkout-validation] checkout único e objetos obrigatórios validados.");
}

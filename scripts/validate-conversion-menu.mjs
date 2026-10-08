import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const fail = (message) => {
  console.error(`[menu-conversion] ${message}`);
  process.exitCode = 1;
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const menu = read("src/routes/index.tsx");
const analytics = read("src/lib/analytics.ts");
const tracker = read("src/components/analytics-tracker.tsx");
const styles = read("src/styles.css");
const root = read("src/routes/__root.tsx");

for (const testimonialMarker of [
  "getPublicTestimonialsFn",
  "PublicReviewsModal",
  "CompactInlineReview",
  "Avaliações reais",
  "Compra verificada",
]) {
  assert(menu.includes(testimonialMarker), `depoimentos perderam ${testimonialMarker}`);
}

for (const provider of ["MercadoPagoPayment", "PagarmePayment", "EfiPayment"]) {
  assert(menu.includes(`const ${provider} = lazy(`), `${provider} não está carregando sob demanda`);
}

for (const marker of [
  "CART_STORAGE_TTL_MS",
  "openCartItemForEdit",
  "Salvar alterações",
  "Continuar comprando",
  "menuLoadError",
  "Tentar novamente",
  "menu_search",
  "menu_category_selected",
  "reviews_opened",
  "cart_item_updated",
]) {
  assert(menu.includes(marker), `cardápio de conversão perdeu ${marker}`);
}

assert(
  menu.includes("setPayOnDeliveryEnabled(false)"),
  "cardápio voltou a habilitar pagamento na entrega",
);
assert(
  styles.includes("env(safe-area-inset-bottom)"),
  "barra inferior não respeita a área segura do celular",
);
assert(root.includes("viewport-fit=cover"), "viewport móvel não está otimizado");
assert(root.includes("Batata recheada de verdade"), "SEO voltou a descrever outro tipo de produto");

for (const existingEvent of [
  "product_view",
  "add_to_cart",
  "checkout_started",
  "payment_selected",
  "payment_started",
  "purchase",
]) {
  assert(
    analytics.includes(`${existingEvent}:`) || menu.includes(`\"${existingEvent}\"`),
    `evento existente ${existingEvent} foi removido`,
  );
}

assert(analytics.includes("hotbox:virtual-page"), "Analytics não acompanha as etapas virtuais");
assert(tracker.includes("performance_summary"), "diagnóstico de desempenho não está ativo");
assert(tracker.includes("safeHref"), "links com parâmetros sensíveis podem chegar ao Analytics");

if (!process.exitCode) {
  console.log("[menu-conversion] cardápio, checkout, depoimentos e Analytics validados.");
}

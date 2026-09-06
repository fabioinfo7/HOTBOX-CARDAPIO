import fs from 'node:fs';

const requiredFiles = [
  'src/routes/_authenticated/loja.tsx',
  'src/routes/_authenticated/loja.config.tsx',
  'src/routes/_authenticated/loja.financeiro-cardapio.tsx',
  'src/routes/_authenticated/loja.fidelidade.tsx',
  'src/routes/index.tsx',
  'src/routes/obrigado.tsx',
  'src/components/mercadopago-payment.tsx',
  'src/components/menu-sales-tools.tsx',
  'src/lib/mercadopago.functions.ts',
  'src/lib/infinitepay.functions.ts',
  'src/lib/site-checkout.functions.ts',
  'src/lib/site-checkout-notify.server.ts',
  'src/lib/digital-menu-finance.functions.ts',
  'supabase/migrations/20260905173000_taxa_entrega_bairro_ou_km.sql',
  'supabase/migrations/20260905200000_cardapio_conversao_adicionais_pagamento_entrega.sql',
  'src/routes/api/public/webhooks.mercadopago.ts',
  'src/routes/api/public/webhooks.infinitepay.ts',
  'src/assets/logo-hotbox.jpeg',
  'src/routeTree.gen.ts',
  'src/routes/_authenticated/loja.analytics.tsx',
  'src/routes/api/public/analytics.ts',
  'src/lib/analytics.functions.ts',
  'src/lib/analytics-client.ts',
  'supabase/migrations/20260905223000_analytics_comportamento.sql',
];

const checks = [
  ['src/routes/_authenticated/loja.tsx', '/loja/financeiro-cardapio'],
  ['src/routes/_authenticated/loja.tsx', '/loja/fidelidade'],
  ['src/routes/_authenticated/loja.tsx', '/loja/analytics'],
  ['src/routes/_authenticated/loja.tsx', 'HOTBOX_LOGO_URL = hotboxLogoUrl'],
  ['src/routes/_authenticated/loja.config.tsx', 'digital_payment_provider'],
  ['src/routes/_authenticated/loja.config.tsx', 'mercadopago_public_key'],
  ['src/routes/_authenticated/loja.config.tsx', 'mercadopago_access_token'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'Recebimentos do Cardápio Digital'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'Mercado Pago'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'InfinitePay'],
  ['src/routes/index.tsx', 'MercadoPagoPayment'],
  ['src/routes/index.tsx', 'get_public_payment_config'],
  ['src/routes/index.tsx', 'menu_addon_groups'],
  ['src/routes/index.tsx', 'delivery_card'],
  ['src/routes/index.tsx', 'trackAnalytics("checkout_start"'],
  ['src/routes/_authenticated/loja.produtos.tsx', 'MenuSalesTools'],
  ['src/routes/_authenticated/loja.config.tsx', 'digital_menu_pay_on_delivery_enabled'],
  ['src/components/menu-sales-tools.tsx', 'Order bumps — oferta de 1 clique'],
  ['src/routes/_authenticated/loja.analytics.tsx', 'Analytics de Comportamento'],
  ['src/routes/_authenticated/loja.analytics.tsx', 'Baixar relatório em PDF'],
  ['src/routes/bio.tsx', 'useBehaviorAnalytics("bio")'],
  ['src/lib/analytics-client.ts', 'session_start'],
  ['src/routes/api/public/analytics.ts', 'record_analytics_event'],
  ['supabase/migrations/20260905223000_analytics_comportamento.sql', 'analytics_sessions'],
  ['supabase/migrations/20260905200000_cardapio_conversao_adicionais_pagamento_entrega.sql', 'finalize_site_checkout_pay_on_delivery'],
  ['src/routeTree.gen.ts', '/financeiro-cardapio'],
  ['src/routeTree.gen.ts', '/fidelidade'],
  ['src/routeTree.gen.ts', '/loja/analytics'],
  ['src/routeTree.gen.ts', '/api/public/analytics'],
  ['src/routeTree.gen.ts', 'webhooks.mercadopago'],
  ['src/routeTree.gen.ts', 'webhooks.infinitepay'],
];

const problems = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) problems.push(`Arquivo obrigatório ausente: ${file}`);
}
for (const [file, marker] of checks) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(marker)) problems.push(`Marcador obrigatório ausente em ${file}: ${marker}`);
}


// TanStack Start bloqueia imports estáticos de arquivos *.server.* em módulos
// *.functions.ts que também entram no bundle do cliente. Detectamos isso antes
// do Vite para evitar descobrir a regressão só no Railway.
for (const name of fs.readdirSync('src/lib')) {
  if (!name.endsWith('.functions.ts')) continue;
  const file = `src/lib/${name}`;
  const text = fs.readFileSync(file, 'utf8');
  const staticServerImport = /(^|\n)\s*import\s+[\s\S]*?\s+from\s+["'][^"']*\.server(?:\.[^"']*)?["']/g;
  for (const match of text.matchAll(staticServerImport)) {
    const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
    problems.push(`Import server-only estático em ${file}:${line}`);
  }
}


// Proteção específica contra a regressão que quebrou o deploy no Railway:
// site-checkout.functions.ts é alcançável pelo cliente via /obrigado e não pode
// conter nenhuma referência direta ao módulo whatsapp-send.server.
{
  const file = 'src/lib/site-checkout.functions.ts';
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('whatsapp-send.server')) {
    problems.push(`REGRESSÃO BLOQUEADA: ${file} referencia whatsapp-send.server`);
  }
  if (!text.includes('HOTBOX_BUILD_20260905_SITE_CHECKOUT_SERVER_SPLIT')) {
    problems.push(`Fingerprint ausente em ${file}`);
  }
}

if (problems.length) {
  console.error('\nHOTBOX PRE-FLIGHT FALHOU\n');
  for (const p of problems) console.error(`- ${p}`);
  console.error('\nDeploy interrompido para evitar regressão.\n');
  process.exit(1);
}
console.log('HOTBOX PRE-FLIGHT OK — rotas, gateways, taxa bairro/km, adicionais, order bumps, pagamento na entrega, analytics, financeiro, fidelidade e logo presentes.');

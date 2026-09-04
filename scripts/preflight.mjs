import fs from 'node:fs';

const requiredFiles = [
  'src/routes/_authenticated/loja.tsx',
  'src/routes/_authenticated/loja.config.tsx',
  'src/routes/_authenticated/loja.financeiro-cardapio.tsx',
  'src/routes/_authenticated/loja.fidelidade.tsx',
  'src/routes/index.tsx',
  'src/routes/obrigado.tsx',
  'src/components/mercadopago-payment.tsx',
  'src/lib/mercadopago.functions.ts',
  'src/lib/infinitepay.functions.ts',
  'src/lib/site-checkout.functions.ts',
  'src/lib/digital-menu-finance.functions.ts',
  'src/routes/api/public/webhooks.mercadopago.ts',
  'src/routes/api/public/webhooks.infinitepay.ts',
  'src/assets/logo-hotbox.jpeg',
  'src/routeTree.gen.ts',
];

const checks = [
  ['src/routes/_authenticated/loja.tsx', '/loja/financeiro-cardapio'],
  ['src/routes/_authenticated/loja.tsx', '/loja/fidelidade'],
  ['src/routes/_authenticated/loja.tsx', 'HOTBOX_LOGO_URL = hotboxLogoUrl'],
  ['src/routes/_authenticated/loja.config.tsx', 'digital_payment_provider'],
  ['src/routes/_authenticated/loja.config.tsx', 'mercadopago_public_key'],
  ['src/routes/_authenticated/loja.config.tsx', 'mercadopago_access_token'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'Recebimentos do Cardápio Digital'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'Mercado Pago'],
  ['src/routes/_authenticated/loja.financeiro-cardapio.tsx', 'InfinitePay'],
  ['src/routes/index.tsx', 'MercadoPagoPayment'],
  ['src/routes/index.tsx', 'get_public_payment_config'],
  ['src/routeTree.gen.ts', '/financeiro-cardapio'],
  ['src/routeTree.gen.ts', '/fidelidade'],
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

if (problems.length) {
  console.error('\nHOTBOX PRE-FLIGHT FALHOU\n');
  for (const p of problems) console.error(`- ${p}`);
  console.error('\nDeploy interrompido para evitar regressão.\n');
  process.exit(1);
}
console.log('HOTBOX PRE-FLIGHT OK — rotas, gateways, financeiro do cardápio, fidelidade e logo presentes.');

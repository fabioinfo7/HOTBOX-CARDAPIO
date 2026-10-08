import fs from 'node:fs';

const requiredFiles = [
  'src/routes/_authenticated/loja.tsx',
  'src/routes/_authenticated/loja.config.tsx',
  'src/routes/_authenticated/loja.financeiro-cardapio.tsx',
  'src/routes/_authenticated/loja.fidelidade.tsx',
  'src/routes/index.tsx',
  'src/routes/obrigado.tsx',
  'src/components/mercadopago-payment.tsx',
  'src/components/appmax-payment.tsx',
  'src/components/pwa-install.tsx',
  'src/components/menu-sales-tools.tsx',
  'src/lib/mercadopago.functions.ts',
  'src/lib/appmax.functions.ts',
  'src/lib/analytics-health.functions.ts',
  'src/lib/human-handoff.server.ts',
  'src/lib/infinitepay.functions.ts',
  'src/lib/site-checkout.functions.ts',
  'src/lib/site-checkout-notify.server.ts',
  'src/lib/digital-menu-finance.functions.ts',
  'supabase/migrations/20260905173000_taxa_entrega_bairro_ou_km.sql',
  'supabase/migrations/20260905200000_cardapio_conversao_adicionais_pagamento_entrega.sql',
  'src/routes/api/public/webhooks.mercadopago.ts',
  'src/routes/api/public/webhooks.appmax.ts',
  'src/routes/api/public/appmax.validation.ts',
  'src/routes/api/public/webhooks.infinitepay.ts',
  'src/assets/logo-hotbox.jpeg',
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/pwa/icon-192.png',
  'public/pwa/icon-512.png',
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
  ['src/routes/index.tsx', 'menu_addon_groups'],
  ['src/routes/index.tsx', 'delivery_card'],
  ['src/routes/_authenticated/loja.produtos.tsx', 'MenuSalesTools'],
  ['src/routes/_authenticated/loja.config.tsx', 'digital_menu_pay_on_delivery_enabled'],
  ['src/components/menu-sales-tools.tsx', 'Order bumps — oferta de 1 clique'],
  ['supabase/migrations/20260905200000_cardapio_conversao_adicionais_pagamento_entrega.sql', 'finalize_site_checkout_pay_on_delivery'],
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



// Auditoria de imports locais. Isso evita a sequência de deploys quebrados
// por arquivos importados que ficaram de fora do pacote consolidado.
{
  const sourceRoot = 'src';
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

  function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  function resolves(base) {
    const candidates = [
      base,
      ...extensions.map((ext) => `${base}${ext}`),
      ...extensions.map((ext) => `${base}/index${ext}`),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
  }

  const importPattern =
    /(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)|import\(["']([^"']+)["']\)/g;

  for (const file of walk(sourceRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const spec = (match[1] || match[2] || match[3] || '').split('?')[0];
      let base = null;

      if (spec.startsWith('@/')) {
        base = `${sourceRoot}/${spec.slice(2)}`;
      } else if (spec.startsWith('.')) {
        const { dirname, resolve } = await import('node:path');
        base = resolve(dirname(file), spec);
      }

      if (base && !resolves(base)) {
        problems.push(`Import local não resolvido em ${file}: ${spec}`);
      }
    }
  }
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



// HOTBOX_V6_IMPORT_PROTECTION_AUDIT
// TanStack Start rejeita módulos *.client.* no grafo SSR. Detectamos qualquer
// import estático/dinâmico para *.client.* a partir do código compartilhado.
for (const base of ['src/routes', 'src/components', 'src/lib']) {
  if (!fs.existsSync(base)) continue;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      if (/\.client\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const re = /(?:from\s*|import\s*\()\s*["'][^"']*\.client(?:\.[^"']*)?["']/g;
      for (const match of text.matchAll(re)) {
        const line = text.slice(0, match.index ?? 0).split(/\r?\n/).length;
        problems.push(`Import client-only em grafo compartilhado: ${full}:${line}`);
      }
    }
  };
  walk(base);
}



// HOTBOX_V6_ANALYTICS_SSR_REGRESSION
// O módulo de analytics compartilhado precisa ser SSR-safe. Nunca importar
// analytics.client a partir de rotas/componentes, pois TanStack Start bloqueia
// *.client.* no ambiente SSR.
for (const file of ['src/routes/obrigado.tsx', 'src/components/analytics-tracker.tsx']) {
  if (!fs.existsSync(file)) {
    problems.push(`Arquivo obrigatório para analytics ausente: ${file}`);
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('analytics.client')) {
    problems.push(`REGRESSÃO SSR: ${file} ainda importa analytics.client`);
  }
  if (!text.includes('@/lib/analytics')) {
    problems.push(`Analytics compartilhado ausente em ${file}`);
  }
}

if (problems.length) {
  console.error('\nHOTBOX PRE-FLIGHT FALHOU\n');
  for (const p of problems) console.error(`- ${p}`);
  console.error('\nDeploy interrompido para evitar regressão.\n');
  process.exit(1);
}
console.log('HOTBOX PRE-FLIGHT OK — rotas, gateways, taxa bairro/km, adicionais, order bumps, pagamento na entrega, financeiro, fidelidade e logo presentes.');

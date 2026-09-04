# HotBox — Cardápio digital premium + pagamento antecipado

## O que foi entregue
- Página pública refeita com navegação mobile-first inspirada na experiência de apps de delivery, mantendo logo e identidade HotBox.
- Produtos com cards grandes, categorias, busca, destaques, sacola fixa, detalhe do produto e checkout.
- Logo HotBox permanece visível nos headers das telas principais.
- Checkout sem pagamento na entrega.
- Pix antecipado com QR Code gerado localmente a partir do `pix_copia_cola`/`pix_key` configurado.
- Cartão via Stripe Checkout.
- Dinheiro antecipado opcional, aguardando confirmação manual da loja; nunca é marcado como pagamento na entrega.
- Pedidos do site nascem `pending_review` + `awaiting_payment`.
- Cartão: webhook Stripe confirma pagamento, muda para `pending`, envia mensagem inicial no WhatsApp e libera o fluxo operacional.
- Pix/dinheiro: botão de confirmar pagamento no pedido usa backend seguro, muda para `pending`, avisa o cliente e libera o mesmo fluxo.
- Atualizações posteriores (preparo, pronto, saiu para entrega, entregue) seguem o mecanismo existente de WhatsApp.

## 1. Banco
Execute no Supabase SQL Editor:
`supabase/migrations/20260828013000_digital_menu_payments_stripe.sql`

## 2. Configuração do Stripe
No painel: `Configurações > Pagamentos`.
Preencha:
- Publishable key (`pk_...`)
- Secret key (`sk_...`)
- Webhook signing secret (`whsec_...`)
- Ative o Stripe.

No Dashboard Stripe crie webhook apontando para:
`https://SEU-DOMINIO/api/public/webhooks/stripe`

Eventos mínimos:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

## 3. Pix
Em `Configurações > Pagamentos` informe preferencialmente um **Pix Copia e Cola EMV válido**. O QR Code do cardápio é criado a partir desse texto.

Um texto aleatório pode virar QR Code visualmente, mas não se transforma magicamente em um Pix bancário válido. Para o app do banco reconhecer como Pix, use um payload Pix Copia e Cola válido.

Como este modo é estático e não há integração bancária no projeto, a confirmação do Pix é manual no pedido. Ao confirmar, o sistema libera o pedido e envia a confirmação pelo WhatsApp.

## 4. Dinheiro
A opção pode ser ligada/desligada em `Configurações > Cardápio digital`.
Ela está implementada como **pagamento antecipado com confirmação manual**. Não existe pagamento em dinheiro na entrega.

## 5. Fluxo do cartão
1. Cliente monta a sacola.
2. Informa dados/endereço.
3. Escolhe cartão.
4. Sistema cria pedido aguardando pagamento.
5. Stripe Checkout abre.
6. Webhook confirma pagamento.
7. Pedido muda para `pending`.
8. Cliente recebe confirmação no WhatsApp.
9. Operação segue normalmente.

## Arquivos principais alterados
- `src/routes/index.tsx`
- `src/routes/pedido.$id.tsx`
- `src/routes/_authenticated/loja.config.tsx`
- `src/routes/_authenticated/loja.pedido.$id.tsx`
- `src/lib/stripe.functions.ts`
- `src/lib/site-payment.server.ts`
- `src/lib/site-payment.functions.ts`
- `src/routes/api/public/webhooks.stripe.ts`
- `src/routes/api/public/webhooks.evolution.ts` (mantida a versão mais recente do fluxo WhatsApp)
- `supabase/migrations/20260828013000_digital_menu_payments_stripe.sql`
- `package.json` (`qrcode` + tipos)

## Validação
Foi feita validação sintática TypeScript dos arquivos alterados. O `npm install` no ambiente de geração excedeu o tempo disponível, portanto o build completo com dependências não foi concluído aqui. No Railway, o `npm install` do deploy instalará também a dependência `qrcode` adicionada ao `package.json`.

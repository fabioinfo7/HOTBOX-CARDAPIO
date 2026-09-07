# HOTBOX V9 — Meta Pixel configurável

## O que foi adicionado
Em Configurações > Integrações existe um novo card:
**Meta Pixel — Cardápio Digital e Página da Bio**

Você pode:
- ativar/desativar o Pixel;
- escolher Cardápio Digital;
- escolher Página da Bio;
- colar o script padrão completo do Meta Pixel;
- salvar sem editar código.

## Eventos do cardápio
O Analytics da HotBox também envia eventos equivalentes ao Meta Pixel:
- page_view -> PageView
- product_view -> ViewContent
- add_to_cart -> AddToCart
- checkout_started -> InitiateCheckout
- payment_started -> AddPaymentInfo
- purchase -> Purchase

## Segurança
O sistema não executa livremente qualquer JavaScript colado.
Ele identifica o Pixel ID dentro do script padrão do Meta e carrega a biblioteca oficial
`connect.facebook.net/en_US/fbevents.js`.

## Banco
Antes de usar a nova configuração, execute:
`APLICAR-META-PIXEL-CARDAPIO-BIO.sql`
no SQL Editor do Supabase.

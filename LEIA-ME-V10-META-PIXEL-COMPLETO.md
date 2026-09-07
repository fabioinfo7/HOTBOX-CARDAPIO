# HOTBOX V10 — Meta Pixel completo

Esta versão mantém tudo da V9 e enriquece os eventos enviados ao Meta.

## Eventos
- PageView
- ViewContent
- AddToCart
- AddPaymentInfo
- InitiateCheckout
- Purchase

## Dados enviados quando disponíveis
- content_ids
- contents
- content_name
- content_type
- quantity / num_items
- item_price
- value
- currency = BRL
- adicionais
- order bumps
- subtotal
- desconto
- cupom
- taxa de entrega
- forma de entrega
- forma de pagamento
- checkout_id
- order_id

## Purchase
O Purchase de pagamento online é disparado apenas quando a compra/pedido é confirmada.
O sistema guarda temporariamente o snapshot do carrinho pelo checkout e recupera esse snapshot
na confirmação para enviar os dados completos da compra.

## Deduplicação
Os eventos importantes usam eventID.
Purchase usa:
purchase_<ORDER_ID>

Isso deixa a integração preparada para uma futura Conversions API sem duplicar o mesmo Purchase.

## Observação
Esta versão enriquece o Meta Pixel pelo navegador. A Conversions API servidor-servidor ainda exige
um token de acesso específico da Meta e deve ser configurada separadamente para não expor credenciais
no frontend.

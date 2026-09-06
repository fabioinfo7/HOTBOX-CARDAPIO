# HotBox Delivery — versão consolidada 28/08/2026

Esta versão consolida o sistema de produção com as correções mais recentes e o novo cardápio digital.

## Atendimento IA / WhatsApp
- memória persistente do order_draft por até 12 horas;
- bairro validado é reaproveitado durante o pedido;
- proteção contra perguntas repetidas e loops de itens/quantidades/endereço;
- continuidade obrigatória do atendimento;
- fluxo de resumo/confirmacao sem loop;
- resumo com nome, endereço (entrega), itens, taxa e total;
- confirmação positiva cria o pedido sem reenviar o resumo;
- alterações reais invalidam o resumo e exigem nova confirmação;
- produtos ativos e bairros configurados como fontes de verdade;
- apagar mensagem para todos via Evolution API quando suportado.

## Cardápio digital
- interface pública mobile-first inspirada em apps de delivery, com identidade HotBox;
- catálogo, categorias, produto, carrinho, checkout e acompanhamento;
- Pix antecipado com QR Code/copia-e-cola configurável;
- cartão antecipado via Stripe Checkout + webhook;
- dinheiro antecipado com confirmação manual;
- não oferece pagamento na entrega;
- pedidos aguardam pagamento antes de entrar no fluxo operacional;
- após pagamento confirmado, pedido segue o fluxo normal e atualizações de WhatsApp.

## Banco
Aplique as migrations ainda não executadas em `supabase/migrations`, especialmente:
- `20260828013000_digital_menu_payments_stripe.sql`

## Deploy
Use a pasta `hotboxdelivery-main` como raiz do deploy Railway.

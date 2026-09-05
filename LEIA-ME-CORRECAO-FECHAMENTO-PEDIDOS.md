# Correção crítica — fechamento, total e alterações do pedido

## O que foi corrigido

1. O resumo final agora é enviado pelo backend, uma única vez, e sempre contém:
   - itens e valores;
   - subtotal;
   - taxa de entrega;
   - **TOTAL A PAGAR**;
   - forma de pagamento.
2. Na primeira confirmação explícita do cliente, o backend consome a confirmação com trava contra processamento duplicado e cria o pedido automaticamente.
3. Não existe segunda aprovação depois do aviso de prazo. O pedido é persistido na mesma rodada; depois o cliente recebe o aviso de até 40 minutos e a confirmação do pedido.
4. Webhooks duplicados/concorrrentes não podem mais consumir a mesma confirmação e repetir o resumo.
5. Pedido já criado pode ser alterado via WhatsApp:
   - adicionar/trocar/alterar quantidade de itens;
   - cancelar apenas um item;
   - recalcular subtotal e total;
   - informar o novo total ao cliente automaticamente.
6. Cancelamento do pedido inteiro passa o pedido diretamente para `cancelled`, com `cancel_reason` registrando que o cliente cancelou pelo WhatsApp.
7. Se o último item for removido, o pedido inteiro é cancelado automaticamente.

## Migration nova

Aplique:

`supabase/migrations/20260827170000_whatsapp_order_edit_atomic.sql`

Ela cria a função transacional usada nas alterações de itens de pedidos já criados.

## Arquivo central alterado

`src/routes/api/public/webhooks.evolution.ts`

## Deploy

Use a raiz `hotboxdelivery-main/` deste pacote como projeto do Railway.

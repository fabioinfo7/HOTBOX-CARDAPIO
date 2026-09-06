# HotBox Delivery — pacote completo consolidado

Este pacote parte do projeto completo original e incorpora as correções e recursos solicitados até 27/08/2026.

## Principais pontos consolidados
- IA/WhatsApp com validação de bairro, correções de alias e recuperação de bairro corrigido.
- Educação reforçada: solicitações ao cliente devem usar `por favor` ou formulação cordial equivalente.
- Cardápio do WhatsApp somente para bairro atendido pela entrega própria ou retirada.
- Bairro externo redirecionado para plataformas, sem expor preços/cardápio do WhatsApp.
- Pagamento determinístico e correção do loop de confirmação.
- Aviso de prazo de até 40 minutos antes da criação do pedido.
- Produtos ativos como fonte de verdade.
- Ingredientes para cliente/IA dentro da edição do produto, com importação em bloco.
- Contexto/batching de mensagens da IA.
- Chat com retomada de conversa e destaque sonoro/visual para cliente que chamou em pedido ativo.
- Avaliação automática pós-entrega e estados de avaliação em Leads.
- Fila de entregadores mais confiável e histórico de repasses.
- Correções financeiras e sincronização de totais de pedidos.

## Importante
A correção experimental criada depois para `WhatsApp não recebe mensagens` NÃO foi incluída, conforme solicitado.

## Banco de dados
Antes do novo deploy, aplique no Supabase todas as migrations ainda não aplicadas, em ordem cronológica, dentro de `supabase/migrations`.

As migrations novas/consolidadas incluem, entre outras:
- 20260826160000_fix_order_status_whatsapp.sql
- 20260826163000_add_99food_order_source.sql
- 20260826170000_ai_order_hardening.sql
- 20260826210000_deliverer_payment_history.sql
- 20260826214000_deliverer_queue_reliable.sql
- 20260826225000_sync_lead_names_from_orders.sql
- 20260826232000_auto_satisfaction_10min.sql
- 20260826235500_whatsapp_ai_message_batching.sql
- 20260827003000_financial_integrity.sql
- 20260827152500_product_customer_ingredients.sql
- 20260827163000_sync_operational_ai_rules.sql

## Deploy Railway
O projeto mantém `railway.json`, `nixpacks.toml` e `package.json` na raiz. Faça o deploy apontando para a raiz deste projeto (`hotboxdelivery-main`).

# HotBox Delivery — pacote completo para deploy (06/09/2026)

Este pacote consolida o sistema base com as atualizações recentes do cardápio digital e Mercado Pago.

## Atualizações incluídas

- Analytics 360 do cardápio digital (já presente no pacote base).
- Persistência da taxa de entrega validada durante a sessão.
- Rolagem automática para a seção de meios de pagamento.
- Mercado Pago usando Orders API para novas cobranças.
- Webhook Mercado Pago para eventos de Order.
- Modo Mercado Pago `test` / `production`.
- Estorno Mercado Pago total e parcial.
- Histórico de estornos e reflexo no financeiro.
- Proteção para pagamento aprovado após expiração visual do checkout.
- Correção de compatibilidade com o `preflight.mjs`.
- Estorno isolado em `src/lib/mercadopago-refund.functions.ts` para evitar conflito de exports do TanStack.

## Banco de dados

A migração abaixo está incluída no pacote:

`supabase/migrations/20260906140000_mercadopago_orders_estornos_ambiente.sql`

Se o seu deploy não executa migrations automaticamente, rode também o arquivo da raiz:

`APLICAR-MERCADOPAGO-ORDERS-ESTORNOS-E-AMBIENTE.sql`

no Supabase SQL Editor antes de testar pagamentos/estornos.

## Teste antes de produção

1. Em Configurações > Pagamentos, selecione Mercado Pago e ambiente **Teste**.
2. Cadastre Public Key e Access Token do bloco **Credenciais de teste** da mesma aplicação.
3. Teste Pix e cartão.
4. Confirme que o pedido só nasce após confirmação do Mercado Pago.
5. Confirme o registro em Recebimentos do Cardápio Digital.
6. Faça um estorno de teste e confira o histórico/financeiro.
7. Somente depois mude o ambiente para **Produção** e use as credenciais de produção.

## Verificação de preflight

O pacote foi verificado localmente com:

`node preflight.mjs`

Resultado esperado: `HOTBOX PRE-FLIGHT OK`.


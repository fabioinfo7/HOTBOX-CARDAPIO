# Auditoria Financeira V3 — HotBox Delivery

## Estrutura definida

O Financeiro Geral passa a separar quatro conceitos que não podem ser misturados:

1. **Faturamento**: pedidos entregues, reconhecidos pela data de entrega.
2. **Resultado**: faturamento menos CMV, taxas de plataformas, repasses de entregadores e despesas operacionais por competência.
3. **Fluxo de caixa realizado**: somente dinheiro efetivamente recebido ou pago, pela data real do movimento.
4. **Previsão financeira**: valores a receber e a pagar que ainda não entraram nem saíram do caixa.

## Fonte única do caixa

Foi criada a tabela `financial_transactions`. Ela é o livro-caixa canônico.

Entram automaticamente:
- pedidos diretos efetivamente pagos;
- pagamentos InfinitePay/cardápio digital;
- contas a receber quando quitadas;
- despesas quando pagas;
- previsões de contas a receber/despesas;
- repasses iFood/99Food como previsão até conciliação;
- lançamentos manuais de entrada/saída.

A chave `source_type + source_id` impede duplicação de lançamentos automáticos.

## Regras importantes

- Pedido `payment_timing = later` não entra diretamente no caixa: ele é controlado pelo A Receber.
- A Receber pendente fica apenas como previsão; só vira caixa quando marcado pago.
- Despesa pendente fica apenas como A Pagar; só vira saída quando marcada paga.
- Compras de ingredientes saem do caixa, mas não são descontadas outra vez do resultado quando o CMV já considera o consumo.
- Pedido cancelado que já foi pago não apaga o dinheiro do histórico. Se houver devolução, deve existir uma saída/estorno real.
- iFood/99Food não são considerados dinheiro já recebido pela loja apenas porque o cliente pagou a plataforma. O sistema cria repasse previsto e o administrador concilia quando cair.
- InfinitePay refinia o lançamento do pedido com o valor confirmado pelo checkout.
- Datas de caixa são agrupadas em `America/Sao_Paulo`.
- Despesas passam a ter `competence_date`, separando competência, vencimento e pagamento.

## Problemas corrigidos nesta versão

- Fluxo de caixa dependia de três fontes separadas e não permitia registrar movimentações avulsas.
- O cardápio digital tinha um painel próprio, mas não havia uma fonte única explícita de caixa.
- `paid_at` de despesas podia ser gravado como uma data sem horário, provocando deslocamento de dia quando interpretada como UTC.
- Contas a receber não tinham vínculo explícito com o pedido de origem.
- A tela dizia que quitar A Receber entrava no “lucro real”; isso é incorreto: recebimento altera caixa, não cria lucro novamente.
- Despesas eram usadas pelo vencimento também no resultado; agora existe competência separada.
- Repasse de marketplace podia ser confundido com dinheiro disponível.

## Instalação

1. Faça backup do banco/projeto.
2. Execute `supabase/migrations/20260903030000_financeiro_unificado_fluxo_caixa.sql` no Supabase.
3. Substitua os arquivos TSX deste pacote mantendo as mesmas pastas.
4. Faça deploy no Railway.
5. Teste os cenários descritos em `TESTES-FINANCEIROS.txt`.

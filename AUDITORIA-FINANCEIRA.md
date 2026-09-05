# Auditoria Financeira — Hotbox Delivery

## Resumo executivo

O sistema possuía boas bases (pedidos, itens, custos, despesas, cupons, entregadores e contas a receber), porém vários indicadores usavam regras diferentes. Isso fazia Dashboard, Financeiro e Contas a Receber poderem apresentar números desconectados.

A correção desta auditoria estabelece as seguintes regras:

1. **Venda/faturamento:** somente pedido `delivered`, usando `delivered_at`.
2. **Subtotal:** soma de `order_items.quantity × order_items.unit_price`.
3. **Total do pedido direto:** `max(0, subtotal - desconto) + taxa de entrega`.
4. **Quantidade vendida:** soma real de `quantity`; 1 cliente comprando 5 unidades = 5 unidades vendidas.
5. **Ticket médio:** faturamento de pedidos entregues ÷ quantidade de pedidos entregues.
6. **CMV:** custo unitário cadastrado × quantidade vendida.
7. **Taxa de plataforma:** percentual configurado × total do pedido entregue.
8. **Repasse de entregador próprio:** taxa de entrega dos pedidos vinculados a entregador.
9. **Lucro operacional/estimado:** faturamento − CMV conhecido − taxas de plataforma − repasses − despesas operacionais.
10. **Fluxo de caixa:** somente entradas e saídas efetivamente marcadas como pagas, pela data real do pagamento.

## Problemas críticos encontrados e corrigidos

### 1. Dashboard inflava faturamento
O Dashboard antigo somava todos os pedidos exceto `cancelled`. Isso incluía pedidos pendentes, em preparo e `failed`.

**Correção:** faturamento, ticket e produtos vendidos usam apenas pedidos entregues.

### 2. Período financeiro usava data de criação, não data de entrega
Um pedido criado ontem e entregue hoje aparecia no dia errado.

**Correção:** vendas reconhecidas por `delivered_at`. Pedidos entregues antigos sem `delivered_at` recebem `created_at` como backfill de compatibilidade.

### 3. Contas a receber podiam ficar com valor incorreto
A tela somava itens visualmente, mas o cabeçalho `receivables.amount` não era garantido pelo banco.

**Correção:** trigger recalcula o valor sempre que um item é inserido, alterado ou removido. A tela também grava o total explicitamente.

### 4. Receita podia contar a mesma venda duas vezes
A Central Financeira somava pedidos entregues + contas a receber pagas. Quando a conta a receber vinha de um pedido, o mesmo faturamento podia ser contabilizado novamente.

**Correção:** contas a receber quitadas não aumentam faturamento de vendas; entram somente no fluxo de caixa.

### 5. “Fluxo de caixa” não era fluxo de caixa
A versão anterior usava venda pela data do pedido e despesa pela data de vencimento, mesmo sem pagamento.

**Correção:** nova função `financial_cash_daily()` usa:
- pedidos realmente pagos;
- contas a receber realmente quitadas;
- despesas realmente pagas;
- data real do pagamento.

### 6. Lucro real comparava bases diferentes
A receita excluía pedidos sem custo, mas as taxas de plataforma eram subtraídas de todos os pedidos. Isso podia reduzir o lucro artificialmente.

**Correção:** todos os pedidos entregues entram na receita. CMV conhecido é subtraído por unidade. Falta de custo gera percentual de cobertura e o resultado passa a ser chamado **Lucro estimado** até 100% das unidades terem custo.

### 7. Compra de ingredientes podia ser descontada duas vezes
O custo dos produtos é calculado pela ficha técnica/ingredientes. Depois o Financeiro também subtraía a despesa “Ingredientes / Insumos” inteira do lucro.

**Correção:** compras de ingredientes permanecem no **fluxo de caixa**, mas não são subtraídas novamente do lucro operacional, porque o consumo já aparece no CMV.

### 8. Taxa de entrega entrava como receita sem descontar o entregador
O app do entregador usa `delivery_fee` como ganho/repasse. O Financeiro somava essa taxa no total do pedido, porém não descontava o repasse.

**Correção:** pedidos com entregador próprio vinculado subtraem a taxa de entrega como repasse no resultado.

### 9. Período padrão incluía despesas futuras
A página abria do primeiro ao último dia do mês, incluindo despesas que ainda não venceram enquanto as vendas futuras ainda não existem.

**Correção:** padrão passa a ser do primeiro dia do mês **até hoje**.

### 10. Quantidade de produtos era pouco controlável
Havia ranking, mas o Dashboard mostrava apenas top 5 e faltavam filtros por volume.

**Correção:** Dashboard e Financeiro agora controlam unidades reais e oferecem filtros por:
- busca por produto;
- categoria;
- qualquer quantidade;
- 2+;
- 5+;
- 10+;
- 20+;
- 50+ unidades.

Também exibem:
- unidades vendidas;
- produtos distintos;
- pedidos contendo o produto;
- faturamento dos itens;
- itens por pedido.

### 11. Produtos podiam ser duplicados por variação de texto
Agrupar somente pelo nome podia separar “Strogonoff” e “strogonoff”.

**Correção:** prioridade para `product_id`; quando não existe, nome é normalizado.

### 12. Percentual de lucro da aba Dízimo era markup, não margem
A fórmula antiga era `lucro / custo`, mas a coluna dizia `% Lucro`. Isso é markup.

**Correção:** margem passa a ser `contribuição / receita líquida do produto`. A receita do produto considera desconto proporcional de cupom e taxa de plataforma antes do CMV.

## Organização nova do Dashboard

### Vendas concluídas
- Faturamento
- Pedidos entregues
- Unidades vendidas
- Produtos diferentes
- Ticket médio
- Itens por pedido

### Operação
- Pedidos criados
- Pendentes
- Em andamento
- Cancelados/falhos

Esses blocos ficam separados para um pedido em preparo nunca parecer faturamento.

### Produtos vendidos
Tabela completa com quantidade e filtros, sem limitar a top 5.

## Conceitos que agora ficam separados

### Faturamento
Valor das vendas entregues. Não significa dinheiro no banco.

### Fluxo de caixa
Entradas e saídas efetivamente pagas no período.

### CMV
Custo dos produtos efetivamente vendidos/consumidos.

### Compra de estoque
Saída de caixa para ingredientes. Não deve ser novamente tratada como CMV no mesmo período.

### Lucro operacional
Faturamento menos custos diretamente atribuíveis e despesas operacionais. Só pode ser considerado exato quando a cobertura de custos estiver em 100%.

## Limitações que precisam continuar visíveis

### Taxas iFood/99Food
O cálculo usa os percentuais configurados no sistema. É uma **estimativa** enquanto não houver importação do extrato real de repasses/taxas das plataformas. Diferenças de campanha, antecipação, taxa variável ou ajuste do marketplace não são conhecidas pelo sistema.

### Despesas recorrentes
O campo `recurrence` atualmente identifica “mensal/semanal”, mas o projeto original não cria automaticamente as próximas competências. Nesta auditoria não foi criado um gerador automático para evitar duplicar despesas históricas sem uma decisão operacional. Até isso ser implementado, cada competência deve existir como lançamento próprio para entrar no resultado.

### Saldo bancário / capital de giro
O sistema não conhece o saldo inicial das contas bancárias. Por isso “capital de giro” foi retirado como número absoluto. O indicador correto agora é **movimento líquido de caixa do período**.

## Arquivos desta correção

- `src/routes/_authenticated/loja.dashboard.tsx`
- `src/routes/_authenticated/loja.financeiro.tsx`
- `src/routes/_authenticated/loja.receber.tsx`
- `supabase/migrations/20260827003000_financial_integrity.sql`

A migration deve ser aplicada antes de validar o novo fluxo de caixa e os triggers de integridade.

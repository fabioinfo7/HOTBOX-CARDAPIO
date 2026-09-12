# HotBox Delivery — versão consolidada 12/09/2026

Este pacote consolida a base completa do sistema com as atualizações mais recentes aplicadas sobre ela.

## Principais atualizações incluídas

- Central de Pedidos reformulada em 3 colunas: **Em preparo**, **Pronto** e **Saiu para entrega**.
- Clique no card abre um **painel lateral pela direita**, com 50% da tela no desktop e tela inteira no celular.
- Edição completa do pedido no painel lateral: cliente, telefone, endereço, taxa, total, pagamento, observações, itens e preços.
- Inclusão de produto do cardápio ou **qualquer item manual** no pedido.
- Botão **Avisar que chegou** restaurado no card/painel para pedidos em entrega.
- Mudança visual de status move o pedido entre as colunas.
- WhatsApp automático em **Em preparo**, **Saiu para entrega** e **Entregue**. O status **Pronto não envia mensagem**.
- Cancelamento continua disponível e preserva aviso operacional.
- IA do WhatsApp reconhece adicionais estruturados e usa o preço cadastrado.
- Clube HotBox com controle manual de participantes, marcações, compras válidas, recompensas, exclusão lógica/reativação e histórico.
- Analytics amigável, paginação de visitantes, presença ao vivo e origem sem siglas técnicas.
- Alertas no painel para pessoas no cardápio e adições à sacola.
- Produtos inativos também ficam indisponíveis quando aparecem como adicionais.
- Cadastro manual de CEPs por bairro, sem perder taxa por bairro/km.
- Rastreamento Meta Pixel/CAPI e registro de cartão recusado preservados.

## SQLs novos desta consolidação

Se ainda não foram executados com sucesso no Supabase, rode nesta ordem:

1. `supabase/migrations/20260910220000_meta_pixel_capi_rich_tracking.sql`
2. `supabase/migrations/20260911190000_analytics_live_presence.sql`
3. `supabase/migrations/20260911223000_bairros_ceps_manuais.sql`
4. `supabase/migrations/20260912013000_clube_hotbox_controle_manual.sql`
5. `supabase/migrations/20260912024500_status_whatsapp_sem_pronto.sql`

O SQL de bairros/CEPs deste pacote já é a versão corrigida para o erro PostgreSQL `cannot remove parameter defaults from existing function`.

Não rode novamente migrations antigas que já foram aplicadas com sucesso, a menos que sejam idempotentes e você saiba por que está repetindo.

## Deploy

O `package.json` está na raiz. Use este ZIP como raiz do projeto no Railway.

Antes do deploy, faça backup/commit do projeto que está rodando atualmente.

## Validação feita no pacote

- `npm run prebuild`: **OK**.
- Verificação sintática de todos os arquivos TypeScript/TSX usando TypeScript `transpileModule`: **0 erros**.
- O build Vite completo não foi executado porque a instalação de dependências (`npm install`) excedeu o tempo disponível neste ambiente.

## Testes rápidos depois do deploy

1. Faça um pedido teste e confirme que aparece em **Em preparo**.
2. Marque como **Pronto** e confirme que o cliente **não recebe WhatsApp**.
3. Marque **Saiu para entrega** e confirme o WhatsApp.
4. Use **Avisar que chegou** e confirme a mensagem manual.
5. Marque **Entregue** e confirme o WhatsApp final.
6. Abra um card e teste edição de endereço, taxa, total, item existente e item manual.
7. Confira Clube HotBox, Analytics ao vivo e cadastro manual de CEP.

## CORREÇÃO CRÍTICA — PEDIDOS NUNCA SE MISTURAM

Esta versão também corrige a separação entre pedidos feitos pelo mesmo telefone.

- Depois que um pedido é criado, o rascunho comercial é zerado por completo.
- Um pedido novo não herda itens, nome, endereço, bairro, pagamento, taxa ou observações do pedido anterior.
- O contexto usado pela IA para montar o pedido atual começa depois do último pedido WhatsApp realmente criado.
- Dois ou mais pedidos feitos no mesmo dia continuam independentes.
- Um pedido já criado só é alterado quando o cliente disser explicitamente que quer mexer naquele pedido.
- O botão “Gerar pedido com IA” também considera somente as mensagens posteriores ao último pedido já criado.
- Rascunhos abandonados ficam válidos por até 90 minutos; depois disso uma nova coleta é iniciada.
- Adicionais são consultados nas configurações reais do cardápio: product_addon_groups, menu_addon_groups e menu_addon_options.
- Se o adicional estiver configurado para usar o preço do produto vinculado, o preço vigente desse produto é usado.
- Adicional vinculado a produto inativo não entra no pedido.
- O resumo final mostra nome, endereço, referência, itens, adicionais/observações, subtotal, taxa de entrega, forma de pagamento e total a pagar.
- A taxa de entrega continua sendo somada ao total e, no fluxo manual, é consultada pela área/bairro quando disponível.

TESTES RECOMENDADOS DESTA CORREÇÃO:
1. Faça um pedido completo e finalize.
2. No mesmo WhatsApp, faça um segundo pedido diferente.
3. Confirme que o segundo pedido não contém nenhum item do primeiro.
4. Repita o teste no mesmo dia com o primeiro pedido ainda ativo; um novo pedido só deve alterar o anterior se o cliente disser explicitamente “adicione no meu pedido”, “retire do meu pedido” etc.
5. Faça um pedido com adicional cadastrado e confira base + adicional + taxa no resumo e no total.
6. Teste também o botão “Gerar pedido com IA” após já existir um pedido anterior naquela conversa.

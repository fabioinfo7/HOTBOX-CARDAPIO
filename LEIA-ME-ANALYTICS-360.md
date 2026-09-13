# HOTBOX ANALYTICS 360

## Instalação
1. Abra o Supabase > SQL Editor.
2. Execute todo o arquivo `APLICAR-ANALYTICS-360-SUPABASE.sql`.
3. Faça o deploy deste projeto no Railway.
4. Entre no painel da HotBox e acesse **Comercial > Analytics 360**.

## O que é rastreado
- visitante e sessão (IDs pseudônimos persistentes)
- data/hora, página de entrada, páginas vistas e saída
- origem/referrer, UTM source/medium/campaign/term/content
- fbclid/gclid/ttclid/msclkid quando presentes
- dispositivo, navegador, sistema operacional, idioma, fuso e resoluções
- IP e cidade/região/país quando o proxy/CDN do deploy fornece esses cabeçalhos
- cliques, inclusive botões da Bio (WhatsApp, iFood e 99Food)
- foco em campos de formulário sem armazenar o valor digitado pelo rastreador genérico
- rolagem 25/50/75/90/100%
- tempo de permanência e saída de página
- produto visualizado
- produto/adicionais/order bump adicionados ao carrinho
- início do checkout e total
- cupom, subtotal, desconto, taxa e modo de entrega no evento de checkout
- forma de pagamento escolhida
- criação do checkout, redirecionamento para pagamento e erros
- compra/pedido criado e receita atribuída
- abandono após 15 minutos sem atividade quando houve carrinho ou checkout

## Painel
- visitantes, sessões, conversões, receita, pageviews, carrinho, checkout, abandonos
- funil completo com perdas entre etapas
- origem/canal e taxa de conversão
- campanhas
- páginas mais visitadas
- cliques e ações
- localização aproximada
- dispositivos
- formas de pagamento
- produtos visualizados e adicionados
- jornadas individuais pesquisáveis
- linha do tempo detalhada de eventos por sessão
- botão **Imprimir relatório**

## Privacidade
O Analytics não grava senha, CVV, número completo de cartão nem conteúdo secreto dos campos. Os pagamentos continuam sendo tratados pelos provedores já existentes.

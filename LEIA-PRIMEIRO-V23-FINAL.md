# HOTBOX V23 FINAL — sistema completo consolidado

Base: arquivo HOTBOX-CARDAPIO-main.zip enviado pelo usuário (versão atualmente em uso).
Sobre essa base foram consolidadas as alterações de atendimento e frete solicitadas nesta conversa.

## Incluído
- atendimento WhatsApp com estado persistente e anti-loop;
- não reinicia pedido já confirmado;
- confirmação de itens intermediária protegida;
- cardápio em imagem automático ao validar bairro atendido;
- reenvio do cardápio quando o cliente pedir cardápio/menu/preço/valor;
- biblioteca oficial/instruções da IA como fonte factual;
- handoff humano somente quando realmente necessário;
- handoff silencioso para o cliente;
- popup + alarme interno para atendimento humano;
- MP3 configurável para o alarme;
- cupom informado no chat, validado por telefone e regras do sistema;
- cupom/desconto no resumo e no card do ADM;
- modo operacional do frete no WhatsApp: taxa fixa por bairro ou motoboy parceiro;
- os dois modos são mutuamente exclusivos;
- exceções por rua têm prioridade sobre o modo geral;
- rua pode forçar taxa fixa própria ou motoboy parceiro;
- em parceiro, a IA não informa nem estima taxa;
- popup exige valor cotado e autorização;
- taxa autorizada é enviada uma vez e congelada para o endereço;
- mudança de endereço invalida a taxa anterior;
- backend, não IA, decide preço, frete, cupom, total, fechamento e regras comerciais.

## SQL
Os SQLs foram entregues separadamente do ZIP principal.
Rode em ordem:
01_V15_ATENDIMENTO_BLINDADO.sql
02_V17_CUPOM_WHATSAPP.sql
03_V20_FRETE_MODO_RUAS.sql

## Validação feita neste ambiente
- preflight.mjs: OK;
- auditoria de imports internos dos arquivos alterados: nenhum módulo interno ausente;
- parsing TypeScript/TSX dos arquivos críticos: sem erro sintático; as únicas mensagens da checagem isolada foram dependências externas não instaladas neste container.

Não foi possível executar um vite build completo localmente porque a instalação das dependências npm não concluiu dentro do ambiente de execução. A base enviada pelo usuário é a versão atualmente rodando, e as alterações foram consolidadas sobre essa mesma base.

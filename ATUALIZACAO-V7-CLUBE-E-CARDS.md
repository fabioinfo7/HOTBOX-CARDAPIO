# HOTBOX V7 — Cards compactos + Clube HotBox com controle total

## Pedidos
- Cards da Central de Pedidos foram compactados em aproximadamente 40% de altura/densidade visual.
- Mantidos: clique no card, avanço de status, cancelar, aviso WhatsApp de chegada, total, pagamento, origem, tempo e endereço.
- A aba lateral de detalhes continua completa e não foi reduzida.

## Clube HotBox
Agora o administrador pode:
- criar um novo usuário diretamente pelo painel;
- definir nome, telefone, e-mail e senha inicial;
- lançar selos/marcações iniciais;
- definir compras válidas acumuladas;
- adicionar observação interna;
- adicionar usuários que já existem no sistema;
- editar nome, telefone e e-mail;
- redefinir senha do cliente;
- editar selos/marcações e compras válidas;
- adicionar/remover selos com ou sem contar como compra;
- liberar batata grátis manualmente;
- cancelar recompensa ainda não usada;
- remover do Clube preservando histórico;
- reativar participante;
- excluir definitivamente o usuário de login com confirmação forte.

## Segurança
Todas as ações que criam, alteram senha/e-mail ou excluem usuários usam Supabase Admin no servidor e exigem usuário com papel `store_admin`.

## Verificações
- `node preflight.mjs`: OK
- 176 arquivos TS/TSX/JS/JSX analisados sintaticamente: 0 erros
- Nenhum import `analytics.client` voltou ao projeto.

O `npm install` completo não terminou dentro do limite deste ambiente, por isso o build Vite completo não foi executado localmente.

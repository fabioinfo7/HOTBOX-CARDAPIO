# HotBox Delivery — Migração completa para fora do Lovable

Este pacote já está com o código corrigido e testado (build validado localmente).
Segue exatamente o que foi mudado e o que você precisa fazer para colocar no ar.

## O que foi corrigido no código

1. **`vite.config.ts`** — reescrito do zero, sem depender do `@lovable.dev/vite-tanstack-config`.
   Agora usa os pacotes oficiais do TanStack Start (`@tanstack/react-start/plugin/vite`) +
   `nitro/vite`, que geram um servidor Node.js padrão. **Testado**: `npm run build` gera
   `.output/server/index.mjs`, que sobe normalmente com `node .output/server/index.mjs`
   (ou `npm run start`, que já faz isso).

2. **Bug real corrigido** (não era do Lovable): o arquivo `zonas-populate.server.ts` tinha um
   nome que o TanStack Start bloqueia de ser importado por código do cliente — isso travava o
   build. Renomeado para `zonas-populate.functions.ts` (mesmo padrão dos outros arquivos do
   projeto) e o import em `use-populate-zonas.ts` foi ajustado.

3. **IA independente do Lovable** — `freight.functions.ts` (limpeza de endereço pra calculadora
   de frete) e `logs-ai.functions.ts` (assistente de logs) usavam o AI Gateway do Lovable
   (`ai.gateway.lovable.dev`). Agora os dois usam as **mesmas chaves já cadastradas em
   Configurações** (`openai_api_key` / `groq_api_key` na tabela `store_config`) — o mesmo
   esquema que o bot de atendimento automático do WhatsApp já usava (esse nunca dependeu do
   Lovable). **Você precisa ter uma chave da OpenAI ou da Groq cadastrada em Configurações →
   Integrações** para essas duas funções funcionarem.

4. **Módulo de login social do Lovable removido** (`src/integrations/lovable/`) — código morto,
   nunca era chamado em nenhuma tela.

5. **Referências cosméticas limpas** — mensagens de erro, comentários, imagem de preview no
   `<head>` do site, `AGENTS.md` (removido), `bunfig.toml` (lista de exceções do Lovable
   removida). Nenhuma delas tinha efeito funcional, mas ficaram limpas.

6. **Duas migrations novas: tabelas, colunas e bucket "órfãos"** — auditoria completa
   comparando o schema real do banco antigo (arquivo `types.ts`) contra tudo que estava
   escrito nas migrations. Achamos **10 tabelas inteiras**, **1 tabela extra (`expenses`)**,
   **1 storage bucket** e **mais de 40 colunas** espalhadas em 8 tabelas diferentes que
   existiam no banco antigo mas foram criadas manualmente no painel do Lovable — nunca
   capturadas em nenhum arquivo de migration. Reconstruídas em:
   - `20260807000001_tabelas_e_bucket_orfaos.sql`
   - `20260807000002_colunas_e_tabela_expenses_orfas.sql`

   Ambas usam `IF NOT EXISTS`, então são seguras de rodar mesmo se parte já existir.

7. **Login do admin criado via SQL** (não existe tela de "criar conta" no sistema — só
   login). O sistema já tem um mecanismo próprio de "primeiro admin": ao logar sem
   nenhum admin cadastrado, aparece uma tela com o botão **"Sou o dono da loja"** — é
   só clicar, sem precisar de nenhuma trigger customizada.

## O que você precisa fazer agora

### 1. Rodar as migrations novas no Supabase

Se você já rodou o `schema_completo_hotbox.sql` que te passei antes, rode agora, no SQL
Editor, **nesta ordem**, os dois arquivos novos (estão em `supabase/migrations/`):
1. `20260807000001_tabelas_e_bucket_orfaos.sql`
2. `20260807000002_colunas_e_tabela_expenses_orfas.sql`

Se ainda não rodou nada, pode colar as 45 migrations inteiras da pasta em ordem
cronológica (pelo nome do arquivo) que já vem tudo certo.

### 2. Completar o `.env`

Abra o arquivo `.env` deste pacote e troque:
```
SUPABASE_SERVICE_ROLE_KEY="COLE_AQUI_A_SECRET_KEY_COMPLETA"
```
pela Secret Key completa do projeto novo — pegue em **Project Settings → API Keys → Secret
keys** no painel do Supabase (a que começa com `sb_secret_...`). Sem isso, o backend
(pedidos, iFood, WhatsApp) não consegue gravar no banco.

### 3. Subir pro GitHub

```bash
git init
git add .
git commit -m "Migração: independente do Lovable, pronto para Railway"
git remote add origin <seu-repositorio>
git push -u origin main
```

### 4. Configurar no Railway

- **New Project → Deploy from GitHub repo** → seleciona esse repositório
- Em **Variables**, adicione TODAS as linhas do `.env` (o Railway não lê o arquivo `.env`
  automaticamente do repositório por segurança — precisa colar cada variável manualmente
  na aba Variables)
- Build e start já estão configurados via `railway.json` (usa Nixpacks, roda
  `npm run start` depois do build automático)
- O Railway define a variável `PORT` sozinho — o `vite.config.ts` já está preparado pra
  usar ela (`process.env.PORT`)

### 5. Primeiro acesso

Como o sistema não tem tela de "criar conta" (só login), crie seu usuário admin direto no
SQL Editor do projeto — veja o script `criar_admin.sql` que te passei à parte (cria só o
login; não atribui a role de admin). Depois:
1. Acesse a URL do Railway e faça login com esse e-mail/senha
2. Como ainda não existe nenhum admin cadastrado, vai aparecer a tela "Acesso restrito"
   com o botão **"Sou o dono da loja"** — clique nele
3. Pronto, você é o admin geral (`store_admin`)

### 6. Reconfigurar integrações

Como o banco começou vazio, entre em **Configurações** e recadastre:
- Chave da OpenAI ou Groq (pra IA de atendimento, frete e logs funcionarem)
- Credenciais do iFood (`ifood_client_id`, `ifood_client_secret`, `ifood_merchant_id`)
- WhatsApp (Evolution API ou Meta Cloud API — token, número, webhook)
- Stripe (se usar checkout)
- Pix, endereço da loja, faixas de entrega, cardápio, etc.

⚠️ **iFood**: como a homologação já foi feita antes, ao reconectar as credenciais no ambiente
novo pode ser necessário atualizar a URL de callback/redirect no Portal do Desenvolvedor do
iFood para o domínio novo do Railway. Vá com calma nessa parte — evite testar em horário de
pico de pedidos.

⚠️ **WhatsApp (Meta Cloud API)**: o Webhook URL cadastrado no Meta for Developers precisa ser
atualizado para o domínio novo do Railway, ou o bot para de receber mensagens.

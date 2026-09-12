# MAPA DO SISTEMA — HotBox Delivery (Swift Order Pro)

> **Para qualquer IA que for mexer neste projeto:** leia este arquivo INTEIRO antes de tocar em qualquer código.
> Ele existe para você não perder tempo reentendendo o sistema do zero e não repetir bugs já resolvidos.
> **Sempre que você fizer uma mudança relevante (nova feature, correção de bug, mudança de regra de negócio), atualize este arquivo antes de terminar a tarefa.**

---

## 1. VISÃO GERAL

O HotBox Delivery é um sistema completo de gestão de delivery para uma loja especializada em batata recheada (HotBox, Instagram @HOTBOXBATATA), localizada em Dr. Laureano, Duque de Caxias/RJ. O sistema cobre:

- Atendimento automático ao cliente via WhatsApp com IA
- Cardápio digital com pagamento online
- Gestão de pedidos em tempo real (admin)
- App/fluxo para entregadores
- Cálculo de taxa de entrega por bairro/zona
- Integrações com marketplaces externos (iFood, 99Food)
- Pagamentos (Pix, Cartão via Stripe)

**Regra de ouro do negócio:** a loja só trabalha com delivery (sem atendimento presencial), entrega apenas quinta a domingo, das 18h à meia-noite, e só aceita Pix ou Cartão (não aceita dinheiro).

---

## 2. STACK TÉCNICA

| Camada | Tecnologia |
|---|---|
| Framework principal | TanStack Start (React full-stack) |
| Banco de dados | Supabase (Postgres) — projeto próprio "hotboxdelivery" (região São Paulo, Project ID `zhgeljtgwotlaudtfqoa`) |
| Hospedagem | Railway (migrado do Lovable Cloud em 07/08/2026) |
| Pagamento cartão | Stripe (checkout seguro) |
| IA de atendimento | OpenAI (ChatGPT) como principal, com 1 chave Groq como reserva (failover) |
| WhatsApp | Duas opções configuráveis: Evolution API (não oficial) ou Meta Cloud API (oficial) — **atualmente ativa: Meta Cloud API** |
| Marketplace | iFood (homologado 100%), 99Food (Open Delivery, em integração) |

**Importante:** o projeto foi migrado para fora do Lovable — não existe mais dependência de `@lovable.dev/vite-tanstack-config`, AI Gateway do Lovable, ou login social do Lovable. O build usa `@tanstack/react-start/plugin/vite` + `nitro/vite`. Node fixado em versão 22.x (18.x quebra o build por causa do `util.styleText` usado pelo vite/rolldown) — configurado via `package.json engines`, `nixpacks.toml` e `.nvmrc`.

---

## 3. ESTRUTURA DE ROTAS (visão de alto nível)

- `/loja/*` → painel administrativo (config, pedidos, cardápio, entregadores, histórico)
- `/loja/config` → seletor de provedor WhatsApp (Evolution vs Meta), chaves de IA, regras de entrega
- `src/routes/api/public/webhooks.evolution.ts` → webhook de entrada da Evolution API
- `src/routes/api/public/webhooks.meta.ts` → webhook de entrada da Meta Cloud API (WhatsApp oficial)
- `https://hotboxdelivery.lovable.app/api/public/webhooks/nfood` → webhook da 99Food (Open Delivery) — **atenção:** essa URL antiga do Lovable pode precisar ser atualizada para o domínio novo do Railway

> ⚠️ Se você (IA) não encontrar algum desses arquivos exatamente nesse caminho, procure por nomes parecidos — a estrutura pode ter sido reorganizada. Atualize este mapa quando encontrar a localização real.

---

## 4. FLUXO DE ATENDIMENTO NO WHATSAPP (o coração do sistema)

### 4.1 Fluxo passo a passo
1. Cliente manda mensagem no WhatsApp da loja
2. Mensagem chega via webhook — **Evolution** (`webhooks.evolution.ts`) OU **Meta** (`webhooks.meta.ts`), dependendo do provedor ativo em `/loja/config`
3. Sistema verifica se o atendimento automático está ligado:
   - Interruptor **global** (liga/desliga a IA em todas as conversas de uma vez)
   - Interruptor **individual** por contato (`bot_paused` na tabela `whatsapp_conversations`)
4. Se a IA estiver ativa, a mensagem é processada pela função `handleIncomingMessage` (chamada **diretamente no mesmo processo**, nunca via HTTP self-referencial — ver bug crítico na seção 7)
5. A IA (OpenAI, com Groq como fallback) responde considerando:
   - O cardápio real cadastrado no sistema (preços sempre vêm do banco, nunca de valores "decorados")
   - Regras de bairro/entrega (seção 5)
   - Histórico da conversa
6. Comportamento humanizado: delay de digitação + indicador "digitando..." antes de responder (evita bloqueio por comportamento de bot pela Meta/WhatsApp)
7. Se o pedido for fechado, é criado na tabela de pedidos e o cliente recebe confirmação
8. Notificações de status do pedido (preparando, pronto, saiu para entrega) são enviadas via gatilho `notify_customer_order_status` — **esse gatilho precisa respeitar o campo `whatsapp_provider` (Evolution vs Meta)**, não pode estar fixo em um só (já foi bug — ver seção 7)

### 4.2 Regras de comportamento da IA
- Deve sempre parecer humana; só se identifica como "atendente de inteligência artificial" quando necessário (ex: para justificar por que precisa de mais dados, como endereço não identificado)
- Quando o cliente pede o cardápio, a IA **envia a imagem do cardápio cadastrada no sistema** — nunca lista os itens em texto
- Antes de informar a taxa de entrega ao cliente, a IA **pausa e pede aprovação da loja** via popup em tempo real (30 segundos de espera; sem resposta → libera o valor calculado automaticamente; loja recusa → conversa vai para atendimento manual)
- Cardápio é especializado só em batata recheada — não deve sugerir ou inventar outros pratos

### 4.3 Onde a IA costuma "sair do script" (ponto de atenção permanente)
Esse é o maior ponto de fragilidade histórica do sistema. Ao investigar problemas de "IA respondendo bobagem":
- Verifique se o prompt está reforçando os limites de escopo (só cardápio/pedido/entrega)
- Verifique a temperature configurada na chamada da API (baixa = mais previsível) — ver seção 4.4
- Verifique se o contexto mandado pra IA tem SÓ os dados reais do cardápio/regras atuais (não deixar a IA "inventar" porque faltou informação no prompt)
- Considere adicionar uma camada de verificação pós-resposta (segunda chamada barata perguntando se a resposta está dentro do escopo permitido) antes de qualquer reforço extra no prompt principal

### 4.4 Controle de temperatura da IA (implementado 08/08/2026)
- Configurações → IA / Failover → seletor "Temperatura da IA" (presets de 0.1 a 0.9, ou valor exato)
- Salvo em `store_config.ai_temperature` (default `0.3`), aplicado nas duas chamadas de IA do turno de conversa (`runConversationalTurn` em `webhooks.evolution.ts`)
- Antes disso, a chamada principal não definia `temperature`, usando o padrão do provedor (mais alto/imprevisível) — essa foi uma causa real de a IA sair do script
- Requer a migration `20260808000001_ai_temperature_e_instrucoes.sql` (também insere 2 instruções globais em `ai_instructions`: não informar número do endereço da loja, e Corte 8 só é atendido do lado de cá da estação)

### 4.5 Handoff humano acionado pela IA (implementado 08/08/2026)
Quando a IA não sabe responder com segurança ou fica confusa (pergunta fora do escopo, situação ambígua, erro repetido), ela chama a ferramenta `request_human_handoff` em vez de inventar uma resposta.

Fluxo:
1. IA chama `request_human_handoff` com um `reason` curto
2. Sistema responde ao cliente com uma mensagem **fixa** (nunca gerada pela IA): constante `HUMAN_HANDOFF_MESSAGE` em `webhooks.evolution.ts` — garante que o texto nunca varia ou sai errado
3. Grava um registro em `pending_human_handoffs` (não pausa a conversa ainda)
4. Toca um alarme contínuo **separado** do alarme de pedidos (`src/lib/handoff-alarm-audio.ts` — singleton de áudio próprio, pra não conflitar com o alarme de novos pedidos que usa `src/lib/alarm-audio.ts`), tocando um som **próprio** enviado pela loja (`store_config.handoff_alarm_sound_url`, upload em Configurações → Alertas → "IA pediu atendimento humano" — diferente do som do alarme de pedidos, pra dar pra diferenciar qual alerta está tocando)
5. Popup global (`src/components/human-handoff-alert.tsx`, montado em `loja.tsx` junto ao `FreightApprovalPopup`) mostra telefone/nome/motivo, com contagem regressiva de 2 minutos
6. Atendente clica "Assumir atendimento" → marca `bot_paused = true` na conversa e navega direto pro chat daquele cliente
7. Se ninguém assumir em 2 minutos: job `pg_cron` (`expire_stale_human_handoffs()`, roda todo minuto) marca o registro como `expired` — a IA volta a atender normalmente essa conversa, sem ficar travada esperando
8. Toggle de liga/desliga em Configurações → Alertas → "IA pediu atendimento humano" (`store_config.handoff_alarm_default_on`), com upload de som .mp3 próprio (`store_config.handoff_alarm_sound_url`)

Requer as migrations `20260808000002_handoff_humano_ia.sql` (cria a tabela `pending_human_handoffs`, RLS, realtime, índice, coluna `handoff_alarm_default_on`, e o job de expiração) e `20260808000003_handoff_alarm_sound.sql` (coluna `handoff_alarm_sound_url`, som próprio desse alarme).

**Exemplos de quando a IA deve chamar esse handoff:** pergunta sobre ingrediente não descrito no cadastro, reclamação de pedido anterior, endereço confuso que `lookup_place_address` não identifica, erro técnico repetido (`finalize_order` falhando 2x seguidas), cliente pedindo claramente para falar com uma pessoa, tentativa de manipular a IA pra sair do script. NÃO deve disparar por: demora do cliente em responder, perguntas normais de cardápio/preço/entrega já cobertas pelo prompt, gírias/erros de digitação comuns.

### 4.6 Abrir/fechar loja manualmente (implementado 08/08/2026)
Botão em Configurações → Horário de atendimento → "Abrir/fechar loja agora" (`ManualStoreStatusCard` em `loja.config.tsx`), com **prioridade absoluta** sobre o horário automático configurado logo abaixo (`BusinessHoursCard`).

- `store_config.manual_store_status`: `NULL` = automático (segue o horário configurado, comportamento de sempre) · `'open'` = força a loja aberta agora, mesmo fora do horário · `'closed'` = força a loja fechada agora, mesmo dentro do horário
- No webhook (`webhooks.evolution.ts`), essa checagem acontece **antes** até da checagem de horário automático:
  - `manual_store_status = 'closed'` → responde sempre com a mensagem fixa **"Estamos fechados devido a problemas na nossa operação. Amanhã abriremos normalmente."** (texto fixo em código, não gerado pela IA) e não processa mais nada nesse turno
  - `manual_store_status = 'open'` → pula a checagem de horário automático inteira e segue o atendimento normal, não importa o que esteja configurado em `business_hours`
  - `NULL` → comportamento de sempre (checa `business_hours_enabled`/`business_hours`)
- Interface em 3 botões: Automático / Forçar aberta / Forçar fechada — mostra um selo "Aberta manualmente" ou "Fechada manualmente" quando não está em automático
- Campo tem "card próprio" (salvamento independente) — está na lista `CARD_OWNED_FIELDS` de `loja.config.tsx` pra não ser sobrescrito pelo botão de salvar geral da tela

Requer a migration `20260808000004_status_manual_loja.sql`.

---

## 5. REGRAS DE ENTREGA E ZONAS

### 5.1 Bairros atendidos por entregador próprio (motoboy, via WhatsApp)
Dr. Laureano, Sarapuí, Jardim Gramacho (até a estação/centro), Copacabana, Paulicéia, Vila São Luís, Itatiaia, Vila Leopoldina, Chacrinha, Corte 8.

### 5.2 Bairros NÃO atendidos pelo entregador fixo
Vila Rosário, São Bento, Centenário, 25 de Agosto, Cordovil, Vigário Geral, Vila Ideal, Covanca, Jardim Leal, Olavo Bilac, Beira Mar, Figueira, Jardim Primavera, Bom Retiro, Parque Fluminense.
→ Cliente nesses bairros é direcionado para o **iFood**, sempre citando o nome exato da loja lá: **"HotBox Delivery"**.

### 5.3 Horário e dias de entrega
Quinta, sexta, sábado e domingo, das 18h às 00h.

### 5.4 Taxas fixas especiais (locais/eventos)
R$ 6,00 para: Feirão do Lu, Feirão das Malhas, Feirão Moda Rio, Hospital Moacyr do Carmo, Chinatown, e entregas na Rod. Washington Luiz entre o nº 2400 (Parque Duque) e o nº 6732 (Jardim Gramacho).

### 5.5 Custo real de entrega
A loja paga R$ 0,90 por km rodado ao entregador. **[PLANEJADO, não implementado ainda]** sistema de taxa por faixa de km a partir da loja — precisa mapear quais ruas caem em cada faixa antes de implementar.

### 5.6 Endereço da loja
Rua Carlos Chagas, 492, Jardim Gramacho, CEP 25051-240, Duque de Caxias — **sem atendimento presencial**.

---

## 6. INTEGRAÇÕES EXTERNAS

### 6.1 iFood — ✅ Homologado 100% (60/60 cenários, 15/07/2026)
- Protocolo: **POLLING**
- App: "HotBox Delivery App" (centralizado), aguardando autorização da loja real de produção via Portal do Desenvolvedor
- 🔴 **REGRA CRÍTICA — NUNCA VIOLAR:** nunca alterar nada que possa impactar a comunicação com o iFood (envio/recebimento de dados, polling, status push, autenticação OAuth, webhooks) sem avisar o Fabio antes. Só executar mudanças nessa área com autorização explícita dele. A homologação custou muito esforço e não pode ser comprometida.

### 6.2 99Food (Open Delivery) — 🟡 em integração
- Webhook configurado (URL antiga do Lovable, **verificar se foi atualizada para o domínio Railway**): `/api/public/webhooks/nfood`
- Independente da integração com iFood

### 6.3 Stripe
- Usado para checkout seguro de pagamento por cartão no cardápio digital

### 6.4 WhatsApp — dois provedores configuráveis
| Provedor | Status atual | Observações |
|---|---|---|
| Evolution API (hospedada no Railway) | Desativado | Não oficial; risco de banimento do número; teve histórico de webhooks instáveis |
| Meta Cloud API (oficial) | **Ativo** | App publicado e verificado como MEI (CCMEI + comprovante do número). Webhook em `webhooks.meta.ts` |

---

## 7. BUGS CRÍTICOS JÁ ENCONTRADOS E CORRIGIDOS (não repetir)

1. **Self-fetch travando mensagens (07/08/2026):** `webhooks.meta.ts` fazia um `fetch()` do próprio servidor para seu próprio domínio público, para reencaminhar a mensagem recebida ao processador interno. Em hospedagem Railway, chamadas self-referenciais desse tipo travam indefinidamente sem erro nem log (o contêiner não alcança seu próprio domínio público de fora pra dentro). **Correção:** chamar `handleIncomingMessage` diretamente no mesmo processo, sem HTTP.

2. **Nome de instância com espaço quebrando URL:** instância da Evolution API chamada "HOTBAX CHAT" (com espaço) quebrava a URL no gatilho `notify_customer_order_status` e em `whatsapp-send.server.ts`, gerando erro "invalid URL / Malformed input to a URL function". **Lição:** nunca usar espaços em nomes de instância/identificadores usados em URLs.

3. **Notificação de status de pedido ignorando o provedor ativo:** o gatilho de notificação no banco mandava a mensagem sempre pela Evolution API, mesmo quando o provedor ativo era Meta. **Lição:** qualquer ponto do sistema que envia mensagem para o cliente precisa checar o campo `whatsapp_provider` antes de decidir por qual API mandar.

4. **Mensagens/respostas duplicadas em loop:** a Meta reenviava o mesmo webhook por causa da demora na resposta (efeito da humanização com delay de digitação). **Correção:** deduplicação por `message_id` na tabela `meta_processed_messages`.

5. **Tabelas criadas manualmente sem migration:** 10 tabelas e o bucket `cardapio-imagens` existiam no banco antigo (criado pelo Lovable) mas nunca foram capturadas em nenhuma migration formal. **Lição:** sempre conferir se uma tabela/bucket existente no banco tem migration correspondente — se não tiver, reconstruir a partir do schema real (`types.ts`) antes de confiar nela.

6. **Build quebrando por versão do Node:** Node 18.20.5 não suporta `util.styleText`, usado pelo vite/rolldown. **Correção:** fixar Node 22.x via `package.json engines`, `nixpacks.toml` e `.nvmrc`.

7. **Bug aberto (ainda não resolvido):** ao cadastrar a foto/selfie do entregador, o sistema não encontra a tabela correspondente — investigar schema do banco relacionado a entregadores.

---

## 8. TABELAS DO BANCO (conhecidas até o momento)

> Lista não exaustiva — sempre confirme o schema real em `types.ts` do Supabase antes de assumir que uma tabela existe ou tem certo formato.

- `whatsapp_conversations` — inclui campo `bot_paused` (controle individual por contato)
- `meta_processed_messages` — usada para deduplicação de mensagens recebidas via Meta (por `message_id`)
- `store_config` — configurações da loja, incluindo `openai_api_key`, `groq_api_key`, `ai_temperature`, `handoff_alarm_default_on`, `handoff_alarm_sound_url`, `manual_store_status`
- `ai_instructions` — instruções extras do gerente (tipo `global` ou `daily`), prioridade máxima no prompt da IA
- `pending_freight_approvals` — aprovação humana da taxa de entrega (popup de 30s antes de a IA informar o valor)
- `pending_human_handoffs` — pedidos de handoff humano feitos pela IA (popup de 2 min, ver seção 4.5)
- Tabelas de pedidos, cardápio e entregadores (nomes exatos a confirmar no schema — a tabela usada no cadastro de foto/selfie do entregador está com problema, ver bug #7)
- Bucket de storage: `cardapio-imagens`

---

## 9. FUNCIONALIDADES PENDENTES / PLANEJADAS (backlog conhecido)

- Inteligência no fluxo de retirada (diferenciar bebida vs. preparo)
- Leitura de comprovante Pix por IA
- Botão para limpar histórico (zona de perigo) e deletar item individual do histórico
- Chave Pix separada configurável no WhatsApp
- Mensagens de status de retirada diferenciadas
- Ajuste de rótulo "card" → "Cartão" no histórico
- Filtros por origem e forma de pagamento no histórico
- Opção de "combo" no cadastro de produto
- Redesign do chat com badge pulsando no menu
- Impressão automática de nota ao aceitar pedido (com aviso de autorização de impressora)
- Sistema de taxa de entrega por faixa de km (precisa mapeamento de ruas por faixa)
- Múltiplos agentes de atendimento manual no mesmo número Meta (possibilidade futura, sem plano definido)

---

## 10. INSTRUÇÕES PARA QUALQUER IA QUE FOR FAZER MANUTENÇÃO

1. **Leia este arquivo inteiro antes de mexer em qualquer coisa.**
2. **Nunca toque na integração com o iFood** sem avisar o Fabio antes e ter autorização explícita — é a regra mais crítica do projeto.
3. Antes de resolver um bug, **verifique a seção 7** — pode já ter acontecido antes.
4. Sempre que enviar mensagem ao cliente (notificação, resposta, confirmação), **cheque o campo `whatsapp_provider`** antes de decidir qual API usar (Evolution ou Meta).
5. Nunca use espaços em nomes de instância, identificadores ou variáveis que entrem em URLs.
6. Ao mexer no fluxo de atendimento da IA, lembre que o objetivo é **restringir o escopo** (cardápio, pedido, entrega) — não deixar a IA responder livremente fora disso.
7. **Ao terminar qualquer mudança relevante, atualize este MAPA-DO-SISTEMA.md** com o que mudou, na seção correspondente (nova regra de negócio → seção 5; novo bug corrigido → seção 7; nova tabela → seção 8; etc.)
8. Se encontrar uma informação neste arquivo que não bate mais com a realidade do código (rota, tabela, comportamento), **corrija o arquivo** — ele só é útil se estiver sempre atualizado.

---

## 11. MIGRATIONS PENDENTES DE RODAR NO SUPABASE

Estas migrations existem no código mas ainda **precisam ser aplicadas** no projeto Supabase novo (`hotboxdelivery`, ID `zhgeljtgwotlaudtfqoa`):
- `20260808000001_ai_temperature_e_instrucoes.sql` — coluna `ai_temperature` + 2 instruções globais (endereço da loja, Corte 8)
- `20260808000002_handoff_humano_ia.sql` — tabela `pending_human_handoffs`, coluna `handoff_alarm_default_on`, job de expiração
- `20260808000003_handoff_alarm_sound.sql` — coluna `handoff_alarm_sound_url` (som próprio do alarme de handoff)
- `20260808000004_status_manual_loja.sql` — coluna `manual_store_status` (botão de abrir/fechar loja manualmente)

Sempre que uma migration nova for criada, adicione o nome dela aqui até confirmar que já rodou em produção — e remova da lista depois de aplicada.

---

*Última atualização: 08/08/2026 — inclui controle de temperatura da IA e sistema de handoff humano.*

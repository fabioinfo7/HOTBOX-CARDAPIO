-- Controle de processamento por mensagem para o atendimento automático.
-- Permite agrupar mensagens enviadas em sequência sem repetir respostas e,
-- ao mesmo tempo, garante que mensagens que chegam enquanto a IA está pensando
-- fiquem pendentes para o turno seguinte em vez de serem perdidas.

alter table public.whatsapp_messages
  add column if not exists ai_processed_at timestamptz;

-- Tudo que já existia antes desta migration pertence a conversas históricas e
-- não deve ser reprocessado quando a atualização entrar em produção.
update public.whatsapp_messages
set ai_processed_at = coalesce(ai_processed_at, created_at)
where direction = 'in'
  and ai_processed_at is null;

create index if not exists idx_whatsapp_messages_ai_pending
  on public.whatsapp_messages (conversation_id, created_at)
  where direction = 'in' and ai_processed_at is null;

comment on column public.whatsapp_messages.ai_processed_at is
  'Momento em que a mensagem recebida foi incorporada a um turno da IA. NULL = ainda precisa ser processada.';

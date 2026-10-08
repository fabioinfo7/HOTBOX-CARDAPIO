-- HOTBOX — PRESENÇA AO VIVO NO CARDÁPIO
-- Adiciona somente campos de presença às sessões do Analytics.
-- Não apaga pedidos, clientes, financeiro ou histórico existente.

begin;

alter table public.analytics_sessions
  add column if not exists presence_last_seen_at timestamptz,
  add column if not exists current_page_path text,
  add column if not exists current_page_title text;

create index if not exists idx_analytics_sessions_presence_live
  on public.analytics_sessions (presence_last_seen_at desc)
  where presence_last_seen_at is not null;

comment on column public.analytics_sessions.presence_last_seen_at is
  'Último sinal de presença enviado por uma página pública visível.';
comment on column public.analytics_sessions.current_page_path is
  'Página pública que o visitante estava visualizando no último sinal de presença.';

commit;

notify pgrst, 'reload schema';

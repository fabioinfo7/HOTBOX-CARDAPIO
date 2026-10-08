-- HOTBOX — correção da chave de agendamento no cardápio
-- Seguro para executar mais de uma vez.

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS digital_menu_scheduling_enabled boolean NOT NULL DEFAULT false;

-- Recarrega o cache de schema do Supabase/PostgREST.
NOTIFY pgrst, 'reload schema';

-- HOTBOX — correção do erro delivery_cutoff_time em bairros_atendidos
-- Seguro para executar mais de uma vez.

ALTER TABLE public.bairros_atendidos
  ADD COLUMN IF NOT EXISTS delivery_cutoff_time time without time zone;

-- Atualiza o cache de schema do PostgREST/Supabase.
NOTIFY pgrst, 'reload schema';

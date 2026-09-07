-- Permite pedidos originados da 99Food no enum usado por orders.source.
-- Seguro para executar mais de uma vez.
DO $$
BEGIN
  ALTER TYPE public.order_source ADD VALUE IF NOT EXISTS '99food';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

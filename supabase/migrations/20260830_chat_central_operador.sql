-- Hotbox Delivery — evolução segura da Central de Chat/Pedidos
-- Não remove, renomeia ou sobrescreve dados existentes.
-- Execute antes de publicar os arquivos desta atualização.

BEGIN;

ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS assigned_operator_id uuid NULL,
  ADD COLUMN IF NOT EXISTS assigned_operator_email text NULL,
  ADD COLUMN IF NOT EXISTS assigned_operator_at timestamptz NULL;

ALTER TABLE IF EXISTS public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS assigned_operator_id uuid NULL,
  ADD COLUMN IF NOT EXISTS assigned_operator_email text NULL,
  ADD COLUMN IF NOT EXISTS assigned_operator_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_operator_id
  ON public.orders (assigned_operator_id)
  WHERE assigned_operator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_assigned_operator_id
  ON public.whatsapp_conversations (assigned_operator_id)
  WHERE assigned_operator_id IS NOT NULL;

COMMIT;

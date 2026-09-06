
-- ============ ALARME: ativado por padrão, com opção de desativar nas configurações ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS admin_alarm_default_on boolean NOT NULL DEFAULT true;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS deliverer_alarm_default_on boolean NOT NULL DEFAULT true;

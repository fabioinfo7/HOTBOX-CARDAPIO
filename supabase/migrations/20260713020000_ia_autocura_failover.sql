
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ai_last_failover_at timestamptz;

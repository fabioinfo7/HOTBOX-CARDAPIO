
-- ============ FAILOVER DE IA: memoriza qual provedor está funcionando agora ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ai_active_provider text NOT NULL DEFAULT 'lovable';

-- ============ FAILOVER DE IA: chave do Groq cadastrada pelo painel (Configurações) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS groq_api_key text;

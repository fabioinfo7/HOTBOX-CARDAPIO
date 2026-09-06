-- ============================================================
-- Meta Conversions API (CAPI) + Pixel — rastreamento de leads do WhatsApp
-- Aplique este arquivo no SQL Editor do Supabase
-- ============================================================

-- 1. Configuração do Pixel / CAPI em store_config
ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS meta_pixel_id          text,        -- Ex: "1234567890123456"
  ADD COLUMN IF NOT EXISTS meta_capi_access_token text,        -- Token de acesso do CAPI (diferente do token do WhatsApp)
  ADD COLUMN IF NOT EXISTS meta_test_event_code   text;        -- "TEST12345" — só em testes, deixe NULL em produção

-- 2. Rastreamento de origem de anúncio por conversa
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ad_source              text,        -- 'ctwa' | 'organic' | null
  ADD COLUMN IF NOT EXISTS ctwa_clid              text,        -- Click-to-WhatsApp ID vindo da Meta
  ADD COLUMN IF NOT EXISTS ad_id                  text,        -- ID do anúncio
  ADD COLUMN IF NOT EXISTS ad_title               text,        -- Título do anúncio (nome do criativo)
  ADD COLUMN IF NOT EXISTS referral_source_url    text,        -- URL de origem do clique
  ADD COLUMN IF NOT EXISTS capi_lead_sent_at      timestamptz, -- Quando o evento Lead foi enviado pro CAPI
  ADD COLUMN IF NOT EXISTS capi_purchase_sent_at  timestamptz; -- Quando o evento Purchase foi enviado pro CAPI

-- 3. Log de eventos enviados pro CAPI (auditoria)
CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,          -- 'Lead', 'Purchase', 'InitiateCheckout', etc.
  phone         text not null,
  event_time    timestamptz not null default now(),
  payload       jsonb,                  -- payload completo enviado
  response      jsonb,                  -- resposta da Meta
  success       boolean,
  created_at    timestamptz not null default now()
);

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage capi events" ON public.meta_capi_events;
CREATE POLICY "admins manage capi events" ON public.meta_capi_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

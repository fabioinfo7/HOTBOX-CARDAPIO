-- HOTBOX — status e horário público do cardápio.
-- Usa somente dados seguros; nenhuma credencial é exposta.

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS business_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS business_hours_closed_message text,
  ADD COLUMN IF NOT EXISTS manual_store_status text;

CREATE OR REPLACE FUNCTION public.get_public_store_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'manual_store_status', manual_store_status,
    'business_hours_enabled', COALESCE(business_hours_enabled, false),
    'business_hours', COALESCE(business_hours, '[]'::jsonb),
    'business_hours_closed_message', business_hours_closed_message,
    'timezone', 'America/Sao_Paulo'
  )
  FROM public.store_config
  WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_store_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store_status() TO anon, authenticated;

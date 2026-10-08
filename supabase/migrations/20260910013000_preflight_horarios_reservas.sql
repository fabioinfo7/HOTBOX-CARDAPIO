-- HOTBOX — preflight/repair de horários, cutoff e reservas.
-- Seguro para executar mais de uma vez.

ALTER TABLE public.bairros_atendidos
  ADD COLUMN IF NOT EXISTS delivery_cutoff_time time without time zone;

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS digital_menu_scheduling_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digital_menu_closed_reservations_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS business_hours_closed_message text,
  ADD COLUMN IF NOT EXISTS manual_store_status text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_for_date date,
  ADD COLUMN IF NOT EXISTS reservation_requires_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_delivery_note text,
  ADD COLUMN IF NOT EXISTS delivery_cutoff_time time without time zone;

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
    'closed_reservations_enabled', COALESCE(digital_menu_closed_reservations_enabled, true),
    'timezone', 'America/Sao_Paulo'
  )
  FROM public.store_config
  WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_store_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store_status() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

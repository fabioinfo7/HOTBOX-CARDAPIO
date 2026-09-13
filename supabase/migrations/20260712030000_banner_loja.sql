
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS banner_image_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS banner_tagline text;

DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode,
         estimated_delivery_time_minutes, banner_image_url, banner_tagline
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

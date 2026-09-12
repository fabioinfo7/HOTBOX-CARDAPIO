CREATE OR REPLACE VIEW public.store_config_public AS
  SELECT store_name,
         default_delivery_fee,
         pix_key,
         pix_copia_cola,
         pix_mode,
         estimated_delivery_time_minutes,
         banner_image_url,
         banner_tagline,
         payment_link_url,
         digital_menu_enabled
    FROM public.store_config
   WHERE id = 1;

GRANT SELECT ON public.store_config_public TO anon, authenticated;

-- ============ REMOÇÃO: integração com Banco Inter (não será mais usada) ============

DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

ALTER TABLE public.orders DROP COLUMN IF EXISTS inter_txid;

ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_enabled;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_client_id;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_client_secret;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_cert_pem;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_key_pem;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_pix_key;

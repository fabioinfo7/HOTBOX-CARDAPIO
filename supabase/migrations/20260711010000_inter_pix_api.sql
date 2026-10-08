
-- ============ BANCO INTER: credenciais da API Pix (mTLS + OAuth2) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_client_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_client_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_cert_pem text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_key_pem text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_pix_key text;

-- ============ PEDIDOS: identificador da cobrança Pix gerada no Inter (txid) ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS inter_txid text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_inter_txid ON public.orders(inter_txid) WHERE inter_txid IS NOT NULL;

-- ============ Expõe só a FLAG (nunca credenciais) na view pública, pra loja saber se deve gerar cobrança dinâmica ============
DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode, inter_enabled
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

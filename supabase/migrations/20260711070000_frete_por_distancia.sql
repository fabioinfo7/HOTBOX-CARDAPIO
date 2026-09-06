
-- ============ FRETE POR DISTÂNCIA (KM) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS delivery_pricing_mode text NOT NULL DEFAULT 'flat'; -- 'flat' | 'distance'
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_address text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_lat numeric(10,6);
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_lng numeric(10,6);
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS google_maps_api_key text;
-- faixas de km: [{ "km_from": 0, "km_to": 3, "fee": 5 }, { "km_from": 3, "km_to": 6, "fee": 8 }, ...]
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS delivery_fee_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============ RASCUNHO: guarda a estimativa calculada assim que o endereço é informado ============
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS estimated_delivery_fee numeric(10,2);
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS estimated_distance_km numeric(10,2);
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS out_of_delivery_area boolean NOT NULL DEFAULT false;

-- ============ PEDIDOS: guarda a distância calculada também, pra referência/histórico ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_distance_km numeric(10,2);

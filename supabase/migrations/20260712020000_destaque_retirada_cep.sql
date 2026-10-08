
-- ============ PRODUTOS EM DESTAQUE ============
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

-- ============ RETIRADA NO LOCAL (além de entrega) ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'delivery'; -- 'delivery' | 'pickup'
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS address_cep text;

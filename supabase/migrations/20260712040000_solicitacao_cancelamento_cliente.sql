
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_cancel_reason text;

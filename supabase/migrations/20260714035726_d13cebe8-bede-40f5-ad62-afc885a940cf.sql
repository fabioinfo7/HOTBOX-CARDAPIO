ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_number_key;
ALTER TABLE public.orders ALTER COLUMN order_number DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_internal_unique
  ON public.orders (order_number)
  WHERE order_number IS NOT NULL;

ALTER SEQUENCE public.orders_order_number_seq RESTART WITH 1;
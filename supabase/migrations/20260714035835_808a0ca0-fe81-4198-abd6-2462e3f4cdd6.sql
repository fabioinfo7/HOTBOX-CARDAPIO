ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_display_id text;

CREATE OR REPLACE FUNCTION public.assign_internal_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF NEW.source = 'ifood' THEN
    NEW.order_number := NULL;
    RETURN NEW;
  END IF;

  IF NEW.order_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  LOOP
    v_next := nextval('public.orders_order_number_seq');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.orders WHERE order_number = v_next
    );
  END LOOP;

  NEW.order_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_internal_order_number ON public.orders;
CREATE TRIGGER trg_assign_internal_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_internal_order_number();

ALTER TABLE public.orders ALTER COLUMN order_number DROP DEFAULT;
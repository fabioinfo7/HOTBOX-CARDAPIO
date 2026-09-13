-- HOTBOX — horário máximo de entrega por bairro + agendamento
-- Horários são interpretados sempre em America/Sao_Paulo (Brasília).
-- Seguro para executar mais de uma vez.

ALTER TABLE public.bairros_atendidos
  ADD COLUMN IF NOT EXISTS delivery_cutoff_time time without time zone;

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS digital_menu_scheduling_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_delivery_note text,
  ADD COLUMN IF NOT EXISTS delivery_cutoff_time time without time zone;

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_pending
  ON public.orders (created_at DESC)
  WHERE is_scheduled = true AND status = 'pending_review';

-- Quando qualquer gateway/pagamento cria o pedido operacional a partir de um
-- site_checkout_session, esta função copia a informação de agendamento.
-- Assim funciona para Mercado Pago, Appmax, InfinitePay e pagamento na entrega
-- sem precisar duplicar a lógica em cada webhook.
CREATE OR REPLACE FUNCTION public.apply_site_checkout_schedule_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_scheduled boolean;
  v_note text;
  v_cutoff time;
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_scheduled := COALESCE((NEW.order_data ->> 'is_scheduled')::boolean, false);

  IF NOT v_is_scheduled THEN
    RETURN NEW;
  END IF;

  v_note := NULLIF(NEW.order_data ->> 'scheduled_delivery_note', '');
  BEGIN
    v_cutoff := NULLIF(NEW.order_data ->> 'delivery_cutoff_time', '')::time;
  EXCEPTION WHEN others THEN
    v_cutoff := NULL;
  END;

  UPDATE public.orders
     SET is_scheduled = true,
         scheduled_at = COALESCE(scheduled_at, now()),
         scheduled_delivery_note = v_note,
         delivery_cutoff_time = v_cutoff,
         status = 'pending_review',
         notes = CASE
           WHEN v_note IS NULL THEN notes
           WHEN COALESCE(notes, '') ILIKE '%AGENDAMENTO:%' THEN notes
           WHEN COALESCE(notes, '') = '' THEN v_note
           ELSE v_note || E'\n\n' || notes
         END
   WHERE id = NEW.order_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_site_checkout_schedule_to_order
  ON public.site_checkout_sessions;

CREATE TRIGGER trg_apply_site_checkout_schedule_to_order
AFTER INSERT OR UPDATE OF order_id, order_data
ON public.site_checkout_sessions
FOR EACH ROW
WHEN (NEW.order_id IS NOT NULL)
EXECUTE FUNCTION public.apply_site_checkout_schedule_to_order();

-- Backfill defensivo para checkouts já marcados como agendamento que,
-- eventualmente, tenham criado pedido antes desta migration.
UPDATE public.orders o
   SET is_scheduled = true,
       scheduled_at = COALESCE(o.scheduled_at, s.created_at),
       scheduled_delivery_note = NULLIF(s.order_data ->> 'scheduled_delivery_note', ''),
       delivery_cutoff_time = CASE
         WHEN NULLIF(s.order_data ->> 'delivery_cutoff_time', '') IS NULL THEN o.delivery_cutoff_time
         ELSE (s.order_data ->> 'delivery_cutoff_time')::time
       END,
       status = CASE
         WHEN o.status IN ('delivered','cancelled','failed') THEN o.status
         ELSE 'pending_review'
       END
  FROM public.site_checkout_sessions s
 WHERE s.order_id = o.id
   AND COALESCE((s.order_data ->> 'is_scheduled')::boolean, false) = true
   AND o.is_scheduled = false;

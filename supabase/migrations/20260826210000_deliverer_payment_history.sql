-- Histórico de repasses do entregador por pedido.
-- Um pedido entregue só entra em "a receber" enquanto deliverer_paid_at for NULL.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deliverer_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_deliverer_unpaid
  ON public.orders (deliverer_id, delivered_at DESC)
  WHERE status = 'delivered' AND deliverer_paid_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_deliverer_paid_history
  ON public.orders (deliverer_id, deliverer_paid_at DESC)
  WHERE deliverer_paid_at IS NOT NULL;

-- Sempre que uma nova entrega for concluída, volta o indicador geral do
-- entregador para pendente. O histórico real fica nos próprios pedidos.
CREATE OR REPLACE FUNCTION public.mark_deliverer_payment_pending_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deliverer_id IS NOT NULL
     AND NEW.status = 'delivered'
     AND (OLD.status IS DISTINCT FROM 'delivered' OR OLD.deliverer_id IS DISTINCT FROM NEW.deliverer_id)
  THEN
    UPDATE public.deliverers
       SET payment_status = 'pending',
           payment_updated_at = now()
     WHERE id = NEW.deliverer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_deliverer_payment_pending ON public.orders;
CREATE TRIGGER trg_mark_deliverer_payment_pending
AFTER UPDATE OF status, deliverer_id ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.mark_deliverer_payment_pending_on_delivery();

-- Migra o estado antigo: se o cadastro do entregador já estava marcado como
-- pago, considera quitadas as entregas concluídas até a última atualização.
UPDATE public.orders o
   SET deliverer_paid_at = d.payment_updated_at
  FROM public.deliverers d
 WHERE o.deliverer_id = d.id
   AND o.status = 'delivered'
   AND o.deliverer_paid_at IS NULL
   AND d.payment_status = 'paid'
   AND d.payment_updated_at IS NOT NULL
   AND COALESCE(o.delivered_at, o.created_at) <= d.payment_updated_at;

-- O entregador pode atualizar status/aceite do próprio pedido, mas nunca
-- alterar campos financeiros nem declarar o próprio repasse como pago.
CREATE OR REPLACE FUNCTION public.protect_order_financial_fields_from_deliverer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'deliverer')
     AND NOT public.has_role(auth.uid(), 'store_admin')
     AND (
       NEW.deliverer_paid_at IS DISTINCT FROM OLD.deliverer_paid_at
       OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     )
  THEN
    RAISE EXCEPTION 'Entregador não pode alterar campos financeiros do pedido';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_order_financial_fields_from_deliverer ON public.orders;
CREATE TRIGGER trg_protect_order_financial_fields_from_deliverer
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.protect_order_financial_fields_from_deliverer();

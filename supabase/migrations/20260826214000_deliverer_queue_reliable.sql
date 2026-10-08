-- Fila confiável para o app do entregador.
-- 1) Busca via SECURITY DEFINER evita bloqueio acidental por policy antiga.
-- 2) Aceite é atômico e impede dois entregadores de pegarem o mesmo pedido.

CREATE OR REPLACE FUNCTION public.get_deliverer_queue()
RETURNS SETOF public.orders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
    FROM public.orders o
   WHERE public.has_role(auth.uid(), 'deliverer')
     AND o.status IN ('pending', 'pending_review', 'preparing', 'ready_pickup', 'out_for_delivery')
     AND (o.deliverer_id IS NULL OR o.deliverer_id = auth.uid())
   ORDER BY o.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_deliverer_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_deliverer_queue() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_delivery_order(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_vehicle text;
  v_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'deliverer') THEN
    RAISE EXCEPTION 'Acesso restrito a entregadores';
  END IF;

  SELECT full_name, vehicle
    INTO v_name, v_vehicle
    FROM public.deliverers
   WHERE id = auth.uid()
     AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entregador inativo ou não cadastrado';
  END IF;

  UPDATE public.orders
     SET deliverer_id = auth.uid(),
         deliverer_name = v_name,
         deliverer_vehicle = v_vehicle,
         accepted_by_deliverer_at = now()
   WHERE id = p_order_id
     AND deliverer_id IS NULL
     AND status IN ('pending', 'pending_review', 'preparing', 'ready_pickup');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_delivery_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_delivery_order(uuid) TO authenticated;

-- Mantém RLS coerente para Realtime e operações normais do cliente.
DROP POLICY IF EXISTS "authenticated read orders" ON public.orders;
CREATE POLICY "authenticated read orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'store_admin')
  OR (
    public.has_role(auth.uid(), 'deliverer')
    AND (
      (deliverer_id IS NULL AND status IN ('pending', 'pending_review', 'preparing', 'ready_pickup'))
      OR deliverer_id = auth.uid()
    )
  )
);

-- Garante publicação Realtime mesmo em bancos onde a migration inicial não foi aplicada integralmente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

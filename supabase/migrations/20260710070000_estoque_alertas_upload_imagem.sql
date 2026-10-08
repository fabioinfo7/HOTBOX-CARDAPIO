
-- ============ INSUMOS: controle de estoque ============
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS stock_quantity numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,3) NOT NULL DEFAULT 0;
-- stock_quantity e low_stock_threshold são sempre guardados na unidade BASE do insumo
-- (grama para insumos de peso, unidade para insumos contáveis) — mesma base do compute_recipe_cost,
-- então nunca há confusão de kg x g aqui dentro.

-- ============ DEDUÇÃO AUTOMÁTICA DE ESTOQUE QUANDO A LOJA ACEITA O PEDIDO ============
CREATE OR REPLACE FUNCTION public.deduct_stock_on_preparing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'preparing' AND (OLD.status IS DISTINCT FROM 'preparing') THEN
    UPDATE public.ingredients i
    SET stock_quantity = GREATEST(0, i.stock_quantity - deducted.qty_base)
    FROM (
      SELECT
        ri.ingredient_id,
        SUM(
          ri.quantity * CASE WHEN ri.unit = 'kg' THEN 1000 ELSE 1 END * oi.quantity
        ) AS qty_base
      FROM public.order_items oi
      JOIN public.recipe_items ri ON ri.product_id = oi.product_id
      WHERE oi.order_id = NEW.id
      GROUP BY ri.ingredient_id
    ) deducted
    WHERE i.id = deducted.ingredient_id AND i.track_stock = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deduct_stock_on_preparing ON public.orders;
CREATE TRIGGER trg_deduct_stock_on_preparing
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.deduct_stock_on_preparing();

-- ============ STORAGE: upload de imagem de produto (além da opção de colar URL) ============
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

DROP POLICY IF EXISTS "public read product images" ON storage.objects;
CREATE POLICY "public read product images" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "admins upload product images" ON storage.objects;
CREATE POLICY "admins upload product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins update product images" ON storage.objects;
CREATE POLICY "admins update product images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins delete product images" ON storage.objects;
CREATE POLICY "admins delete product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

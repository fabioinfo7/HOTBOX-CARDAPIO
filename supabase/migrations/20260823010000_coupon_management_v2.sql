-- HotBox — Cupons v2: privacidade, regras por cliente, primeira compra,
-- acúmulo com promoções, resgate atômico e histórico gerencial.

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS max_uses_per_customer integer,
  ADD COLUMN IF NOT EXISTS first_order_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_promotion_stack boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.coupons ADD CONSTRAINT coupons_max_uses_per_customer_check
    CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  order_subtotal numeric(12,2) NOT NULL DEFAULT 0,
  order_total numeric(12,2) NOT NULL DEFAULT 0,
  used_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON public.coupon_redemptions(coupon_id, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_phone ON public.coupon_redemptions(customer_phone, coupon_id);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coupon_redemptions_admin" ON public.coupon_redemptions;
CREATE POLICY "coupon_redemptions_admin" ON public.coupon_redemptions
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'store_admin'));

-- Cupons deixam de ser enumeráveis pelo público. O cardápio valida apenas por RPC.
DROP POLICY IF EXISTS "coupons_select_public" ON public.coupons;
DROP POLICY IF EXISTS "coupons_write_authenticated" ON public.coupons;
DROP POLICY IF EXISTS "coupons_admin_select" ON public.coupons;
DROP POLICY IF EXISTS "coupons_admin_write" ON public.coupons;
CREATE POLICY "coupons_admin_select" ON public.coupons
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'store_admin'));
CREATE POLICY "coupons_admin_write" ON public.coupons
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'store_admin'))
WITH CHECK (public.has_role(auth.uid(), 'store_admin'));
REVOKE SELECT ON public.coupons FROM anon;

CREATE OR REPLACE FUNCTION public._coupon_quote_internal(
  p_code text,
  p_subtotal numeric,
  p_customer_phone text,
  p_cart jsonb,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.coupons%ROWTYPE;
  v_phone text := regexp_replace(coalesce(p_customer_phone,''), '\D', '', 'g');
  v_customer_uses integer := 0;
  v_prior_orders integer := 0;
  v_base numeric := p_subtotal;
  v_discount numeric := 0;
  v_has_promo boolean := false;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE upper(code) = upper(trim(p_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','Cupom não encontrado'); END IF;
  IF NOT c.active THEN RETURN jsonb_build_object('ok',false,'reason','Cupom inativo'); END IF;
  IF c.valid_from IS NOT NULL AND p_at < c.valid_from THEN RETURN jsonb_build_object('ok',false,'reason','Cupom ainda não é válido'); END IF;
  IF c.valid_until IS NOT NULL AND p_at > c.valid_until THEN RETURN jsonb_build_object('ok',false,'reason','Cupom expirado'); END IF;
  IF c.usage_limit IS NOT NULL AND coalesce(c.usage_count,0) >= c.usage_limit THEN RETURN jsonb_build_object('ok',false,'reason','Cupom esgotado'); END IF;
  IF c.min_order_value IS NOT NULL AND p_subtotal < c.min_order_value THEN
    RETURN jsonb_build_object('ok',false,'reason',format('Pedido mínimo de R$ %s para usar este cupom', replace(to_char(c.min_order_value,'FM999990D00'),'.',',')));
  END IF;

  IF c.applicable_product_id IS NOT NULL THEN
    SELECT coalesce(sum((x->>'unit_price')::numeric * greatest((x->>'qty')::int,0)),0),
           coalesce(bool_or(coalesce((x->>'is_promotion_price')::boolean,false)),false)
      INTO v_base, v_has_promo
      FROM jsonb_array_elements(coalesce(p_cart,'[]'::jsonb)) x
     WHERE (x->>'product_id')::uuid = c.applicable_product_id;
    IF v_base <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','Cupom não é válido para os itens do seu carrinho'); END IF;
  ELSE
    SELECT coalesce(bool_or(coalesce((x->>'is_promotion_price')::boolean,false)),false)
      INTO v_has_promo FROM jsonb_array_elements(coalesce(p_cart,'[]'::jsonb)) x;
  END IF;

  IF NOT c.allow_promotion_stack AND v_has_promo THEN
    RETURN jsonb_build_object('ok',false,'reason','Este cupom não acumula com produtos em promoção');
  END IF;

  IF c.max_uses_per_customer IS NOT NULL THEN
    IF v_phone = '' THEN RETURN jsonb_build_object('ok',false,'reason','Informe seu telefone para usar este cupom'); END IF;
    SELECT count(*) INTO v_customer_uses
      FROM public.coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.customer_phone = v_phone AND r.reversed_at IS NULL;
    IF v_customer_uses >= c.max_uses_per_customer THEN
      RETURN jsonb_build_object('ok',false,'reason','Você já atingiu o limite de uso deste cupom');
    END IF;
  END IF;

  IF c.first_order_only THEN
    IF v_phone = '' THEN RETURN jsonb_build_object('ok',false,'reason','Informe seu telefone para usar este cupom de primeira compra'); END IF;
    SELECT count(*) INTO v_prior_orders FROM public.orders o
     WHERE regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = v_phone
       AND o.status <> 'cancelled';
    IF v_prior_orders > 0 THEN RETURN jsonb_build_object('ok',false,'reason','Este cupom é válido somente na primeira compra'); END IF;
  END IF;

  IF c.discount_type = 'percentage' THEN
    v_discount := round((v_base * c.discount_value / 100.0)::numeric, 2);
  ELSE
    v_discount := least(c.discount_value, v_base);
  END IF;
  v_discount := greatest(0, least(v_discount, p_subtotal));

  RETURN jsonb_build_object(
    'ok', true,
    'code', c.code,
    'discount', v_discount,
    'discount_type', c.discount_type,
    'discount_value', c.discount_value,
    'applicable_product_id', c.applicable_product_id,
    'allow_promotion_stack', c.allow_promotion_stack,
    'first_order_only', c.first_order_only,
    'max_uses_per_customer', c.max_uses_per_customer
  );
END $$;
REVOKE ALL ON FUNCTION public._coupon_quote_internal(text,numeric,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_coupon_public(
  p_code text,
  p_subtotal numeric,
  p_customer_phone text,
  p_cart jsonb
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._coupon_quote_internal(p_code,p_subtotal,p_customer_phone,p_cart,now());
$$;
GRANT EXECUTE ON FUNCTION public.validate_coupon_public(text,numeric,text,jsonb) TO anon, authenticated;

-- Cria pedido + itens + resgate do cupom na mesma transação do Postgres.
CREATE OR REPLACE FUNCTION public.create_site_order_secure(
  p_order jsonb,
  p_items jsonb,
  p_coupon_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote jsonb;
  v_discount numeric := 0;
  v_subtotal numeric := 0;
  v_delivery numeric := greatest(coalesce((p_order->>'delivery_fee')::numeric,0),0);
  v_total numeric := 0;
  v_phone text := regexp_replace(coalesce(p_order->>'customer_phone',''), '\D', '', 'g');
  v_coupon public.coupons%ROWTYPE;
  item jsonb;
BEGIN
  IF coalesce(trim(p_order->>'customer_name'),'') = '' OR v_phone = '' THEN RAISE EXCEPTION 'Nome e telefone são obrigatórios'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Carrinho vazio'; END IF;

  SELECT coalesce(sum((x->>'unit_price')::numeric * greatest((x->>'qty')::int,0)),0)
    INTO v_subtotal FROM jsonb_array_elements(p_items) x;
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'Subtotal inválido'; END IF;

  IF coalesce(trim(p_coupon_code),'') <> '' THEN
    SELECT * INTO v_coupon FROM public.coupons WHERE upper(code)=upper(trim(p_coupon_code)) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cupom não encontrado'; END IF;
    v_quote := public._coupon_quote_internal(p_coupon_code,v_subtotal,v_phone,p_items,now());
    IF NOT coalesce((v_quote->>'ok')::boolean,false) THEN RAISE EXCEPTION '%', coalesce(v_quote->>'reason','Cupom inválido'); END IF;
    v_discount := coalesce((v_quote->>'discount')::numeric,0);
  END IF;

  v_total := greatest(0,v_subtotal-v_discount)+v_delivery;

  INSERT INTO public.orders(
    source,customer_name,customer_phone,delivery_mode,address_street,address_number,address_complement,
    address_neighborhood,address_city,address_cep,payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,status
  ) VALUES (
    'site',trim(p_order->>'customer_name'),v_phone,coalesce(p_order->>'delivery_mode','delivery'),
    nullif(p_order->>'address_street',''),nullif(p_order->>'address_number',''),nullif(p_order->>'address_complement',''),
    nullif(p_order->>'address_neighborhood',''),nullif(p_order->>'address_city',''),nullif(p_order->>'address_cep',''),
    (p_order->>'payment_method')::public.payment_method,nullif(p_order->>'payment_timing',''),
    nullif(p_order->>'change_for','')::numeric,nullif(p_order->>'pix_code',''),v_subtotal,v_delivery,
    CASE WHEN v_discount > 0 THEN v_coupon.code ELSE NULL END,v_discount,v_total,'pending'
  ) RETURNING * INTO v_order;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items(order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes)
    VALUES(v_order.id,(item->>'product_id')::uuid,item->>'product_name',greatest((item->>'qty')::int,1),
      (item->>'unit_price')::numeric,nullif(item->>'list_price','')::numeric,coalesce((item->>'is_promotion_price')::boolean,false),nullif(item->>'notes',''));
  END LOOP;

  IF v_discount > 0 THEN
    UPDATE public.coupons SET usage_count=usage_count+1,updated_at=now() WHERE id=v_coupon.id;
    INSERT INTO public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total)
    VALUES(v_coupon.id,v_order.id,v_phone,v_discount,v_subtotal,v_total);
  END IF;

  RETURN jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'coupon_discount',v_discount,'total',v_total);
END $$;
GRANT EXECUTE ON FUNCTION public.create_site_order_secure(jsonb,jsonb,text) TO anon, authenticated;

-- Cancelamento devolve automaticamente o uso do cupom uma única vez.
CREATE OR REPLACE FUNCTION public.reverse_coupon_on_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_coupon_id uuid;
BEGIN
  IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.coupon_redemptions SET reversed_at=now()
      WHERE order_id=NEW.id AND reversed_at IS NULL RETURNING coupon_id INTO v_coupon_id;
    IF v_coupon_id IS NOT NULL THEN
      UPDATE public.coupons SET usage_count=greatest(usage_count-1,0),updated_at=now() WHERE id=v_coupon_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reverse_coupon_on_cancel ON public.orders;
CREATE TRIGGER trg_reverse_coupon_on_cancel AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.reverse_coupon_on_cancel();

-- Sincroniza histórico antigo (sem duplicar) para relatórios, quando possível.
INSERT INTO public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total,used_at,reversed_at)
SELECT c.id,o.id,regexp_replace(coalesce(o.customer_phone,''),'\D','','g'),coalesce(o.coupon_discount,0),coalesce(o.subtotal,0),coalesce(o.total,0),o.created_at,
       CASE WHEN o.status='cancelled' THEN o.created_at ELSE NULL END
FROM public.orders o JOIN public.coupons c ON upper(c.code)=upper(o.coupon_code)
WHERE o.coupon_code IS NOT NULL AND coalesce(o.coupon_discount,0)>0
ON CONFLICT(order_id) DO NOTHING;

-- Mantém o contador coerente com o histórico válido, inclusive dados anteriores.
UPDATE public.coupons c
SET usage_count = (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id=c.id AND r.reversed_at IS NULL),
    updated_at = now();

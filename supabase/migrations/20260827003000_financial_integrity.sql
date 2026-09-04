-- Auditoria financeira Hotbox — fonte única de cálculo e correções de integridade

-- 1) A data financeira de uma venda entregue é delivered_at.
UPDATE public.orders
SET delivered_at = created_at
WHERE status = 'delivered' AND delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON public.orders(delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_confirmed_at ON public.orders(payment_confirmed_at DESC);

-- 2) Contas a receber: o cabeçalho sempre deve ser igual à soma dos itens.
ALTER TABLE public.receivables ALTER COLUMN amount SET DEFAULT 0;
CREATE OR REPLACE FUNCTION public.recalculate_receivable_amount(p_receivable_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total numeric(12,2);
BEGIN
  SELECT COALESCE(SUM(quantity * unit_price), 0)::numeric(12,2)
  INTO v_total
  FROM public.receivable_items
  WHERE receivable_id = p_receivable_id;

  UPDATE public.receivables
  SET amount = v_total,
      updated_at = now()
  WHERE id = p_receivable_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recalculate_receivable_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM public.recalculate_receivable_amount(OLD.receivable_id);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.recalculate_receivable_amount(NEW.receivable_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_receivable_items_recalculate_amount ON public.receivable_items;
CREATE TRIGGER trg_receivable_items_recalculate_amount
AFTER INSERT OR UPDATE OR DELETE ON public.receivable_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_receivable_amount();

-- Corrige lançamentos existentes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.receivables LOOP
    PERFORM public.recalculate_receivable_amount(r.id);
  END LOOP;
END $$;

-- 3) Pedidos diretos: subtotal/total são derivados dos itens, desconto e entrega.
-- Não mexemos em iFood/99Food porque o total externo pode conter ajustes próprios da plataforma.
CREATE OR REPLACE FUNCTION public.recalculate_direct_order_totals(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.order_source;
  v_subtotal numeric(12,2);
  v_delivery numeric(12,2);
  v_discount numeric(12,2);
BEGIN
  SELECT source, COALESCE(delivery_fee,0), COALESCE(coupon_discount,0)
  INTO v_source, v_delivery, v_discount
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_source NOT IN ('site','whatsapp') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity * unit_price),0)::numeric(12,2)
  INTO v_subtotal
  FROM public.order_items
  WHERE order_id = p_order_id;

  UPDATE public.orders
  SET subtotal = v_subtotal,
      coupon_discount = LEAST(GREATEST(v_discount,0), v_subtotal),
      total = GREATEST(0, v_subtotal - LEAST(GREATEST(v_discount,0), v_subtotal)) + GREATEST(v_delivery,0)
  WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recalculate_direct_order_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM public.recalculate_direct_order_totals(OLD.order_id);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.recalculate_direct_order_totals(NEW.order_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_recalculate_order ON public.order_items;
CREATE TRIGGER trg_order_items_recalculate_order
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_direct_order_from_items();

CREATE OR REPLACE FUNCTION public.trg_recalculate_direct_order_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_subtotal numeric(12,2);
BEGIN
  IF NEW.source IN ('site','whatsapp') THEN
    SELECT COALESCE(SUM(quantity * unit_price),0)::numeric(12,2)
    INTO v_subtotal
    FROM public.order_items
    WHERE order_id = NEW.id;

    NEW.subtotal := v_subtotal;
    NEW.delivery_fee := GREATEST(COALESCE(NEW.delivery_fee,0),0);
    NEW.coupon_discount := LEAST(GREATEST(COALESCE(NEW.coupon_discount,0),0), v_subtotal);
    NEW.total := GREATEST(0, v_subtotal - NEW.coupon_discount) + NEW.delivery_fee;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_recalculate_header ON public.orders;
CREATE TRIGGER trg_orders_recalculate_header
BEFORE UPDATE OF delivery_fee, coupon_discount, subtotal, total ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_direct_order_header();

-- 4) Fluxo de caixa canônico.
-- Entradas: pedidos efetivamente pagos (exceto 'pagar depois') + contas a receber quitadas.
-- Saídas: despesas efetivamente pagas. A data usada é a data real do movimento.
CREATE OR REPLACE FUNCTION public.financial_cash_daily(p_from date, p_to date)
RETURNS TABLE(day date, inflow numeric, outflow numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH days AS (
  SELECT generate_series(p_from, p_to, interval '1 day')::date AS day
), order_cash AS (
  SELECT COALESCE(payment_confirmed_at, delivered_at, created_at)::date AS day,
         SUM(total)::numeric AS amount
  FROM public.orders
  WHERE payment_status = 'paid'
    AND status <> 'cancelled'
    AND COALESCE(payment_timing,'') <> 'later'
    AND COALESCE(payment_confirmed_at, delivered_at, created_at)::date BETWEEN p_from AND p_to
  GROUP BY 1
), receivable_cash AS (
  SELECT paid_at::date AS day, SUM(amount)::numeric AS amount
  FROM public.receivables
  WHERE status = 'paid' AND paid_at IS NOT NULL
    AND paid_at::date BETWEEN p_from AND p_to
  GROUP BY 1
), expense_cash AS (
  SELECT paid_at::date AS day, SUM(amount)::numeric AS amount
  FROM public.expenses
  WHERE is_paid = true AND paid_at IS NOT NULL
    AND paid_at::date BETWEEN p_from AND p_to
  GROUP BY 1
)
SELECT d.day,
       COALESCE(o.amount,0) + COALESCE(r.amount,0) AS inflow,
       COALESCE(e.amount,0) AS outflow
FROM days d
LEFT JOIN order_cash o USING(day)
LEFT JOIN receivable_cash r USING(day)
LEFT JOIN expense_cash e USING(day)
ORDER BY d.day;
$$;

GRANT EXECUTE ON FUNCTION public.financial_cash_daily(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_receivable_amount(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_direct_order_totals(uuid) TO authenticated;

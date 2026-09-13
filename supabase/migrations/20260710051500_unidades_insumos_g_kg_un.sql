
-- ============ INSUMOS: padroniza unidade em g / kg / un ============
-- normaliza valores antigos que não sejam g/kg/un para 'un'
UPDATE public.ingredients SET unit = 'un' WHERE unit IS NULL OR unit NOT IN ('g','kg','un');

-- ============ ITENS DE RECEITA: agora guarda em qual unidade o admin digitou a quantidade ============
ALTER TABLE public.recipe_items ADD COLUMN IF NOT EXISTS unit text;
-- backfill: assume que os itens já cadastrados foram digitados na MESMA unidade de compra do insumo
-- (mantém o cálculo antigo idêntico até o admin editar e escolher outra unidade)
UPDATE public.recipe_items ri
SET unit = i.unit
FROM public.ingredients i
WHERE ri.ingredient_id = i.id AND ri.unit IS NULL;
ALTER TABLE public.recipe_items ALTER COLUMN unit SET DEFAULT 'g';

-- ============ CÁLCULO DE CUSTO: converte tudo para a mesma base (gramas para peso, unidade para contagem) ============
CREATE OR REPLACE FUNCTION public.compute_recipe_cost(_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    -- quantidade do item convertida para grama (peso) ou mantida (unidade)
    (ri.quantity * CASE WHEN ri.unit = 'kg' THEN 1000 ELSE 1 END)
    *
    -- custo por grama (ou por unidade) do insumo, também convertido pra mesma base
    (i.purchase_price / NULLIF(i.purchase_quantity * CASE WHEN i.unit = 'kg' THEN 1000 ELSE 1 END, 0))
  ), 0)::numeric(12,2)
  FROM public.recipe_items ri
  JOIN public.ingredients i ON i.id = ri.ingredient_id
  WHERE ri.product_id = _product_id
$$;

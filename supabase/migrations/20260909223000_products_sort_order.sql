-- Ordem manual dos produtos no cardápio Hotbox.
-- Seguro para rodar mais de uma vez.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Preenche uma sequência inicial para produtos que ainda não têm posição.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY kind
      ORDER BY
        CASE WHEN active THEN 0 ELSE 1 END,
        category NULLS LAST,
        name
    ) * 10 AS new_sort_order
  FROM public.products
  WHERE sort_order IS NULL
)
UPDATE public.products p
SET sort_order = ranked.new_sort_order
FROM ranked
WHERE p.id = ranked.id
  AND p.sort_order IS NULL;

ALTER TABLE public.products
  ALTER COLUMN sort_order SET DEFAULT 999999;

CREATE INDEX IF NOT EXISTS idx_products_kind_sort_order
  ON public.products(kind, sort_order, name);

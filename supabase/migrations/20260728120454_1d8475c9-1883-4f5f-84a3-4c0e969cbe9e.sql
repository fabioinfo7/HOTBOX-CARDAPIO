CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.faixas_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL DEFAULT '',
  km_from numeric NOT NULL DEFAULT 0,
  km_to numeric NOT NULL DEFAULT 0,
  fee numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faixas_entrega TO authenticated;
GRANT SELECT ON public.faixas_entrega TO anon;
GRANT ALL ON public.faixas_entrega TO service_role;

ALTER TABLE public.faixas_entrega ENABLE ROW LEVEL SECURITY;

CREATE POLICY "faixas_entrega admin manage" ON public.faixas_entrega
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

CREATE POLICY "faixas_entrega public read" ON public.faixas_entrega
  FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER faixas_entrega_set_updated_at
  BEFORE UPDATE ON public.faixas_entrega
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.zonas_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rua text NOT NULL,
  bairro text,
  distancia_km numeric,
  faixa_id uuid REFERENCES public.faixas_entrega(id) ON DELETE SET NULL,
  lat double precision,
  lng double precision,
  entrega_disponivel boolean NOT NULL DEFAULT true,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.zonas_entrega TO authenticated;
GRANT ALL ON public.zonas_entrega TO service_role;

ALTER TABLE public.zonas_entrega ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zonas_entrega admin manage" ON public.zonas_entrega
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

CREATE INDEX zonas_entrega_rua_trgm_idx ON public.zonas_entrega USING gin (lower(rua) gin_trgm_ops);
CREATE INDEX zonas_entrega_bairro_idx ON public.zonas_entrega (lower(bairro));

CREATE TRIGGER zonas_entrega_set_updated_at
  BEFORE UPDATE ON public.zonas_entrega
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS delivery_cost_per_km numeric NOT NULL DEFAULT 0.90;

INSERT INTO public.faixas_entrega (nome, km_from, km_to, fee, ativo)
SELECT
  'Faixa ' || (t->>'km_from') || '-' || (t->>'km_to') || ' km',
  (t->>'km_from')::numeric,
  (t->>'km_to')::numeric,
  (t->>'fee')::numeric,
  true
FROM public.store_config sc,
     LATERAL jsonb_array_elements(sc.delivery_fee_tiers) AS t
WHERE sc.id = 1
  AND jsonb_typeof(sc.delivery_fee_tiers) = 'array';
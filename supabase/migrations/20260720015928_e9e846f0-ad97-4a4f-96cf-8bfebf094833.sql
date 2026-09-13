
CREATE TABLE public.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  purchase_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  due_date date,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivables TO authenticated;
GRANT ALL ON public.receivables TO service_role;

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage receivables"
  ON public.receivables FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

CREATE TRIGGER trg_receivables_updated_at
  BEFORE UPDATE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_receivables_status ON public.receivables(status, due_date);

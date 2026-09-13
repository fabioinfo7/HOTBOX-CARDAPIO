CREATE TABLE public.pending_freight_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  phone text NOT NULL,
  customer_name text,
  address text NOT NULL,
  fee numeric(10,2) NOT NULL DEFAULT 0,
  distance_km numeric(10,2),
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_freight_approvals TO authenticated;
GRANT ALL ON public.pending_freight_approvals TO service_role;

ALTER TABLE public.pending_freight_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage freight approvals"
ON public.pending_freight_approvals
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'store_admin'))
WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

CREATE TRIGGER set_freight_approvals_updated_at
BEFORE UPDATE ON public.pending_freight_approvals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_freight_approvals_pending ON public.pending_freight_approvals (status, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_freight_approvals;

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS payment_link_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS digital_menu_enabled boolean NOT NULL DEFAULT true;
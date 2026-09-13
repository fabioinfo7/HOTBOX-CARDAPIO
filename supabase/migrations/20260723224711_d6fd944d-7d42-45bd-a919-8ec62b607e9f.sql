
CREATE TABLE public.quick_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage quick replies"
  ON public.quick_replies
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

CREATE TRIGGER quick_replies_set_updated_at
  BEFORE UPDATE ON public.quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

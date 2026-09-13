
CREATE TABLE IF NOT EXISTS public.api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  direction text NOT NULL DEFAULT 'in',
  request_payload jsonb,
  response_status int,
  response_body text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_created ON public.api_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_source_created ON public.api_logs (source, created_at DESC);

GRANT SELECT ON public.api_logs TO authenticated;
GRANT ALL ON public.api_logs TO service_role;

ALTER TABLE public.api_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read api logs" ON public.api_logs;
CREATE POLICY "admins read api logs" ON public.api_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'));

CREATE OR REPLACE FUNCTION public.cleanup_old_api_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.api_logs WHERE created_at < now() - interval '14 days';
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-api-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('cleanup-api-logs', '0 4 * * *', $$SELECT public.cleanup_old_api_logs()$$);

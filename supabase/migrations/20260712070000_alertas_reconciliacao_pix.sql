
ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS admin_alert_email text,
  ADD COLUMN IF NOT EXISTS admin_alert_phone text,
  ADD COLUMN IF NOT EXISTS pix_auto_cancel_minutes integer NOT NULL DEFAULT 15;

CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  context jsonb,
  notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_unnotified ON public.system_alerts (created_at DESC) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_system_alerts_kind_created ON public.system_alerts (kind, created_at DESC);

GRANT SELECT, UPDATE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read alerts" ON public.system_alerts;
CREATE POLICY "admins read alerts" ON public.system_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins update alerts" ON public.system_alerts;
CREATE POLICY "admins update alerts" ON public.system_alerts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

-- Insere um alerta apenas se não houver alerta similar recente (dedup por kind + 5min)
CREATE OR REPLACE FUNCTION public.record_system_alert(_kind text, _message text, _context jsonb DEFAULT NULL, _severity text DEFAULT 'error')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _existing uuid; _new uuid;
BEGIN
  SELECT id INTO _existing FROM public.system_alerts
    WHERE kind = _kind AND created_at > now() - interval '5 minutes' AND resolved_at IS NULL
    ORDER BY created_at DESC LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;
  INSERT INTO public.system_alerts(kind, severity, message, context)
    VALUES (_kind, _severity, _message, _context)
    RETURNING id INTO _new;
  RETURN _new;
END;
$$;

-- Cancela pedidos Pix "now" não pagos após N minutos (config)
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_pix()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _minutes integer; _count integer;
BEGIN
  SELECT COALESCE(pix_auto_cancel_minutes, 15) INTO _minutes FROM public.store_config WHERE id = 1;
  IF _minutes IS NULL OR _minutes <= 0 THEN RETURN 0; END IF;

  WITH cancelled AS (
    UPDATE public.orders SET
      status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = COALESCE(cancel_reason, format('Cancelado automaticamente: Pix não pago em %s min', _minutes))
    WHERE status IN ('pending', 'pending_review')
      AND payment_method = 'pix'
      AND payment_timing = 'now'
      AND payment_status <> 'paid'
      AND created_at < now() - (_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO _count FROM cancelled;

  IF _count > 0 THEN
    PERFORM public.record_system_alert(
      'pix_auto_cancel',
      format('%s pedido(s) Pix cancelado(s) automaticamente por falta de pagamento em %s minutos', _count, _minutes),
      jsonb_build_object('count', _count, 'minutes', _minutes),
      'info'
    );
  END IF;
  RETURN _count;
END;
$$;

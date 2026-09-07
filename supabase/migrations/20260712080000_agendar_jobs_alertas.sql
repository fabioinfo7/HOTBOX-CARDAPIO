
-- ============ EXTENSÕES (idempotente, provavelmente já habilitadas) ============
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============ JOB 1: cancela pedidos Pix "pagar agora" não pagos, a cada minuto ============
DO $$
BEGIN
  PERFORM cron.unschedule('auto-cancel-stale-pix');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-cancel-stale-pix',
  '* * * * *',
  $$SELECT public.auto_cancel_stale_pix()$$
);

-- ============ JOB 2: notifica alertas pendentes por WhatsApp, a cada 5 minutos ============
CREATE OR REPLACE FUNCTION public.reschedule_system_alerts_job()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_url text;
BEGIN
  SELECT app_public_url INTO v_url FROM public.store_config LIMIT 1;

  BEGIN
    PERFORM cron.unschedule('system-alerts-notify');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF v_url IS NOT NULL AND v_url <> '' THEN
    PERFORM cron.schedule(
      'system-alerts-notify',
      '*/5 * * * *',
      format(
        $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb)$cmd$,
        rtrim(v_url, '/') || '/api/public/hooks/system-alerts',
        '{"Content-Type":"application/json"}'
      )
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_system_alerts_job() TO authenticated;

SELECT public.reschedule_system_alerts_job();

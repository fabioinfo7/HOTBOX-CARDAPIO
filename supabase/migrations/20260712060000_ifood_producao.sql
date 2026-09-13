
-- ============ IFOOD: mapeamento de cardápio (item da iFood -> produto local) ============
CREATE TABLE IF NOT EXISTS public.ifood_product_map (
  ifood_item_id text PRIMARY KEY,
  ifood_item_name text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ifood_product_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage ifood map" ON public.ifood_product_map;
CREATE POLICY "admins manage ifood map" ON public.ifood_product_map FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

-- ============ IFOOD: cache do token OAuth ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_access_token text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_token_expires_at timestamptz;

-- ============ IFOOD: token pra proteger a rota de polling ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_polling_token text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_polling_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_last_poll_at timestamptz;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_last_poll_error text;

-- ============ IFOOD: a loja mesma entrega, ou usa entregador da própria iFood? ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_own_delivery boolean NOT NULL DEFAULT true;

-- ============ URL pública do site (usada pelos triggers do banco pra chamar de volta o sistema) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS app_public_url text;

-- ============ PEDIDOS: guarda se o status já foi empurrado pra iFood ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ifood_last_pushed_status text;

-- ============ TRIGGER: sempre que o status de um pedido da iFood mudar, avisa a iFood ============
CREATE OR REPLACE FUNCTION public.push_ifood_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_url text;
BEGIN
  IF NEW.source = 'ifood' AND NEW.external_id IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text IS DISTINCT FROM NEW.ifood_last_pushed_status THEN

    SELECT app_public_url INTO v_app_url FROM public.store_config LIMIT 1;
    IF v_app_url IS NULL OR v_app_url = '' THEN
      RETURN NEW; -- URL pública ainda não configurada em /loja/config — nada a fazer
    END IF;

    PERFORM net.http_post(
      url := rtrim(v_app_url, '/') || '/api/public/webhooks/ifood-status-push',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('order_id', NEW.id, 'new_status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_ifood_status_change ON public.orders;
CREATE TRIGGER trg_push_ifood_status_change
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.push_ifood_status_change();

-- ============ PG_CRON: extensão necessária pro polling automático ============
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============ FUNÇÃO: (re)agenda o polling da iFood a cada 30s, chamada depois de salvar as configs ============
CREATE OR REPLACE FUNCTION public.reschedule_ifood_polling()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_token text; v_enabled boolean;
BEGIN
  SELECT app_public_url, ifood_polling_token, ifood_polling_enabled
    INTO v_url, v_token, v_enabled
    FROM public.store_config LIMIT 1;

  BEGIN
    PERFORM cron.unschedule('ifood-polling');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF v_enabled AND v_url IS NOT NULL AND v_url <> '' AND v_token IS NOT NULL AND v_token <> '' THEN
    PERFORM cron.schedule(
      'ifood-polling',
      '* * * * *', -- todo minuto (o mínimo garantido em qualquer versão do pg_cron)
      format(
        $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb)$cmd$,
        rtrim(v_url, '/') || '/api/public/webhooks/ifood-poll?token=' || v_token,
        '{"Content-Type":"application/json"}'
      )
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_ifood_polling() TO authenticated;

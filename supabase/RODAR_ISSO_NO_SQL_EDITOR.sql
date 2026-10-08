-- ============================================================
-- SCRIPT ÚNICO DE ATUALIZAÇÃO — HotBox Delivery
-- Cole isto inteiro no SQL Editor do backend (Lovable Cloud / Supabase
-- Studio) e clique em Run. É seguro rodar mais de uma vez.
-- ============================================================

-- ============ ENTREGADOR: selfie obrigatória + inativo por padrão ============
ALTER TABLE public.deliverers ADD COLUMN IF NOT EXISTS selfie_url text;
ALTER TABLE public.deliverers ALTER COLUMN active SET DEFAULT false;

-- ============ PEDIDOS: veículo de quem aceitou + campos de cancelamento/pagamento/iFood ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deliverer_vehicle text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS accepted_by_deliverer_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_receipt_url text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_confirmed_by text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external_id ON public.orders(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_created_status ON public.orders(created_at DESC, status);

-- ============ CONFIG: som de alarme do entregador + credenciais iFood ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS deliverer_alarm_sound_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_client_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_client_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_merchant_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ifood_webhook_secret text;

-- ============ IFOOD: nova origem de pedido ============
DO $$
BEGIN
  ALTER TYPE public.order_source ADD VALUE IF NOT EXISTS 'ifood';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============ INSUMOS: padroniza unidade em g / kg / un ============
UPDATE public.ingredients SET unit = 'un' WHERE unit IS NULL OR unit NOT IN ('g','kg','un');

ALTER TABLE public.recipe_items ADD COLUMN IF NOT EXISTS unit text;
UPDATE public.recipe_items ri
SET unit = i.unit
FROM public.ingredients i
WHERE ri.ingredient_id = i.id AND ri.unit IS NULL;
ALTER TABLE public.recipe_items ALTER COLUMN unit SET DEFAULT 'g';

-- ============ FUNÇÃO: cadastro de entregador agora exige selfie e sempre entra inativo ============
DROP FUNCTION IF EXISTS public.register_deliverer(text, text, text);
CREATE OR REPLACE FUNCTION public.register_deliverer(_full_name text, _phone text, _vehicle text, _selfie_url text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _uid uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'not authenticated'; end if;
  if _selfie_url is null or _selfie_url = '' then
    raise exception 'Selfie é obrigatória para concluir o cadastro';
  end if;
  insert into public.deliverers(id, full_name, phone, vehicle, selfie_url, active)
    values (_uid, _full_name, _phone, _vehicle, _selfie_url, false)
    on conflict (id) do update set
      full_name = excluded.full_name,
      phone = excluded.phone,
      vehicle = excluded.vehicle,
      selfie_url = excluded.selfie_url;
  insert into public.user_roles(user_id, role)
    values (_uid, 'deliverer')
    on conflict do nothing;
  return true;
end;
$$;
REVOKE ALL ON FUNCTION public.register_deliverer(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_deliverer(text, text, text, text) TO authenticated;

-- ============ FUNÇÃO: login imediato após cadastro (confirma e-mail automaticamente) ============
CREATE OR REPLACE FUNCTION public.auto_confirm_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_confirm_email ON auth.users;
CREATE TRIGGER trg_auto_confirm_email
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_email();

-- ============ FUNÇÃO: cálculo de custo com conversão g/kg/un ============
CREATE OR REPLACE FUNCTION public.compute_recipe_cost(_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    (ri.quantity * CASE WHEN ri.unit = 'kg' THEN 1000 ELSE 1 END)
    *
    (i.purchase_price / NULLIF(i.purchase_quantity * CASE WHEN i.unit = 'kg' THEN 1000 ELSE 1 END, 0))
  ), 0)::numeric(12,2)
  FROM public.recipe_items ri
  JOIN public.ingredients i ON i.id = ri.ingredient_id
  WHERE ri.product_id = _product_id
$$;

-- ============ VIEW: dados públicos e seguros da loja (taxa de entrega + pix) pro cliente ============
DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

-- ============ STORAGE: buckets (selfie, alarme, comprovante pix) ============
insert into storage.buckets (id, name, public)
values ('deliverer-selfies', 'deliverer-selfies', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('alarm-sounds', 'alarm-sounds', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', true)
on conflict (id) do nothing;

-- ============ STORAGE: políticas de acesso (idempotentes) ============
DROP POLICY IF EXISTS "public read selfies" ON storage.objects;
CREATE POLICY "public read selfies" ON storage.objects FOR SELECT
  USING (bucket_id = 'deliverer-selfies');

DROP POLICY IF EXISTS "auth upload own selfie" ON storage.objects;
CREATE POLICY "auth upload own selfie" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deliverer-selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "public read alarms" ON storage.objects;
CREATE POLICY "public read alarms" ON storage.objects FOR SELECT
  USING (bucket_id = 'alarm-sounds');

DROP POLICY IF EXISTS "admins upload alarms" ON storage.objects;
CREATE POLICY "admins upload alarms" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'alarm-sounds' AND public.has_role(auth.uid(),'store_admin'));

DROP POLICY IF EXISTS "admins update alarms" ON storage.objects;
CREATE POLICY "admins update alarms" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'alarm-sounds' AND public.has_role(auth.uid(),'store_admin'));

DROP POLICY IF EXISTS "admins delete alarms" ON storage.objects;
CREATE POLICY "admins delete alarms" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'alarm-sounds' AND public.has_role(auth.uid(),'store_admin'));

DROP POLICY IF EXISTS "public read receipts" ON storage.objects;
CREATE POLICY "public read receipts" ON storage.objects FOR SELECT
  USING (bucket_id = 'payment-receipts');

-- (proposital: sem policy de insert pra "authenticated" no payment-receipts —
-- só o servidor, com service role, deve gravar comprovante ali)
DROP POLICY IF EXISTS "service upload receipts" ON storage.objects;

-- ============ SEGURANÇA: leads e configuração só para admin ============
DROP POLICY IF EXISTS "admins manage leads" ON public.leads;
CREATE POLICY "admins manage leads" ON public.leads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins read config" ON public.store_config;
CREATE POLICY "admins read config" ON public.store_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'));

-- ============ ESTOQUE: controle e alerta configurável por insumo ============
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS stock_quantity numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,3) NOT NULL DEFAULT 0;

-- ============ ESTOQUE: dedução automática quando a loja aceita o pedido ============
CREATE OR REPLACE FUNCTION public.deduct_stock_on_preparing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'preparing' AND (OLD.status IS DISTINCT FROM 'preparing') THEN
    UPDATE public.ingredients i
    SET stock_quantity = GREATEST(0, i.stock_quantity - deducted.qty_base)
    FROM (
      SELECT
        ri.ingredient_id,
        SUM(ri.quantity * CASE WHEN ri.unit = 'kg' THEN 1000 ELSE 1 END * oi.quantity) AS qty_base
      FROM public.order_items oi
      JOIN public.recipe_items ri ON ri.product_id = oi.product_id
      WHERE oi.order_id = NEW.id
      GROUP BY ri.ingredient_id
    ) deducted
    WHERE i.id = deducted.ingredient_id AND i.track_stock = true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_deduct_stock_on_preparing ON public.orders;
CREATE TRIGGER trg_deduct_stock_on_preparing
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.deduct_stock_on_preparing();

-- ============ STORAGE: upload de imagem de produto ============
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

DROP POLICY IF EXISTS "public read product images" ON storage.objects;
CREATE POLICY "public read product images" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "admins upload product images" ON storage.objects;
CREATE POLICY "admins upload product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins update product images" ON storage.objects;
CREATE POLICY "admins update product images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins delete product images" ON storage.objects;
CREATE POLICY "admins delete product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'store_admin'));

-- ============ FIM — se rodou sem erro, está tudo atualizado ============

-- ============ BANCO INTER: credenciais da API Pix (mTLS + OAuth2) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_client_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_client_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_cert_pem text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_key_pem text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS inter_pix_key text;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS inter_txid text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_inter_txid ON public.orders(inter_txid) WHERE inter_txid IS NOT NULL;

DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode, inter_enabled
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

-- ============ FIM (v2) — se rodou sem erro, está tudo atualizado ============

-- ============ NOTIFICAÇÃO AUTOMÁTICA AO CLIENTE QUANDO O STATUS MUDA ============
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token
      INTO v_url, v_instance, v_token
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    msg := CASE NEW.status
      WHEN 'preparing' THEN format('👨‍🍳 Seu pedido #%s entrou em preparação!', NEW.order_number)
      WHEN 'ready_pickup' THEN format('📦 Seu pedido #%s está pronto, aguardando o entregador!', NEW.order_number)
      WHEN 'out_for_delivery' THEN format('🛵 Seu pedido #%s saiu para entrega! Já já chega até você.', NEW.order_number)
      WHEN 'delivered' THEN format('✅ Pedido #%s entregue! Bom apetite 😋', NEW.order_number)
      WHEN 'cancelled' THEN format('❌ Seu pedido #%s foi cancelado.%s', NEW.order_number,
        CASE WHEN NEW.cancel_reason IS NOT NULL THEN ' Motivo: ' || NEW.cancel_reason ELSE '' END)
      WHEN 'failed' THEN format('⚠️ Tivemos um problema para entregar seu pedido #%s. Nossa equipe vai entrar em contato.', NEW.order_number)
      ELSE NULL
    END;

    IF msg IS NULL THEN RETURN NEW; END IF;

    full_url := rtrim(v_url, '/') || '/message/sendText/' || v_instance;

    PERFORM net.http_post(
      url := full_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_token),
      body := jsonb_build_object('number', NEW.customer_phone, 'text', msg)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_order_status ON public.orders;
CREATE TRIGGER trg_notify_customer_order_status
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_customer_order_status();

-- ============ FIM (v3) — se rodou sem erro, está tudo atualizado ============

-- ============ REMOÇÃO: integração com Banco Inter (não será mais usada) ============
DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

ALTER TABLE public.orders DROP COLUMN IF EXISTS inter_txid;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_enabled;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_client_id;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_client_secret;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_cert_pem;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_key_pem;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS inter_pix_key;

-- ============ CHAT + ATENDIMENTO POR IA ============
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  customer_name text,
  bot_paused boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  unread_count int not null default 0,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender_type text not null check (sender_type in ('customer','bot','admin')),
  body text,
  media_url text,
  media_type text check (media_type in ('image','audio','video','document')),
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv ON public.whatsapp_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.order_drafts (
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  customer_name text,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_reference text,
  items jsonb not null default '[]'::jsonb,
  payment_method text check (payment_method in ('pix','card','cash')),
  payment_timing text check (payment_timing in ('now','delivery')),
  change_for numeric(10,2),
  notes text,
  stage text not null default 'greeting',
  updated_at timestamptz not null default now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS change_for numeric(10,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_timing text;

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage conversations" ON public.whatsapp_conversations;
CREATE POLICY "admins manage conversations" ON public.whatsapp_conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins manage messages" ON public.whatsapp_messages;
CREATE POLICY "admins manage messages" ON public.whatsapp_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

DROP POLICY IF EXISTS "admins manage drafts" ON public.order_drafts;
CREATE POLICY "admins manage drafts" ON public.order_drafts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'store_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'store_admin'));

ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

DROP POLICY IF EXISTS "public read chat media" ON storage.objects;
CREATE POLICY "public read chat media" ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media');

DROP POLICY IF EXISTS "admins upload chat media" ON storage.objects;
CREATE POLICY "admins upload chat media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND public.has_role(auth.uid(), 'store_admin'));

-- ============ FIM (v4) — se rodou sem erro, está tudo atualizado ============

-- ============ FAILOVER DE IA: memoriza qual provedor está funcionando agora ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ai_active_provider text NOT NULL DEFAULT 'lovable';

-- ============ FAILOVER DE IA: chave do Groq cadastrada pelo painel (Configurações) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS groq_api_key text;

-- ============ FIM (v5) — se rodou sem erro, está tudo atualizado ============

-- ============ CORREÇÃO CRÍTICA: estoque precisa ser opt-in ============
-- Sem isso, todo insumo nascia "rastreado com estoque zero", fazendo a IA
-- (e o painel) acharem que está tudo em falta.
UPDATE public.ingredients SET track_stock = false WHERE track_stock = true;
ALTER TABLE public.ingredients ALTER COLUMN track_stock SET DEFAULT false;

-- ============ FIM (v6) — se rodou sem erro, está tudo atualizado ============

-- ============ FRETE POR DISTÂNCIA (KM) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS delivery_pricing_mode text NOT NULL DEFAULT 'flat';
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_address text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_lat numeric(10,6);
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_lng numeric(10,6);
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS google_maps_api_key text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS delivery_fee_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS estimated_delivery_fee numeric(10,2);
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS estimated_distance_km numeric(10,2);
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS out_of_delivery_area boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_distance_km numeric(10,2);

-- ============ FIM (v7) — se rodou sem erro, está tudo atualizado ============

-- ============ TEMPO ESTIMADO DE ENTREGA (a IA informa aos clientes) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS estimated_delivery_time_minutes int;

-- ============ FIM (v8) — se rodou sem erro, está tudo atualizado ============

-- ============ PRODUTOS EM DESTAQUE + RETIRADA NO LOCAL + CEP ============
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'delivery';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS address_cep text;

-- ============ FIM (v9) — se rodou sem erro, está tudo atualizado ============

-- ============ BANNER CUSTOMIZÁVEL DA LOJA ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS banner_image_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS banner_tagline text;

DROP VIEW IF EXISTS public.store_config_public;
CREATE VIEW public.store_config_public AS
  SELECT store_name, default_delivery_fee, pix_key, pix_copia_cola, pix_mode,
         estimated_delivery_time_minutes, banner_image_url, banner_tagline
  FROM public.store_config
  WHERE id = 1;
GRANT SELECT ON public.store_config_public TO anon, authenticated;

-- ============ FIM (v10) — se rodou sem erro, está tudo atualizado ============

-- ============ CORREÇÃO CRÍTICA: 'cash' nunca foi valor válido do enum payment_method ============
DO $$
BEGIN
  ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'cash';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============ SOLICITAÇÃO DE CANCELAMENTO PELO CLIENTE (via IA) ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_cancel_reason text;

-- ============ FIM (v11) — se rodou sem erro, está tudo atualizado ============

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

-- ============ FIM (v12) — se rodou sem erro, está tudo atualizado ============

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

-- ============ FIM (v13) — se rodou sem erro, está tudo atualizado ============

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fixed_delivery_city text;
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS delivery_mode text CHECK (delivery_mode IN ('delivery','pickup'));

-- ============ Mensagem específica de "pronto pra retirar" quando for retirada no local ============
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token
      INTO v_url, v_instance, v_token
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    msg := CASE
      WHEN NEW.status = 'preparing' THEN format('👨‍🍳 Seu pedido #%s entrou em preparação!', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' AND NEW.delivery_mode = 'pickup' THEN
        format('📦 Seu pedido #%s está pronto! Pode vir buscar na loja quando quiser. 😊', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' THEN format('📦 Seu pedido #%s está pronto, aguardando o entregador!', NEW.order_number)
      WHEN NEW.status = 'out_for_delivery' THEN format('🛵 Seu pedido #%s saiu para entrega! Já já chega até você.', NEW.order_number)
      WHEN NEW.status = 'delivered' AND NEW.delivery_mode = 'pickup' THEN format('✅ Pedido #%s retirado! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'delivered' THEN format('✅ Pedido #%s entregue! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'cancelled' THEN format('❌ Seu pedido #%s foi cancelado.%s', NEW.order_number,
        CASE WHEN NEW.cancel_reason IS NOT NULL THEN ' Motivo: ' || NEW.cancel_reason ELSE '' END)
      WHEN NEW.status = 'failed' THEN format('⚠️ Tivemos um problema com seu pedido #%s. Nossa equipe vai entrar em contato.', NEW.order_number)
      ELSE NULL
    END;

    IF msg IS NULL THEN RETURN NEW; END IF;

    full_url := rtrim(v_url, '/') || '/message/sendText/' || v_instance;

    PERFORM net.http_post(
      url := full_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_token),
      body := jsonb_build_object('number', NEW.customer_phone, 'text', msg)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============ FIM (v14) — se rodou sem erro, está tudo atualizado ============

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fixed_delivery_city text;
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS delivery_mode text CHECK (delivery_mode IN ('delivery','pickup'));

-- ============ Mensagem específica de "pronto pra retirar" quando for retirada no local ============
CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token
      INTO v_url, v_instance, v_token
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    msg := CASE
      WHEN NEW.status = 'preparing' THEN format('👨‍🍳 Seu pedido #%s entrou em preparação!', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' AND NEW.delivery_mode = 'pickup' THEN
        format('📦 Seu pedido #%s está pronto! Pode vir buscar na loja quando quiser. 😊', NEW.order_number)
      WHEN NEW.status = 'ready_pickup' THEN format('📦 Seu pedido #%s está pronto, aguardando o entregador!', NEW.order_number)
      WHEN NEW.status = 'out_for_delivery' THEN format('🛵 Seu pedido #%s saiu para entrega! Já já chega até você.', NEW.order_number)
      WHEN NEW.status = 'delivered' AND NEW.delivery_mode = 'pickup' THEN format('✅ Pedido #%s retirado! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'delivered' THEN format('✅ Pedido #%s entregue! Bom apetite 😋', NEW.order_number)
      WHEN NEW.status = 'cancelled' THEN format('❌ Seu pedido #%s foi cancelado.%s', NEW.order_number,
        CASE WHEN NEW.cancel_reason IS NOT NULL THEN ' Motivo: ' || NEW.cancel_reason ELSE '' END)
      WHEN NEW.status = 'failed' THEN format('⚠️ Tivemos um problema com seu pedido #%s. Nossa equipe vai entrar em contato.', NEW.order_number)
      ELSE NULL
    END;

    IF msg IS NULL THEN RETURN NEW; END IF;

    full_url := rtrim(v_url, '/') || '/message/sendText/' || v_instance;

    PERFORM net.http_post(
      url := full_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_token),
      body := jsonb_build_object('number', NEW.customer_phone, 'text', msg)
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ai_last_failover_at timestamptz;

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

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ifood_billing_address jsonb;

CREATE OR REPLACE FUNCTION public.notify_customer_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text; v_instance text; v_token text; v_store_name text;
  v_greeting text; v_body text; v_emoji text; v_order_fmt text; v_footer text;
  msg text; full_url text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.customer_phone IS NOT NULL THEN
    SELECT evolution_api_url, evolution_instance, evolution_api_token, store_name
      INTO v_url, v_instance, v_token, v_store_name
      FROM public.store_config LIMIT 1;

    IF v_url IS NULL OR v_instance IS NULL OR v_token IS NULL THEN
      RETURN NEW;
    END IF;

    v_greeting := 'Oi' || CASE WHEN NEW.customer_name IS NOT NULL AND NEW.customer_name <> '' THEN ', ' || split_part(NEW.customer_name, ' ', 1) ELSE '' END || '!';
    v_order_fmt := '#' || lpad(NEW.order_number::text, 7, '0');
    v_footer := 'Qualquer dúvida, é só chamar por aqui 💬';

    CASE
      WHEN NEW.status = 'preparing' THEN
        v_emoji := '👨‍🍳'; v_body := 'Seu pedido já entrou em preparação — já já fica pronto!';
      WHEN NEW.status = 'ready_pickup' AND NEW.delivery_mode = 'pickup' THEN
        v_emoji := '📦'; v_body := 'Seu pedido está pronto! Pode vir buscar na loja quando quiser.';
      WHEN NEW.status = 'ready_pickup' THEN
        v_emoji := '📦'; v_body := 'Seu pedido está pronto, aguardando o entregador sair com ele.';
      WHEN NEW.status = 'out_for_delivery' THEN
        v_emoji := '🛵'; v_body := 'Seu pedido saiu para entrega! Já já chega até você.';
      WHEN NEW.status = 'delivered' AND NEW.delivery_mode = 'pickup' THEN
        v_emoji := '✅'; v_body := 'Pedido retirado! Bom apetite 😋';
      WHEN NEW.status = 'delivered' THEN
        v_emoji := '✅'; v_body := 'Pedido entregue! Bom apetite 😋';
      WHEN NEW.status = 'cancelled' THEN
        v_emoji := '❌';
        v_body := 'Seu pedido foi cancelado.' || CASE WHEN NEW.cancel_reason IS NOT NULL THEN E'\nMotivo: ' || NEW.cancel_reason ELSE '' END;
      WHEN NEW.status = 'failed' THEN
        v_emoji := '⚠️'; v_body := 'Tivemos um problema pra concluir a entrega do seu pedido. Nossa equipe já vai entrar em contato.';
      ELSE
        RETURN NEW;
    END CASE;

    msg := v_emoji || ' *' || COALESCE(v_store_name, 'Sua loja') || '*' || E'\n'
        || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n\n'
        || v_greeting || E'\n\n'
        || v_body || E'\n\n'
        || 'Pedido *' || v_order_fmt || '*' || E'\n'
        || '▬▬▬▬▬▬▬▬▬▬▬▬' || E'\n'
        || '_' || v_footer || '_';

    full_url := rtrim(v_url, '/') || '/message/sendText/' || v_instance;

    PERFORM net.http_post(
      url := full_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_token),
      body := jsonb_build_object('number', NEW.customer_phone, 'text', msg)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============ FIM (v15) — se rodou sem erro, está tudo atualizado ============

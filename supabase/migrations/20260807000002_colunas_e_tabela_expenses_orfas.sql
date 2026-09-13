-- ============================================================
-- AUDITORIA COMPLETA — colunas e tabela "expenses" que existiam no
-- banco antigo (Lovable) mas nunca foram capturadas em nenhuma
-- migration (adicionadas manualmente pelo Table Editor ao longo do
-- tempo). Encontradas comparando o schema real (types.ts) contra o
-- que está em todas as migrations.
--
-- Todos os comandos usam IF NOT EXISTS — seguro rodar mesmo que
-- alguma dessas colunas já exista por outro caminho.
-- ============================================================

-- ============ EXPENSES (despesas — tela Financeiro) ============
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null,
  amount numeric not null default 0,
  due_date date not null,
  is_paid boolean not null default false,
  paid_at timestamptz,
  recurrence text not null default 'none',
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.expenses to authenticated;
grant all on public.expenses to service_role;
alter table public.expenses enable row level security;
drop policy if exists "admins manage expenses" on public.expenses;
create policy "admins manage expenses" on public.expenses for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ STORE_CONFIG (34 colunas faltando) ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS admin_alert_email text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS admin_alert_phone text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ai_active_groq_slot integer NOT NULL DEFAULT 1;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS auto_print_on_accept boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS bot_global_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS business_hours_closed_message text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS business_hours_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS chat_wallpaper text NOT NULL DEFAULT 'default';
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS combustivel_preco_litro numeric;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS evolution_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fee_pct_99food numeric NOT NULL DEFAULT 0;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fee_pct_ifood numeric NOT NULL DEFAULT 0;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fee_pct_site numeric NOT NULL DEFAULT 0;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS fee_pct_whatsapp numeric NOT NULL DEFAULT 0;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS gemini_api_key text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS groq_api_key_2 text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS groq_api_key_3 text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_access_token text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_app_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_app_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_phone_number_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_verify_token text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS meta_waba_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_access_token text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_api_base_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_app_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_client_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_client_secret text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_merchant_id text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_oauth_token_url text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_own_delivery boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS nfood_token_expires_at timestamptz;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS openai_api_key text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS pix_auto_cancel_minutes integer NOT NULL DEFAULT 30;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS privacy_contact_email text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS veiculo_consumo_kml numeric;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'evolution';


-- ============ API_LOGS ============
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS event_type text;

-- ============ DELIVERERS ============
ALTER TABLE public.deliverers ADD COLUMN IF NOT EXISTS payment_note text;
ALTER TABLE public.deliverers ADD COLUMN IF NOT EXISTS payment_updated_at timestamptz;

-- ============ ORDER_DRAFTS ============
ALTER TABLE public.order_drafts ADD COLUMN IF NOT EXISTS failed_finalize_attempts integer NOT NULL DEFAULT 0;

-- ============ ORDERS ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ifood_display_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ifood_driver_assigned_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS nfood_driver_assigned_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS nfood_last_pushed_status text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_timing text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz;

-- ============ PRODUCTS ============
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS needs_preparation boolean NOT NULL DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS target_margin_percent numeric;

-- ============ WHATSAPP_CONVERSATIONS ============
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS has_unread boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS last_inbound_meta_message_id text;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- ============ WHATSAPP_MESSAGES ============
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- ============ ZONAS_ENTREGA ============
ALTER TABLE public.zonas_entrega ADD COLUMN IF NOT EXISTS distancia_km_max numeric;
ALTER TABLE public.zonas_entrega ADD COLUMN IF NOT EXISTS distancia_km_min numeric;
ALTER TABLE public.zonas_entrega ADD COLUMN IF NOT EXISTS distancia_suspeita boolean NOT NULL DEFAULT false;
ALTER TABLE public.zonas_entrega ADD COLUMN IF NOT EXISTS distancia_variavel boolean NOT NULL DEFAULT false;

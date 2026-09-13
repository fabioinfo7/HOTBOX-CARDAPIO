-- HOTBOX — Recuperação de vendas + auditoria do funil
create extension if not exists pgcrypto;

create table if not exists public.sales_recovery_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  mode text not null default 'manual' check (mode in ('manual','automatic')),
  abandoned_checkout_enabled boolean not null default true,
  rejected_payment_enabled boolean not null default true,
  abandoned_delay_minutes integer not null default 20 check (abandoned_delay_minutes between 5 and 1440),
  rejected_delay_minutes integer not null default 5 check (rejected_delay_minutes between 0 and 1440),
  cooldown_hours integer not null default 24 check (cooldown_hours between 1 and 720),
  max_messages_per_phone_24h integer not null default 1 check (max_messages_per_phone_24h between 1 and 10),
  abandoned_message text not null default 'Olá! 👋 Aqui é da HotBox Delivery. Vi que você iniciou um pedido no nosso cardápio e não conseguiu finalizar. Posso te ajudar a concluir seu pedido? 😊',
  rejected_message text not null default 'Olá! 👋 Aqui é da HotBox Delivery. Seu pagamento não foi aprovado no cardápio. Se quiser, posso te ajudar a finalizar por outra forma de pagamento 😊',
  updated_at timestamptz not null default now()
);

insert into public.sales_recovery_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.sales_recovery_log (
  id uuid primary key default gen_random_uuid(),
  analytics_session_id text,
  customer_phone text not null,
  customer_name text,
  recovery_type text not null check (recovery_type in ('abandoned_checkout','rejected_payment')),
  mode text not null check (mode in ('manual','automatic')),
  status text not null default 'sent' check (status in ('sent','failed','cancelled','skipped')),
  message text not null,
  source text,
  campaign text,
  checkout_id text,
  order_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_recovery_log_session_type
  on public.sales_recovery_log (analytics_session_id, recovery_type, created_at desc);
create index if not exists idx_sales_recovery_log_phone_created
  on public.sales_recovery_log (customer_phone, created_at desc);

alter table public.sales_recovery_settings enable row level security;
alter table public.sales_recovery_log enable row level security;

-- Administração usa server functions com service role. Mantemos acesso direto fechado.
revoke all on public.sales_recovery_settings from anon;
revoke all on public.sales_recovery_log from anon;

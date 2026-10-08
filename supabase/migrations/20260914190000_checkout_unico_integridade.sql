-- Checkout único e reparo de integridade do banco HotBox.
-- Idempotente: pode ser executada em bancos completos ou parcialmente migrados.

begin;

alter table public.store_config
  add column if not exists digital_menu_pix_enabled boolean not null default true,
  add column if not exists digital_menu_card_enabled boolean not null default true,
  add column if not exists digital_menu_pay_on_delivery_enabled boolean not null default false,
  add column if not exists digital_menu_pay_on_delivery_card_enabled boolean not null default true,
  add column if not exists digital_menu_pay_on_delivery_pix_enabled boolean not null default true,
  add column if not exists digital_payment_provider text not null default 'mercadopago',
  add column if not exists digital_pix_provider text,
  add column if not exists digital_card_provider text,
  add column if not exists mercadopago_enabled boolean not null default false,
  add column if not exists mercadopago_environment text not null default 'test',
  add column if not exists mercadopago_public_key text,
  add column if not exists mercadopago_access_token text,
  add column if not exists mercadopago_max_installments integer not null default 1,
  add column if not exists pagarme_enabled boolean not null default false,
  add column if not exists pagarme_public_key text,
  add column if not exists pagarme_secret_key text,
  add column if not exists pagarme_webhook_token text,
  add column if not exists pagarme_max_installments integer not null default 1,
  add column if not exists efi_enabled boolean not null default false,
  add column if not exists efi_environment text not null default 'sandbox',
  add column if not exists efi_client_id text,
  add column if not exists efi_client_secret text,
  add column if not exists efi_pix_key text,
  add column if not exists efi_pix_certificate_base64 text,
  add column if not exists efi_pix_certificate_password text,
  add column if not exists efi_payee_code text,
  add column if not exists efi_max_installments integer not null default 1,
  add column if not exists infinitepay_enabled boolean not null default false,
  add column if not exists appmax_enabled boolean not null default false;

insert into public.store_config (id)
values (1)
on conflict (id) do nothing;

update public.store_config
set digital_payment_provider = case
      when digital_payment_provider in ('mercadopago', 'pagarme', 'efi') then digital_payment_provider
      when mercadopago_enabled then 'mercadopago'
      when efi_enabled then 'efi'
      when pagarme_enabled then 'pagarme'
      else 'mercadopago'
    end,
    infinitepay_enabled = false,
    appmax_enabled = false;

update public.store_config
set digital_pix_provider = digital_payment_provider,
    digital_card_provider = digital_payment_provider;

alter table public.store_config
  drop constraint if exists store_config_checkout_provider_check;

alter table public.store_config
  add constraint store_config_checkout_provider_check
  check (
    digital_payment_provider in ('mercadopago', 'pagarme', 'efi')
    and digital_pix_provider = digital_payment_provider
    and digital_card_provider = digital_payment_provider
  );

alter table public.store_config
  drop constraint if exists store_config_mercadopago_installments_check,
  drop constraint if exists store_config_pagarme_installments_check,
  drop constraint if exists store_config_efi_installments_check;

alter table public.store_config
  add constraint store_config_mercadopago_installments_check check (mercadopago_max_installments between 1 and 12),
  add constraint store_config_pagarme_installments_check check (pagarme_max_installments between 1 and 12),
  add constraint store_config_efi_installments_check check (efi_max_installments between 1 and 12);

create table if not exists public.bairros_nao_atendidos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bairros_nao_atendidos
  add column if not exists nome text,
  add column if not exists ativo boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists bairros_nao_atendidos_nome_idx
  on public.bairros_nao_atendidos (lower(nome));

create table if not exists public.ruas_nao_atendidas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  bairro text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ruas_nao_atendidas
  add column if not exists nome text,
  add column if not exists bairro text,
  add column if not exists ativo boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists ruas_nao_atendidas_nome_idx
  on public.ruas_nao_atendidas (lower(nome));

create table if not exists public.pending_human_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  phone text not null,
  customer_name text,
  reason text,
  status text not null default 'pending',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.pending_human_handoffs
  add column if not exists conversation_id uuid,
  add column if not exists phone text,
  add column if not exists customer_name text,
  add column if not exists reason text,
  add column if not exists status text not null default 'pending',
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists resolved_at timestamptz;

create index if not exists pending_human_handoffs_status_idx
  on public.pending_human_handoffs (status, created_at desc);
create index if not exists pending_human_handoffs_conversation_idx
  on public.pending_human_handoffs (conversation_id);

create table if not exists public.reengagement_queue (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  conversation_id uuid,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reengagement_queue
  add column if not exists phone text,
  add column if not exists conversation_id uuid,
  add column if not exists scheduled_for timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists status text not null default 'pending',
  add column if not exists cancel_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists reengagement_queue_due_idx
  on public.reengagement_queue (status, scheduled_for);
create index if not exists reengagement_queue_conversation_idx
  on public.reengagement_queue (conversation_id);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type text not null default 'percentage',
  discount_value numeric(12,2) not null,
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  usage_limit integer,
  usage_count integer not null default 0,
  max_uses_per_customer integer,
  min_order_value numeric(12,2),
  applicable_product_id uuid,
  first_order_only boolean not null default false,
  allow_promotion_stack boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coupons
  add column if not exists code text,
  add column if not exists description text,
  add column if not exists discount_type text not null default 'percentage',
  add column if not exists discount_value numeric(12,2),
  add column if not exists active boolean not null default true,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists usage_limit integer,
  add column if not exists usage_count integer not null default 0,
  add column if not exists max_uses_per_customer integer,
  add column if not exists min_order_value numeric(12,2),
  add column if not exists applicable_product_id uuid,
  add column if not exists first_order_only boolean not null default false,
  add column if not exists allow_promotion_stack boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists coupons_code_upper_uidx
  on public.coupons (upper(code));

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null,
  order_id uuid not null,
  customer_phone text not null,
  discount_amount numeric(12,2) not null default 0,
  order_subtotal numeric(12,2) not null default 0,
  order_total numeric(12,2) not null default 0,
  used_at timestamptz not null default now(),
  reversed_at timestamptz
);

alter table public.coupon_redemptions
  add column if not exists coupon_id uuid,
  add column if not exists order_id uuid,
  add column if not exists customer_phone text,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists order_subtotal numeric(12,2) not null default 0,
  add column if not exists order_total numeric(12,2) not null default 0,
  add column if not exists used_at timestamptz not null default now(),
  add column if not exists reversed_at timestamptz;

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, used_at desc);
create index if not exists coupon_redemptions_phone_idx
  on public.coupon_redemptions (customer_phone, used_at desc);
create unique index if not exists coupon_redemptions_order_uidx
  on public.coupon_redemptions (order_id);

alter table public.bairros_nao_atendidos enable row level security;
alter table public.ruas_nao_atendidas enable row level security;
alter table public.pending_human_handoffs enable row level security;
alter table public.reengagement_queue enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists bairros_nao_atendidos_admin on public.bairros_nao_atendidos;
create policy bairros_nao_atendidos_admin on public.bairros_nao_atendidos
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

drop policy if exists ruas_nao_atendidas_admin on public.ruas_nao_atendidas;
create policy ruas_nao_atendidas_admin on public.ruas_nao_atendidas
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

drop policy if exists pending_human_handoffs_admin on public.pending_human_handoffs;
create policy pending_human_handoffs_admin on public.pending_human_handoffs
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

drop policy if exists reengagement_queue_admin on public.reengagement_queue;
create policy reengagement_queue_admin on public.reengagement_queue
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

drop policy if exists coupons_admin on public.coupons;
create policy coupons_admin on public.coupons
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

drop policy if exists coupon_redemptions_admin on public.coupon_redemptions;
create policy coupon_redemptions_admin on public.coupon_redemptions
  for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

grant select, insert, update, delete on
  public.bairros_nao_atendidos,
  public.ruas_nao_atendidas,
  public.pending_human_handoffs,
  public.reengagement_queue,
  public.coupons,
  public.coupon_redemptions
to authenticated;

grant all on
  public.bairros_nao_atendidos,
  public.ruas_nao_atendidas,
  public.pending_human_handoffs,
  public.reengagement_queue,
  public.coupons,
  public.coupon_redemptions
to service_role;

create or replace function public.get_public_menu_products()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p)
  from public.products p
  where p.active = true
  order by p.name;
$$;

revoke all on function public.get_public_menu_products() from public;
grant execute on function public.get_public_menu_products() to anon, authenticated;

create or replace function public.get_public_payment_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      case
        when digital_payment_provider in ('mercadopago', 'pagarme', 'efi')
          then digital_payment_provider
        else 'mercadopago'
      end as provider,
      *
    from public.store_config
    where id = 1
    limit 1
  ),
  availability as (
    select
      *,
      case provider
        when 'pagarme' then pagarme_enabled
          and nullif(trim(pagarme_public_key), '') is not null
          and nullif(trim(pagarme_secret_key), '') is not null
        when 'efi' then efi_enabled
          and nullif(trim(efi_client_id), '') is not null
          and nullif(trim(efi_client_secret), '') is not null
          and nullif(trim(efi_pix_key), '') is not null
          and nullif(trim(efi_pix_certificate_base64), '') is not null
        else mercadopago_enabled
          and nullif(trim(mercadopago_public_key), '') is not null
          and nullif(trim(mercadopago_access_token), '') is not null
      end as pix_available,
      case provider
        when 'pagarme' then pagarme_enabled
          and nullif(trim(pagarme_public_key), '') is not null
          and nullif(trim(pagarme_secret_key), '') is not null
        when 'efi' then efi_enabled
          and nullif(trim(efi_client_id), '') is not null
          and nullif(trim(efi_client_secret), '') is not null
          and nullif(trim(efi_payee_code), '') is not null
        else mercadopago_enabled
          and nullif(trim(mercadopago_public_key), '') is not null
          and nullif(trim(mercadopago_access_token), '') is not null
      end as card_available
    from normalized
  )
  select jsonb_build_object(
    'provider', provider,
    'pix_provider', provider,
    'card_provider', provider,
    'pix_payment_available', digital_menu_pix_enabled and pix_available,
    'card_payment_available', digital_menu_card_enabled and card_available,
    'payment_available', (digital_menu_pix_enabled and pix_available)
      or (digital_menu_card_enabled and card_available),
    'mercadopago_public_key', case when provider = 'mercadopago' then mercadopago_public_key else null end,
    'mercadopago_max_installments', mercadopago_max_installments,
    'pagarme_public_key', case when provider = 'pagarme' then pagarme_public_key else null end,
    'pagarme_max_installments', pagarme_max_installments,
    'efi_payee_code', case when provider = 'efi' then efi_payee_code else null end,
    'efi_environment', efi_environment,
    'efi_max_installments', efi_max_installments,
    'pay_on_delivery_enabled', digital_menu_pay_on_delivery_enabled,
    'pay_on_delivery_card_enabled', digital_menu_pay_on_delivery_card_enabled,
    'pay_on_delivery_pix_enabled', digital_menu_pay_on_delivery_pix_enabled
  )
  from availability;
$$;

revoke all on function public.get_public_payment_config() from public;
grant execute on function public.get_public_payment_config() to anon, authenticated;

notify pgrst, 'reload schema';

commit;

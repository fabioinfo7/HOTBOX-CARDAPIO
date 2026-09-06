-- HotBox — Financeiro do Cardápio Digital / InfinitePay
-- Não altera pedidos WhatsApp/manual.
-- Mantém os dados financeiros originais da InfinitePay imutáveis e cria apenas
-- campos auxiliares para auditoria/organização no painel administrativo.

alter table public.site_checkout_sessions add column if not exists infinitepay_amount_cents integer;
alter table public.site_checkout_sessions add column if not exists infinitepay_paid_amount_cents integer;
alter table public.site_checkout_sessions add column if not exists infinitepay_installments smallint;
alter table public.site_checkout_sessions add column if not exists infinitepay_capture_method text;
alter table public.site_checkout_sessions add column if not exists infinitepay_verified_at timestamptz;
alter table public.site_checkout_sessions add column if not exists infinitepay_webhook_payload jsonb;
alter table public.site_checkout_sessions add column if not exists infinitepay_verification_payload jsonb;

-- Campos administrativos. A edição no painel mexe somente neles.
alter table public.site_checkout_sessions add column if not exists finance_reference text;
alter table public.site_checkout_sessions add column if not exists finance_note text;
alter table public.site_checkout_sessions add column if not exists finance_hidden_at timestamptz;
alter table public.site_checkout_sessions add column if not exists finance_hidden_by uuid;

create index if not exists idx_site_checkout_paid_at
  on public.site_checkout_sessions(paid_at desc)
  where status = 'paid';

create index if not exists idx_site_checkout_infinitepay_finance
  on public.site_checkout_sessions(payment_kind, paid_at desc)
  where payment_kind in ('infinitepay','infinitepay_card','infinitepay_pix');

-- Soma financeira server-side para não depender do limite padrão de 1000 linhas
-- do PostgREST. A função é restrita ao service_role e usada por Server Functions
-- autenticadas do painel.
create or replace function public.digital_menu_finance_summary(
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_payment_kind text default null
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      total,
      payment_kind,
      coalesce(infinitepay_amount_cents, round(total * 100)::integer) as amount_cents,
      coalesce(infinitepay_paid_amount_cents, infinitepay_amount_cents, round(total * 100)::integer) as paid_amount_cents
    from public.site_checkout_sessions
    where status = 'paid'
      and payment_kind in ('infinitepay','infinitepay_card','infinitepay_pix')
      and finance_hidden_at is null
      and (p_since is null or paid_at >= p_since)
      and (p_until is null or paid_at <= p_until)
      and (
        p_payment_kind is null
        or p_payment_kind = 'all'
        or (p_payment_kind = 'pix' and payment_kind = 'infinitepay_pix')
        or (p_payment_kind = 'card' and payment_kind in ('infinitepay_card','infinitepay'))
      )
  )
  select jsonb_build_object(
    'transactions', count(*),
    'sales_total', coalesce(sum(amount_cents),0) / 100.0,
    'customer_paid_total', coalesce(sum(paid_amount_cents),0) / 100.0,
    'pix_total', coalesce(sum(case when payment_kind = 'infinitepay_pix' then amount_cents else 0 end),0) / 100.0,
    'pix_count', count(*) filter (where payment_kind = 'infinitepay_pix'),
    'card_total', coalesce(sum(case when payment_kind in ('infinitepay_card','infinitepay') then amount_cents else 0 end),0) / 100.0,
    'card_count', count(*) filter (where payment_kind in ('infinitepay_card','infinitepay'))
  )
  from base;
$$;

revoke all on function public.digital_menu_finance_summary(timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.digital_menu_finance_summary(timestamptz,timestamptz,text) to service_role;

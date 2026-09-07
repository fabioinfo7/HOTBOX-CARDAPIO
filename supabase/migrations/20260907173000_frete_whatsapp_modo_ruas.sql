-- HOTBOX V20 — modo operacional de frete no WhatsApp + exceções por rua
-- Idempotente. Execute no SQL Editor do Supabase antes do deploy.

-- 1) Um único modo global por vez. Não existem dois booleanos conflitantes.
alter table public.store_config
  add column if not exists whatsapp_delivery_dispatch_mode text
  not null default 'fixed_by_neighborhood';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_config_whatsapp_delivery_dispatch_mode_check'
  ) then
    alter table public.store_config
      add constraint store_config_whatsapp_delivery_dispatch_mode_check
      check (whatsapp_delivery_dispatch_mode in ('fixed_by_neighborhood','partner_quote'));
  end if;
end $$;

comment on column public.store_config.whatsapp_delivery_dispatch_mode is
  'Modo operacional do WhatsApp: fixed_by_neighborhood ou partner_quote. Exceções por rua têm prioridade.';

-- 2) Exceções por rua. A rua pode inverter o modo global.
create table if not exists public.delivery_street_exceptions (
  id uuid primary key default gen_random_uuid(),
  street_name text not null,
  neighborhood text not null,
  dispatch_mode text not null,
  fixed_fee numeric(10,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_street_exceptions_mode_check'
  ) then
    alter table public.delivery_street_exceptions
      add constraint delivery_street_exceptions_mode_check
      check (dispatch_mode in ('fixed','partner_quote'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'delivery_street_exceptions_fixed_fee_check'
  ) then
    alter table public.delivery_street_exceptions
      add constraint delivery_street_exceptions_fixed_fee_check
      check (
        (dispatch_mode = 'partner_quote' and fixed_fee is null)
        or
        (dispatch_mode = 'fixed' and fixed_fee is not null and fixed_fee > 0)
      );
  end if;
end $$;

create unique index if not exists uq_delivery_street_exception_name_neighborhood
  on public.delivery_street_exceptions (lower(trim(street_name)), lower(trim(neighborhood)));

create index if not exists idx_delivery_street_exceptions_active
  on public.delivery_street_exceptions(active, neighborhood, street_name);

grant select, insert, update, delete on public.delivery_street_exceptions to authenticated;
grant all on public.delivery_street_exceptions to service_role;

alter table public.delivery_street_exceptions enable row level security;

drop policy if exists "admins manage delivery street exceptions" on public.delivery_street_exceptions;
create policy "admins manage delivery street exceptions"
on public.delivery_street_exceptions
for all
to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));

-- 3) Diferencia popup normal de aprovação do popup obrigatório de cotação.
alter table public.pending_freight_approvals
  add column if not exists approval_kind text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pending_freight_approvals_kind_check'
  ) then
    alter table public.pending_freight_approvals
      add constraint pending_freight_approvals_kind_check
      check (approval_kind in ('standard','partner_quote'));
  end if;
end $$;

comment on column public.pending_freight_approvals.approval_kind is
  'standard = valor já conhecido; partner_quote = operador precisa consultar parceiro, digitar e autorizar o envio.';

-- 4) Documenta novo estado de cotação no draft.
comment on column public.order_drafts.freight_notification_status is
  'pending, partner_quote_pending, bot_authorized, operator_will_send, sent_by_bot, sent_by_operator.';

-- 5) Realtime do popup, se ainda não estiver publicado.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_freight_approvals'
  ) then
    alter publication supabase_realtime add table public.pending_freight_approvals;
  end if;
end $$;

-- Verificação
select whatsapp_delivery_dispatch_mode
from public.store_config
limit 1;

select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='pending_freight_approvals'
  and column_name='approval_kind';

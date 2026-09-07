-- HotBox Delivery — módulo de satisfação de clientes
create extension if not exists pgcrypto;

create table if not exists public.customer_feedback (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  customer_name text,
  phone text not null,
  token uuid not null default gen_random_uuid() unique,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  service_rating smallint check (service_rating between 1 and 5),
  delivery_rating smallint check (delivery_rating between 1 and 5),
  flavor_rating smallint check (flavor_rating between 1 and 5),
  appearance_rating smallint check (appearance_rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1200),
  whatsapp_message_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_feedback_all_scores_together check (
    (submitted_at is null and service_rating is null and delivery_rating is null and flavor_rating is null and appearance_rating is null)
    or
    (submitted_at is not null and service_rating is not null and delivery_rating is not null and flavor_rating is not null and appearance_rating is not null)
  )
);

create index if not exists idx_customer_feedback_lead on public.customer_feedback(lead_id);
create index if not exists idx_customer_feedback_submitted on public.customer_feedback(submitted_at desc);
create index if not exists idx_customer_feedback_sent on public.customer_feedback(sent_at desc);

grant select, insert, update, delete on public.customer_feedback to authenticated;
grant all on public.customer_feedback to service_role;

create or replace function public.set_customer_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customer_feedback_updated_at on public.customer_feedback;
create trigger trg_customer_feedback_updated_at
before update on public.customer_feedback
for each row execute function public.set_customer_feedback_updated_at();

alter table public.customer_feedback enable row level security;

drop policy if exists "store admins read feedback" on public.customer_feedback;
create policy "store admins read feedback"
on public.customer_feedback
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'store_admin'
  )
);

drop policy if exists "store admins manage feedback" on public.customer_feedback;
create policy "store admins manage feedback"
on public.customer_feedback
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'store_admin'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'store_admin'
  )
);

-- A página pública NÃO recebe policy anônima. Leitura e gravação pelo cliente
-- passam exclusivamente pelos server functions, usando o token aleatório do convite.

-- Realtime para atualizar o painel quando uma resposta chegar.
do $$
begin
  alter publication supabase_realtime add table public.customer_feedback;
exception
  when duplicate_object then null;
end $$;

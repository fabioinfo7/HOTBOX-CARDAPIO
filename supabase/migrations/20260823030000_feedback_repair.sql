-- HotBox Delivery — reparo idempotente do módulo de satisfação por pedido.
-- Pode ser executado mesmo se as migrations anteriores já tiverem sido aplicadas.
create extension if not exists pgcrypto;

alter table if exists public.customer_feedback
  add column if not exists order_id uuid references public.orders(id) on delete set null;

alter table if exists public.customer_feedback
  alter column token set default gen_random_uuid();

update public.customer_feedback
set token = gen_random_uuid()
where token is null;

alter table if exists public.customer_feedback
  alter column token set not null;

create unique index if not exists uq_customer_feedback_token
  on public.customer_feedback(token);
create index if not exists idx_customer_feedback_order_id
  on public.customer_feedback(order_id);
create unique index if not exists uq_customer_feedback_one_per_order
  on public.customer_feedback(order_id)
  where order_id is not null;

grant select, insert, update, delete on public.customer_feedback to authenticated;
grant all on public.customer_feedback to service_role;

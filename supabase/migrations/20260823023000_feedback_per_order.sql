-- HotBox Delivery — sincroniza convites de satisfação por pedido
-- Executar UMA vez depois da migration 20260822235900_customer_satisfaction.sql.

alter table public.customer_feedback
  add column if not exists order_id uuid references public.orders(id) on delete set null;

create index if not exists idx_customer_feedback_order_id
  on public.customer_feedback(order_id);

-- Vincula convites antigos aos pedidos entregues mais recentes do mesmo cliente,
-- pareando do mais novo para o mais antigo. Assim o status já existente não se perde.
with ranked_feedback as (
  select id, phone,
         row_number() over (partition by phone order by coalesce(sent_at, created_at) desc, created_at desc) as rn
  from public.customer_feedback
  where order_id is null
), ranked_orders as (
  select id, customer_phone,
         row_number() over (partition by customer_phone order by created_at desc, id desc) as rn
  from public.orders
  where status = 'delivered'
), pairs as (
  select f.id as feedback_id, o.id as order_id
  from ranked_feedback f
  join ranked_orders o on o.customer_phone = f.phone and o.rn = f.rn
)
update public.customer_feedback cf
set order_id = p.order_id
from pairs p
where cf.id = p.feedback_id
  and cf.order_id is null;

-- Um pedido deve ter no máximo um convite/avaliação.
create unique index if not exists uq_customer_feedback_one_per_order
  on public.customer_feedback(order_id)
  where order_id is not null;

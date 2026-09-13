-- Mantém Leads sincronizados com todos os pedidos (manual, IA, WhatsApp etc.)
-- e substitui telefone/nome vazio pelo nome real informado no pedido.

create or replace function public.upsert_lead_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _lead_id uuid;
  _incoming_name text;
begin
  _incoming_name := nullif(btrim(coalesce(new.customer_name, '')), '');

  -- Não considera como nome um valor que seja apenas o próprio telefone.
  if _incoming_name is not null
     and regexp_replace(_incoming_name, '\\D', '', 'g') = regexp_replace(coalesce(new.customer_phone, ''), '\\D', '', 'g') then
    _incoming_name := null;
  end if;

  insert into public.leads(name, phone, last_order_at, order_count, total_spent)
  values (_incoming_name, new.customer_phone, now(), 1, coalesce(new.total, 0))
  on conflict (phone) do update set
    name = case
      when _incoming_name is not null then _incoming_name
      else public.leads.name
    end,
    last_order_at = now(),
    order_count = public.leads.order_count + 1,
    total_spent = public.leads.total_spent + coalesce(excluded.total_spent, 0)
  returning id into _lead_id;

  new.lead_id := _lead_id;
  return new;
end
$$;

-- Corrige compradores já existentes usando o nome válido do pedido mais recente.
with latest_named_order as (
  select distinct on (customer_phone)
    customer_phone,
    nullif(btrim(customer_name), '') as customer_name
  from public.orders
  where customer_phone is not null
    and nullif(btrim(customer_name), '') is not null
    and regexp_replace(customer_name, '\\D', '', 'g') <> regexp_replace(customer_phone, '\\D', '', 'g')
  order by customer_phone, created_at desc
)
update public.leads l
set name = o.customer_name
from latest_named_order o
where l.phone = o.customer_phone
  and l.order_count > 0
  and o.customer_name is not null;

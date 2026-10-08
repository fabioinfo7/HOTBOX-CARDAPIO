-- Atualização atômica dos itens de um pedido WhatsApp já criado.
-- Evita estados intermediários (pedido sem itens) quando o cliente altera/cancela item pelo chat.
create or replace function public.update_whatsapp_order_items_atomic(
  p_order_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.orders
    where id = p_order_id
      and status not in ('delivered','cancelled','failed')
  ) then
    raise exception 'Pedido não está ativo';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Pedido precisa ter ao menos um item';
  end if;

  delete from public.order_items where order_id = p_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, quantity, unit_price, list_price, is_promotion_price, notes
  )
  select
    p_order_id,
    nullif(x.product_id, '')::uuid,
    x.product_name,
    greatest(1, x.quantity),
    x.unit_price,
    x.list_price,
    coalesce(x.is_promotion_price, false),
    x.notes
  from jsonb_to_recordset(p_items) as x(
    product_id text,
    product_name text,
    quantity integer,
    unit_price numeric,
    list_price numeric,
    is_promotion_price boolean,
    notes text
  );

  update public.orders
  set subtotal = p_subtotal,
      total = p_total
  where id = p_order_id;

  return jsonb_build_object('id', p_order_id, 'subtotal', p_subtotal, 'total', p_total);
end;
$$;

revoke all on function public.update_whatsapp_order_items_atomic(uuid,jsonb,numeric,numeric) from public;
grant execute on function public.update_whatsapp_order_items_atomic(uuid,jsonb,numeric,numeric) to service_role;

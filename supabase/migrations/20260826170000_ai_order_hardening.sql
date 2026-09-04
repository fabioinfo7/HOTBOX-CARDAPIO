-- Hardening do atendimento automático: criação atômica de pedido + lock por telefone.

alter table public.order_items add column if not exists list_price numeric(12,2);
alter table public.order_items add column if not exists is_promotion_price boolean not null default false;
alter table public.orders add column if not exists card_type text check (card_type in ('credit','debit'));
alter table public.order_drafts add column if not exists card_type text check (card_type in ('credit','debit'));

create table if not exists public.whatsapp_processing_locks (
  phone text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

grant all on public.whatsapp_processing_locks to service_role;
alter table public.whatsapp_processing_locks enable row level security;

create or replace function public.create_whatsapp_order_atomic(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido sem itens';
  end if;

  if coalesce(p_order->>'payment_method','') not in ('pix','card') then
    raise exception 'Forma de pagamento inválida. Use pix ou card.';
  end if;

  insert into public.orders (
    source, created_at, customer_name, customer_phone, delivery_mode,
    address_street, address_number, address_complement, address_neighborhood,
    address_city, address_reference, notes, payment_method, card_type, payment_timing,
    payment_status, change_for, pix_code, subtotal, delivery_fee, total,
    delivery_distance_km, status
  ) values (
    coalesce((p_order->>'source')::public.order_source, 'whatsapp'::public.order_source),
    coalesce((p_order->>'created_at')::timestamptz, now()),
    trim(p_order->>'customer_name'),
    p_order->>'customer_phone',
    coalesce(p_order->>'delivery_mode','delivery'),
    nullif(p_order->>'address_street',''),
    nullif(p_order->>'address_number',''),
    nullif(p_order->>'address_complement',''),
    nullif(p_order->>'address_neighborhood',''),
    nullif(p_order->>'address_city',''),
    nullif(p_order->>'address_reference',''),
    nullif(p_order->>'notes',''),
    (p_order->>'payment_method')::public.payment_method,
    case when p_order->>'payment_method' = 'card' then nullif(p_order->>'card_type','') else null end,
    nullif(p_order->>'payment_timing',''),
    coalesce(nullif(p_order->>'payment_status',''),'pending'),
    null,
    nullif(p_order->>'pix_code',''),
    coalesce((p_order->>'subtotal')::numeric,0),
    coalesce((p_order->>'delivery_fee')::numeric,0),
    coalesce((p_order->>'total')::numeric,0),
    nullif(p_order->>'delivery_distance_km','')::numeric,
    coalesce(nullif(p_order->>'status',''),'pending_review')::public.order_status
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price,
      list_price, is_promotion_price, notes
    ) values (
      v_order.id,
      nullif(v_item->>'product_id','')::uuid,
      v_item->>'product_name',
      greatest(1, coalesce((v_item->>'quantity')::int,1)),
      coalesce((v_item->>'unit_price')::numeric,0),
      nullif(v_item->>'list_price','')::numeric,
      coalesce((v_item->>'is_promotion_price')::boolean,false),
      nullif(v_item->>'notes','')
    );
  end loop;

  return jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number);
end;
$$;

grant execute on function public.create_whatsapp_order_atomic(jsonb,jsonb) to service_role;

alter table public.store_config add column if not exists ai_temperature numeric not null default 0.2;
update public.store_config set ai_temperature = 0.2 where ai_temperature is null;

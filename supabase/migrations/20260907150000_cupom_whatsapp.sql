-- HOTBOX V17 — CUPOM NO ATENDIMENTO WHATSAPP
-- Execute uma vez no SQL Editor do Supabase antes do deploy da V17.

alter table public.order_drafts
  add column if not exists coupon_code text,
  add column if not exists coupon_discount numeric(12,2) not null default 0;

comment on column public.order_drafts.coupon_code is
  'Cupom informado durante o atendimento WhatsApp, pendente/validado pelo backend.';
comment on column public.order_drafts.coupon_discount is
  'Snapshot do desconto do cupom no rascunho. O valor é revalidado no fechamento.';

-- Criação atômica do pedido WhatsApp com validação e resgate do cupom dentro
-- da mesma transação. Isso evita corrida de limite, cupom vencido entre resumo
-- e fechamento e desconto duplicado.
create or replace function public.create_whatsapp_order_atomic(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_coupon public.coupons%rowtype;
  v_quote jsonb;
  v_coupon_code text := nullif(upper(trim(coalesce(p_order->>'coupon_code',''))),'');
  v_discount numeric := 0;
  v_subtotal numeric := 0;
  v_delivery numeric := greatest(coalesce(nullif(p_order->>'delivery_fee','')::numeric,0),0);
  v_total numeric := 0;
  v_phone text := regexp_replace(coalesce(p_order->>'customer_phone',''), '\D', '', 'g');
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pedido sem itens';
  end if;

  if coalesce(p_order->>'payment_method','') not in ('pix','card') then
    raise exception 'Forma de pagamento inválida. Use pix ou card.';
  end if;

  select coalesce(
    sum(
      coalesce((x->>'unit_price')::numeric,0)
      * greatest(1,coalesce((x->>'quantity')::int,1))
    ),
    0
  )
  into v_subtotal
  from jsonb_array_elements(p_items) x;

  if v_subtotal <= 0 then
    raise exception 'Subtotal inválido';
  end if;

  if v_coupon_code is not null then
    select *
      into v_coupon
      from public.coupons
     where upper(code)=v_coupon_code
     for update;

    if not found then
      raise exception 'Cupom não encontrado';
    end if;

    -- O validador oficial espera qty; o payload do WhatsApp usa quantity.
    v_quote := public._coupon_quote_internal(
      v_coupon_code,
      v_subtotal,
      v_phone,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'product_id', x->>'product_id',
              'product_name', x->>'product_name',
              'qty', greatest(1,coalesce((x->>'quantity')::int,1)),
              'unit_price', coalesce((x->>'unit_price')::numeric,0),
              'is_promotion_price', coalesce((x->>'is_promotion_price')::boolean,false)
            )
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(p_items) x
      ),
      now()
    );

    if not coalesce((v_quote->>'ok')::boolean,false) then
      raise exception '%', coalesce(v_quote->>'reason','Cupom inválido');
    end if;

    v_discount := greatest(
      0,
      least(v_subtotal,coalesce((v_quote->>'discount')::numeric,0))
    );
    v_coupon_code := upper(coalesce(v_quote->>'code',v_coupon.code));
  end if;

  v_total := greatest(0,v_subtotal-v_discount)+v_delivery;

  insert into public.orders (
    source, created_at, customer_name, customer_phone, delivery_mode,
    address_street, address_number, address_complement, address_neighborhood,
    address_city, address_reference, notes, payment_method, card_type, payment_timing,
    payment_status, change_for, pix_code, subtotal, delivery_fee,
    coupon_code, coupon_discount, total, delivery_distance_km, status
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
    v_subtotal,
    v_delivery,
    case when v_discount > 0 then v_coupon_code else null end,
    v_discount,
    v_total,
    nullif(p_order->>'delivery_distance_km','')::numeric,
    coalesce(nullif(p_order->>'status',''),'pending_review')::public.order_status
  )
  returning * into v_order;

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

  if v_coupon_code is not null and v_discount > 0 then
    insert into public.coupon_redemptions(
      coupon_id,
      order_id,
      customer_phone,
      discount_amount,
      order_subtotal,
      order_total
    ) values (
      v_coupon.id,
      v_order.id,
      v_phone,
      v_discount,
      v_subtotal,
      v_total
    );

    update public.coupons
       set usage_count = coalesce(usage_count,0)+1
     where id=v_coupon.id;
  end if;

  return jsonb_build_object(
    'id',v_order.id,
    'order_number',v_order.order_number,
    'coupon_code',case when v_discount > 0 then v_coupon_code else null end,
    'coupon_discount',v_discount,
    'subtotal',v_subtotal,
    'delivery_fee',v_delivery,
    'total',v_total
  );
end;
$$;

grant execute on function public.create_whatsapp_order_atomic(jsonb,jsonb) to service_role;

-- Verificação rápida.
select
  column_name,
  data_type
from information_schema.columns
where table_schema='public'
  and table_name='order_drafts'
  and column_name in ('coupon_code','coupon_discount')
order by column_name;

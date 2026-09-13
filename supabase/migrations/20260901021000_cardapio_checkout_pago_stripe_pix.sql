-- HotBox Delivery — Checkout isolado do cardápio digital + Stripe cartão/Pix.
-- IMPORTANTE: não altera o fluxo de pedidos WhatsApp/manual.

alter table public.store_config add column if not exists stripe_pix_enabled boolean not null default false;

create table if not exists public.site_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'created',
  payment_kind text not null,
  customer_name text not null,
  customer_phone text not null,
  order_data jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  coupon_code text,
  coupon_discount numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  order_id uuid unique references public.orders(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_checkout_payment_kind_ck check (payment_kind in ('stripe_card','stripe_pix')),
  constraint site_checkout_status_ck check (status in ('created','payment_pending','paid','expired','payment_failed','cancelled'))
);

create index if not exists idx_site_checkout_status_created on public.site_checkout_sessions(status, created_at desc);
create index if not exists idx_site_checkout_phone on public.site_checkout_sessions(customer_phone, created_at desc);

alter table public.site_checkout_sessions enable row level security;
-- Sem policies públicas: somente backend/service role acessa checkouts.

-- Exposição pública somente de flags não sensíveis.
create or replace view public.store_config_public as
  select store_name,
         default_delivery_fee,
         pix_key,
         pix_copia_cola,
         pix_mode,
         estimated_delivery_time_minutes,
         banner_image_url,
         banner_tagline,
         digital_menu_enabled,
         stripe_enabled,
         digital_menu_cash_enabled,
         digital_menu_pix_enabled,
         digital_menu_card_enabled,
         stripe_pix_enabled
    from public.store_config
   where id = 1;

grant select on public.store_config_public to anon, authenticated;

-- Só esta função transforma um checkout PAGO em pedido operacional.
-- O lock + order_id tornam o processamento idempotente mesmo se o Stripe reenviar o webhook.
create or replace function public.finalize_site_checkout_paid(
  p_checkout_id uuid,
  p_confirmed_by text,
  p_provider_ref text default null,
  p_stripe_session_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.site_checkout_sessions%rowtype;
  v_order public.orders%rowtype;
  v_method text;
  v_coupon public.coupons%rowtype;
  item jsonb;
begin
  select * into c
    from public.site_checkout_sessions
   where id = p_checkout_id
   for update;

  if not found then
    return jsonb_build_object('ok',false,'error','Checkout não encontrado');
  end if;

  if c.order_id is not null then
    return jsonb_build_object('ok',true,'already_created',true,'order_id',c.order_id);
  end if;

  if c.status not in ('created','payment_pending') then
    return jsonb_build_object('ok',false,'error','Checkout não está aguardando pagamento');
  end if;

  if c.expires_at < now() then
    update public.site_checkout_sessions set status='expired',updated_at=now() where id=c.id;
    return jsonb_build_object('ok',false,'error','Checkout expirado');
  end if;

  if coalesce(c.total,0) <= 0 then
    return jsonb_build_object('ok',false,'error','Total inválido');
  end if;

  v_method := case when c.payment_kind='stripe_pix' then 'pix' else 'card' end;

  insert into public.orders(
    source,customer_name,customer_phone,delivery_mode,
    address_street,address_number,address_complement,address_neighborhood,address_city,address_cep,
    payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,
    status,payment_status,payment_confirmed_at,payment_confirmed_by,payment_link
  ) values (
    'site',
    c.customer_name,
    c.customer_phone,
    coalesce(c.order_data->>'delivery_mode','delivery'),
    nullif(c.order_data->>'address_street',''),
    nullif(c.order_data->>'address_number',''),
    nullif(c.order_data->>'address_complement',''),
    nullif(c.order_data->>'address_neighborhood',''),
    nullif(c.order_data->>'address_city',''),
    nullif(c.order_data->>'address_cep',''),
    v_method::public.payment_method,
    'now',
    null,
    null,
    c.subtotal,
    c.delivery_fee,
    c.coupon_code,
    c.coupon_discount,
    c.total,
    'pending',
    'paid',
    now(),
    p_confirmed_by,
    p_provider_ref
  ) returning * into v_order;

  for item in select * from jsonb_array_elements(c.items) loop
    insert into public.order_items(
      order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes
    ) values (
      v_order.id,
      (item->>'product_id')::uuid,
      item->>'product_name',
      greatest(coalesce((item->>'qty')::int,1),1),
      coalesce((item->>'unit_price')::numeric,0),
      nullif(item->>'list_price','')::numeric,
      coalesce((item->>'is_promotion_price')::boolean,false),
      nullif(item->>'notes','')
    );
  end loop;

  -- O cupom só é consumido quando o pagamento foi realmente confirmado.
  if c.coupon_code is not null and coalesce(c.coupon_discount,0) > 0 then
    select * into v_coupon from public.coupons where upper(code)=upper(c.coupon_code) limit 1;
    if found then
      update public.coupons set usage_count=coalesce(usage_count,0)+1,updated_at=now() where id=v_coupon.id;
      insert into public.coupon_redemptions(
        coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total
      ) values (
        v_coupon.id,v_order.id,c.customer_phone,c.coupon_discount,c.subtotal,c.total
      ) on conflict(order_id) do nothing;
    end if;
  end if;

  update public.site_checkout_sessions
     set status='paid',
         paid_at=now(),
         order_id=v_order.id,
         stripe_session_id=coalesce(p_stripe_session_id,stripe_session_id),
         stripe_payment_intent_id=coalesce(p_provider_ref,stripe_payment_intent_id),
         updated_at=now()
   where id=c.id;

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order.id,
    'order_number',v_order.order_number,
    'payment_method',v_method,
    'payment_status','paid'
  );
end $$;

revoke all on function public.finalize_site_checkout_paid(uuid,text,text,text) from public, anon, authenticated;

comment on table public.site_checkout_sessions is
'Carrinhos/checkout do cardápio digital antes do pagamento. Só viram orders após webhook Stripe confirmar pagamento.';

-- HotBox Delivery — cardápio de alta conversão: adicionais, order bumps e pagamento na entrega
-- Preserva gateways online, Clube HotBox, taxa por bairro/km e fluxo WhatsApp/manual.

begin;

-- -----------------------------------------------------------------------------
-- PAGAMENTO NA ENTREGA (cardápio digital)
-- -----------------------------------------------------------------------------
alter table public.store_config add column if not exists digital_menu_pay_on_delivery_enabled boolean not null default false;
alter table public.store_config add column if not exists digital_menu_pay_on_delivery_card_enabled boolean not null default true;
alter table public.store_config add column if not exists digital_menu_pay_on_delivery_pix_enabled boolean not null default true;

-- -----------------------------------------------------------------------------
-- ADICIONAIS / COMPLEMENTOS
-- -----------------------------------------------------------------------------
create table if not exists public.menu_addon_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_addon_groups_limits_ck check (min_select >= 0 and max_select >= 1 and min_select <= max_select)
);

create table if not exists public.menu_addon_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_addon_groups(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_addon_options_price_ck check (price >= 0)
);

create table if not exists public.product_addon_groups (
  product_id uuid not null references public.products(id) on delete cascade,
  group_id uuid not null references public.menu_addon_groups(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, group_id)
);

create index if not exists idx_menu_addon_options_group on public.menu_addon_options(group_id, sort_order, name);
create index if not exists idx_product_addon_groups_product on public.product_addon_groups(product_id, sort_order);

-- -----------------------------------------------------------------------------
-- ORDER BUMPS / OFERTAS DE 1 CLIQUE
-- -----------------------------------------------------------------------------
create table if not exists public.menu_order_bumps (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  title text not null default 'Complete seu pedido',
  subtitle text,
  placement text not null default 'cart',
  price_override numeric(10,2),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_order_bumps_placement_ck check (placement in ('cart','checkout')),
  constraint menu_order_bumps_price_ck check (price_override is null or price_override >= 0)
);
create index if not exists idx_menu_order_bumps_active on public.menu_order_bumps(active, placement, sort_order);

-- -----------------------------------------------------------------------------
-- RLS: admin gerencia; público só enxerga estruturas ativas.
-- -----------------------------------------------------------------------------
alter table public.menu_addon_groups enable row level security;
alter table public.menu_addon_options enable row level security;
alter table public.product_addon_groups enable row level security;
alter table public.menu_order_bumps enable row level security;

drop policy if exists "public read active addon groups" on public.menu_addon_groups;
create policy "public read active addon groups" on public.menu_addon_groups
for select to anon, authenticated using (active = true);

drop policy if exists "public read active addon options" on public.menu_addon_options;
create policy "public read active addon options" on public.menu_addon_options
for select to anon, authenticated using (active = true);

drop policy if exists "public read product addon map" on public.product_addon_groups;
create policy "public read product addon map" on public.product_addon_groups
for select to anon, authenticated using (true);

drop policy if exists "public read active order bumps" on public.menu_order_bumps;
create policy "public read active order bumps" on public.menu_order_bumps
for select to anon, authenticated using (active = true);

-- Escrita pelo painel autenticado. O painel já é protegido pela rota de admin.
drop policy if exists "authenticated manage addon groups" on public.menu_addon_groups;
create policy "authenticated manage addon groups" on public.menu_addon_groups for all to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));
drop policy if exists "authenticated manage addon options" on public.menu_addon_options;
create policy "authenticated manage addon options" on public.menu_addon_options for all to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));
drop policy if exists "authenticated manage product addon map" on public.product_addon_groups;
create policy "authenticated manage product addon map" on public.product_addon_groups for all to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));
drop policy if exists "authenticated manage order bumps" on public.menu_order_bumps;
create policy "authenticated manage order bumps" on public.menu_order_bumps for all to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));

grant select on public.menu_addon_groups, public.menu_addon_options, public.product_addon_groups, public.menu_order_bumps to anon, authenticated;
grant insert, update, delete on public.menu_addon_groups, public.menu_addon_options, public.product_addon_groups, public.menu_order_bumps to authenticated;
grant all on public.menu_addon_groups, public.menu_addon_options, public.product_addon_groups, public.menu_order_bumps to service_role;

-- -----------------------------------------------------------------------------
-- CHECKOUT: novos tipos de pagamento e status de pedido criado sem quitação.
-- -----------------------------------------------------------------------------
alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_provider_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_provider_ck
  check (payment_provider is null or payment_provider in ('infinitepay','mercadopago','stripe','pay_on_delivery'));

alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_kind_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_kind_ck
  check (payment_kind in (
    'stripe_card','stripe_pix','infinitepay','infinitepay_card','infinitepay_pix',
    'mercadopago','mercadopago_card','mercadopago_pix','delivery_card','delivery_pix'
  ));

alter table public.site_checkout_sessions drop constraint if exists site_checkout_status_ck;
alter table public.site_checkout_sessions add constraint site_checkout_status_ck
  check (status in ('created','payment_pending','paid','ordered','expired','payment_failed','cancelled'));

-- Configuração pública segura dos pagamentos. Nunca expõe access token.
create or replace function public.get_public_payment_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'provider', coalesce(digital_payment_provider,'infinitepay'),
    'payment_available', case
      when digital_payment_provider='mercadopago'
        then mercadopago_enabled=true
             and coalesce(trim(mercadopago_public_key),'')<>''
             and coalesce(trim(mercadopago_access_token),'')<>''
      else infinitepay_enabled=true and coalesce(trim(infinitepay_handle),'')<>''
    end,
    'mercadopago_enabled', mercadopago_enabled=true,
    'infinitepay_enabled', infinitepay_enabled=true,
    'mercadopago_public_key', case when mercadopago_enabled=true then coalesce(mercadopago_public_key,'') else '' end,
    'mercadopago_max_installments', greatest(1,least(12,coalesce(mercadopago_max_installments,1))),
    'pay_on_delivery_enabled', coalesce(digital_menu_pay_on_delivery_enabled,false),
    'pay_on_delivery_card_enabled', coalesce(digital_menu_pay_on_delivery_card_enabled,true),
    'pay_on_delivery_pix_enabled', coalesce(digital_menu_pay_on_delivery_pix_enabled,true)
  )
  from public.store_config
  where id=1;
$$;
revoke all on function public.get_public_payment_config() from public;
grant execute on function public.get_public_payment_config() to anon, authenticated, service_role;

-- Cria o pedido imediatamente quando o cliente escolhe pagamento na entrega.
-- O pedido nasce NÃO PAGO e com payment_timing='delivery'.
create or replace function public.finalize_site_checkout_pay_on_delivery(
  p_checkout_id uuid,
  p_method text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.site_checkout_sessions%rowtype;
  v_order public.orders%rowtype;
  v_coupon public.coupons%rowtype;
  item jsonb;
  v_method text;
begin
  v_method := lower(coalesce(p_method,''));
  if v_method not in ('card','pix') then
    return jsonb_build_object('ok',false,'error','Forma de pagamento na entrega inválida');
  end if;

  select * into c from public.site_checkout_sessions where id=p_checkout_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Checkout não encontrado'); end if;
  if c.order_id is not null then return jsonb_build_object('ok',true,'already_created',true,'order_id',c.order_id); end if;
  if c.status not in ('created','payment_pending') then return jsonb_build_object('ok',false,'error','Checkout indisponível'); end if;
  if c.expires_at < now() then
    update public.site_checkout_sessions set status='expired',updated_at=now() where id=c.id;
    return jsonb_build_object('ok',false,'error','Checkout expirado');
  end if;
  if coalesce(c.total,0) <= 0 then return jsonb_build_object('ok',false,'error','Total inválido'); end if;

  if c.loyalty_reward_id is not null and not exists(
    select 1 from public.loyalty_rewards r
    where r.id=c.loyalty_reward_id and r.user_id=c.customer_user_id and r.status='reserved' and r.checkout_id=c.id
  ) then
    return jsonb_build_object('ok',false,'error','Recompensa de fidelidade não está reservada para este checkout');
  end if;

  insert into public.orders(
    source,customer_name,customer_phone,delivery_mode,
    address_street,address_number,address_complement,address_neighborhood,address_city,address_cep,
    payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,
    status,payment_status,payment_confirmed_at,payment_confirmed_by,payment_link,
    customer_user_id,loyalty_reward_id,loyalty_reward_used
  ) values (
    'site',c.customer_name,c.customer_phone,coalesce(c.order_data->>'delivery_mode','delivery'),
    nullif(c.order_data->>'address_street',''),nullif(c.order_data->>'address_number',''),
    nullif(c.order_data->>'address_complement',''),nullif(c.order_data->>'address_neighborhood',''),
    nullif(c.order_data->>'address_city',''),nullif(c.order_data->>'address_cep',''),
    v_method::public.payment_method,'delivery',null,null,
    c.subtotal,c.delivery_fee,c.coupon_code,c.coupon_discount,c.total,
    'pending','pending',null,null,null,
    c.customer_user_id,c.loyalty_reward_id,(c.loyalty_reward_id is not null)
  ) returning * into v_order;

  for item in select * from jsonb_array_elements(c.items) loop
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes)
    values(
      v_order.id,(item->>'product_id')::uuid,item->>'product_name',greatest(coalesce((item->>'qty')::int,1),1),
      coalesce((item->>'unit_price')::numeric,0),nullif(item->>'list_price','')::numeric,
      coalesce((item->>'is_promotion_price')::boolean,false),nullif(item->>'notes','')
    );
  end loop;

  if c.coupon_code is not null and coalesce(c.coupon_discount,0)>0 then
    select * into v_coupon from public.coupons where upper(code)=upper(c.coupon_code) limit 1;
    if found then
      update public.coupons
         set usage_count=coalesce(usage_count,0)+1,
             active=case when c.loyalty_reward_id is not null then false else active end,
             updated_at=now()
       where id=v_coupon.id;
      insert into public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total)
      values(v_coupon.id,v_order.id,c.customer_phone,c.coupon_discount,c.subtotal,c.total)
      on conflict(order_id) do nothing;
    end if;
  end if;

  if c.loyalty_reward_id is not null then
    update public.loyalty_rewards
       set status='redeemed',redeemed_at=now(),redeemed_order_id=v_order.id,updated_at=now()
     where id=c.loyalty_reward_id and status='reserved' and checkout_id=c.id;
    update public.loyalty_accounts
       set rewards_redeemed=rewards_redeemed+1,updated_at=now()
     where user_id=c.customer_user_id;
    insert into public.loyalty_ledger(user_id,order_id,reward_id,event_type,points_delta,description)
    values(c.customer_user_id,v_order.id,c.loyalty_reward_id,'reward_redeemed',0,'Cupom de batata grátis utilizado');
  end if;

  update public.site_checkout_sessions
     set status='ordered',order_id=v_order.id,updated_at=now()
   where id=c.id;

  return jsonb_build_object('ok',true,'order_id',v_order.id,'order_number',v_order.order_number,'payment_method',v_method,'payment_status','pending','payment_timing','delivery');
end;
$$;
revoke all on function public.finalize_site_checkout_pay_on_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_site_checkout_pay_on_delivery(uuid,text) to service_role;

commit;

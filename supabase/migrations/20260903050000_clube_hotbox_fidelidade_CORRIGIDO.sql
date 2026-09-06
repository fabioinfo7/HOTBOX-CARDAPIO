-- HotBox Delivery — Clube HotBox / fidelidade do cardápio digital
-- Login é OPCIONAL. Somente compras feitas logado no cardápio digital acumulam fidelidade.
-- A cada 10 pedidos pagos + entregues, o cliente recebe 1 cupom individual para 1 batata grátis.
-- O cupom desconta 1 unidade de produto marcado como loyalty_eligible e o cliente paga a entrega.

begin;
create extension if not exists pgcrypto;

alter table public.store_config add column if not exists loyalty_enabled boolean not null default true;
alter table public.store_config add column if not exists loyalty_orders_required integer not null default 10;

alter table public.products add column if not exists loyalty_eligible boolean not null default false;
-- Backfill conservador: produtos de alimentação entram; bebidas ficam de fora.
update public.products
set loyalty_eligible = true
where loyalty_eligible = false
  and lower(coalesce(kind::text,'')) not in ('drink','beverage','bebida','refrigerante')
  and lower(coalesce(category,'')) not like '%bebida%'
  and lower(coalesce(category,'')) not like '%refrigerante%';

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  lifetime_qualifying_orders integer not null default 0 check (lifetime_qualifying_orders >= 0),
  rewards_earned integer not null default 0 check (rewards_earned >= 0),
  rewards_redeemed integer not null default 0 check (rewards_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coupon_id uuid references public.coupons(id) on delete set null,
  code text not null unique,
  status text not null default 'available' check (status in ('available','reserved','redeemed','cancelled')),
  checkout_id uuid references public.site_checkout_sessions(id) on delete set null,
  earned_at timestamptz not null default now(),
  reserved_at timestamptz,
  redeemed_at timestamptz,
  redeemed_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  reward_id uuid references public.loyalty_rewards(id) on delete set null,
  event_type text not null check (event_type in ('order_completed','reward_issued','reward_redeemed','adjustment')),
  points_delta integer not null default 0,
  description text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_loyalty_ledger_order_once
  on public.loyalty_ledger(order_id)
  where event_type='order_completed' and order_id is not null;
create index if not exists idx_loyalty_rewards_user_status on public.loyalty_rewards(user_id,status,earned_at desc);
create index if not exists idx_loyalty_ledger_user on public.loyalty_ledger(user_id,created_at desc);

alter table public.site_checkout_sessions add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
alter table public.site_checkout_sessions add column if not exists loyalty_reward_id uuid references public.loyalty_rewards(id) on delete set null;
alter table public.orders add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists loyalty_reward_id uuid references public.loyalty_rewards(id) on delete set null;
alter table public.orders add column if not exists loyalty_reward_used boolean not null default false;

alter table public.customer_profiles enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_ledger enable row level security;

-- O próprio cliente pode ler apenas os seus dados; escritas ficam no backend/service_role.
drop policy if exists customer_profiles_self_read on public.customer_profiles;
create policy customer_profiles_self_read on public.customer_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists loyalty_accounts_self_read on public.loyalty_accounts;
create policy loyalty_accounts_self_read on public.loyalty_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists loyalty_rewards_self_read on public.loyalty_rewards;
create policy loyalty_rewards_self_read on public.loyalty_rewards for select to authenticated using (user_id = auth.uid());
drop policy if exists loyalty_ledger_self_read on public.loyalty_ledger;
create policy loyalty_ledger_self_read on public.loyalty_ledger for select to authenticated using (user_id = auth.uid());

create or replace function public.release_stale_loyalty_rewards(p_user_id uuid)
returns integer
language plpgsql security definer set search_path=public as $$
declare v_rows integer := 0;
begin
  update public.loyalty_rewards r
     set status='available',checkout_id=null,reserved_at=null,updated_at=now()
   where r.user_id=p_user_id
     and r.status='reserved'
     and exists (
       select 1 from public.site_checkout_sessions c
       where c.id=r.checkout_id
         and c.status <> 'paid'
         and c.expires_at < now()
     );
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function public.release_stale_loyalty_rewards(uuid) from public,anon,authenticated;
grant execute on function public.release_stale_loyalty_rewards(uuid) to service_role;

create or replace function public.reserve_loyalty_reward(
  p_reward_id uuid,
  p_checkout_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_rows integer := 0;
begin
  update public.loyalty_rewards
     set status='reserved',checkout_id=p_checkout_id,reserved_at=now(),updated_at=now()
   where id=p_reward_id and user_id=p_user_id and status='available';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function public.reserve_loyalty_reward(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_loyalty_reward(uuid,uuid,uuid) to service_role;

create or replace function public.release_loyalty_reward_for_checkout()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.loyalty_reward_id is not null
     and new.status in ('expired','payment_failed','cancelled')
     and old.status is distinct from new.status then
    update public.loyalty_rewards
       set status='available',checkout_id=null,reserved_at=null,updated_at=now()
     where id=new.loyalty_reward_id and status='reserved';
  end if;
  return new;
end $$;
drop trigger if exists trg_release_loyalty_reward_checkout on public.site_checkout_sessions;
create trigger trg_release_loyalty_reward_checkout
after update of status on public.site_checkout_sessions
for each row execute function public.release_loyalty_reward_for_checkout();

create or replace function public.process_loyalty_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  o public.orders%rowtype;
  v_required integer;
  v_inserted integer := 0;
  v_points integer := 0;
  v_code text;
  v_coupon_id uuid;
  v_reward_id uuid;
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then return; end if;
  if o.source <> 'site' or o.customer_user_id is null or o.status <> 'delivered' or o.payment_status <> 'paid' then return; end if;
  if coalesce(o.loyalty_reward_used,false) then return; end if;
  if not coalesce((select loyalty_enabled from public.store_config where id=1),true) then return; end if;

  insert into public.loyalty_accounts(user_id) values(o.customer_user_id) on conflict(user_id) do nothing;
  insert into public.loyalty_ledger(user_id,order_id,event_type,points_delta,description)
  values(o.customer_user_id,o.id,'order_completed',1,'Pedido do cardápio digital concluído')
  on conflict(order_id) where event_type='order_completed' and order_id is not null do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  update public.loyalty_accounts
     set points=points+1,lifetime_qualifying_orders=lifetime_qualifying_orders+1,updated_at=now()
   where user_id=o.customer_user_id
   returning points into v_points;

  v_required := greatest(1,coalesce((select loyalty_orders_required from public.store_config where id=1),10));
  if v_points >= v_required then
    loop
      v_code := 'HB-FIEL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      exit when not exists(select 1 from public.coupons where upper(code)=upper(v_code))
                and not exists(select 1 from public.loyalty_rewards where upper(code)=upper(v_code));
    end loop;

    insert into public.coupons(
      code,description,discount_type,discount_value,active,usage_limit,usage_count,max_uses_per_customer,
      first_order_only,min_order_value,allow_promotion_stack,valid_from,valid_until
    ) values (
      v_code,'Clube HotBox — 1 batata grátis','fixed',0,true,1,0,1,false,0,false,now(),null
    ) returning id into v_coupon_id;

    insert into public.loyalty_rewards(user_id,coupon_id,code,status)
    values(o.customer_user_id,v_coupon_id,v_code,'available') returning id into v_reward_id;

    update public.loyalty_accounts
       set points=points-v_required,rewards_earned=rewards_earned+1,updated_at=now()
     where user_id=o.customer_user_id;

    insert into public.loyalty_ledger(user_id,reward_id,event_type,points_delta,description)
    values(o.customer_user_id,v_reward_id,'reward_issued',-v_required,'Cupom de 1 batata grátis desbloqueado');
  end if;
end $$;
revoke all on function public.process_loyalty_order(uuid) from public,anon,authenticated;
grant execute on function public.process_loyalty_order(uuid) to service_role;

create or replace function public.trg_process_loyalty_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='delivered' and new.payment_status='paid' then
    perform public.process_loyalty_order(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_process_loyalty_order on public.orders;
create trigger trg_process_loyalty_order
after insert or update of status,payment_status on public.orders
for each row execute function public.trg_process_loyalty_order();

-- Finalização do checkout preservada + vínculo com a conta e recompensa de fidelidade.
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
  select * into c from public.site_checkout_sessions where id = p_checkout_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Checkout não encontrado'); end if;
  if c.order_id is not null then return jsonb_build_object('ok',true,'already_created',true,'order_id',c.order_id); end if;
  if c.status not in ('created','payment_pending') then return jsonb_build_object('ok',false,'error','Checkout não está aguardando pagamento'); end if;
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

  v_method := case when c.payment_kind in ('stripe_pix','infinitepay_pix') then 'pix' else 'card' end;

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
    v_method::public.payment_method,'now',null,null,
    c.subtotal,c.delivery_fee,c.coupon_code,c.coupon_discount,c.total,
    'pending','paid',now(),p_confirmed_by,
    coalesce(c.infinitepay_receipt_url,p_provider_ref),
    c.customer_user_id,c.loyalty_reward_id,(c.loyalty_reward_id is not null)
  ) returning * into v_order;

  for item in select * from jsonb_array_elements(c.items) loop
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes)
    values (
      v_order.id,(item->>'product_id')::uuid,item->>'product_name',greatest(coalesce((item->>'qty')::int,1),1),
      coalesce((item->>'unit_price')::numeric,0),nullif(item->>'list_price','')::numeric,
      coalesce((item->>'is_promotion_price')::boolean,false),nullif(item->>'notes','')
    );
  end loop;

  if c.coupon_code is not null and coalesce(c.coupon_discount,0) > 0 then
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
     set status='paid',paid_at=now(),order_id=v_order.id,
         stripe_session_id=coalesce(p_stripe_session_id,stripe_session_id),
         stripe_payment_intent_id=case when p_confirmed_by='stripe' then coalesce(p_provider_ref,stripe_payment_intent_id) else stripe_payment_intent_id end,
         updated_at=now()
   where id=c.id;

  return jsonb_build_object('ok',true,'order_id',v_order.id,'order_number',v_order.order_number,'payment_method',v_method,'payment_status','paid');
end $$;
revoke all on function public.finalize_site_checkout_paid(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_site_checkout_paid(uuid,text,text,text) to service_role;

commit;

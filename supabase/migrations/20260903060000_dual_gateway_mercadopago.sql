-- HotBox Delivery — Duplo gateway: Mercado Pago + InfinitePay
-- Objetivos:
-- 1) manter a InfinitePay instalada e funcional;
-- 2) adicionar Mercado Pago Checkout Transparente;
-- 3) permitir troca MANUAL do provedor ativo pelo painel;
-- 4) preservar histórico e evitar pedido antes da confirmação real do pagamento;
-- 5) atualizar Recebimentos do Cardápio Digital para os dois provedores.

begin;

-- -----------------------------------------------------------------------------
-- CONFIGURAÇÃO DOS PROVEDORES
-- -----------------------------------------------------------------------------
alter table public.store_config add column if not exists digital_payment_provider text not null default 'infinitepay';
alter table public.store_config drop constraint if exists store_config_digital_payment_provider_ck;
alter table public.store_config add constraint store_config_digital_payment_provider_ck
  check (digital_payment_provider in ('infinitepay','mercadopago'));

alter table public.store_config add column if not exists mercadopago_enabled boolean not null default false;
alter table public.store_config add column if not exists mercadopago_public_key text;
alter table public.store_config add column if not exists mercadopago_access_token text;
alter table public.store_config add column if not exists mercadopago_webhook_token text;
alter table public.store_config add column if not exists mercadopago_max_installments smallint not null default 1;

update public.store_config
   set mercadopago_webhook_token = replace(gen_random_uuid()::text,'-','')
 where id = 1 and coalesce(mercadopago_webhook_token,'') = '';

update public.store_config
   set mercadopago_max_installments = greatest(1,least(12,coalesce(mercadopago_max_installments,1)))
 where id = 1;

-- Configuração pública mínima. NUNCA retorna Access Token nem token do webhook.
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
    'mercadopago_max_installments', greatest(1,least(12,coalesce(mercadopago_max_installments,1)))
  )
  from public.store_config
  where id=1;
$$;
revoke all on function public.get_public_payment_config() from public;
grant execute on function public.get_public_payment_config() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- CHECKOUT / AUDITORIA MERCADO PAGO
-- -----------------------------------------------------------------------------
alter table public.site_checkout_sessions add column if not exists payment_provider text;
alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_provider_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_provider_ck
  check (payment_provider is null or payment_provider in ('infinitepay','mercadopago','stripe'));

update public.site_checkout_sessions
   set payment_provider='infinitepay'
 where payment_provider is null
   and payment_kind in ('infinitepay','infinitepay_card','infinitepay_pix');
update public.site_checkout_sessions
   set payment_provider='stripe'
 where payment_provider is null
   and payment_kind in ('stripe_card','stripe_pix');

alter table public.site_checkout_sessions add column if not exists mercadopago_payment_id text;
alter table public.site_checkout_sessions add column if not exists mercadopago_attempt_no integer not null default 1;
alter table public.site_checkout_sessions add column if not exists mercadopago_status text;
alter table public.site_checkout_sessions add column if not exists mercadopago_status_detail text;
alter table public.site_checkout_sessions add column if not exists mercadopago_payment_method_id text;
alter table public.site_checkout_sessions add column if not exists mercadopago_payment_type_id text;
alter table public.site_checkout_sessions add column if not exists mercadopago_installments smallint;
alter table public.site_checkout_sessions add column if not exists mercadopago_transaction_amount numeric(12,2);
alter table public.site_checkout_sessions add column if not exists mercadopago_net_received_amount numeric(12,2);
alter table public.site_checkout_sessions add column if not exists mercadopago_fee_amount numeric(12,2);
alter table public.site_checkout_sessions add column if not exists mercadopago_qr_code text;
alter table public.site_checkout_sessions add column if not exists mercadopago_qr_code_base64 text;
alter table public.site_checkout_sessions add column if not exists mercadopago_ticket_url text;
alter table public.site_checkout_sessions add column if not exists mercadopago_verified_at timestamptz;
alter table public.site_checkout_sessions add column if not exists mercadopago_webhook_payload jsonb;
alter table public.site_checkout_sessions add column if not exists mercadopago_verification_payload jsonb;

create unique index if not exists idx_site_checkout_mercadopago_payment
  on public.site_checkout_sessions(mercadopago_payment_id)
  where mercadopago_payment_id is not null;
create index if not exists idx_site_checkout_provider_paid
  on public.site_checkout_sessions(payment_provider,paid_at desc)
  where status='paid';

alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_kind_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_kind_ck
  check (payment_kind in (
    'stripe_card','stripe_pix',
    'infinitepay','infinitepay_card','infinitepay_pix',
    'mercadopago','mercadopago_card','mercadopago_pix'
  ));

-- -----------------------------------------------------------------------------
-- FINALIZAÇÃO CANÔNICA DO PEDIDO
-- Mantém fidelidade/cupom e passa a reconhecer Mercado Pago.
-- -----------------------------------------------------------------------------
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
  v_payment_link text;
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

  v_method := case
    when c.payment_kind in ('stripe_pix','infinitepay_pix','mercadopago_pix') then 'pix'
    else 'card'
  end;

  v_payment_link := case
    when p_confirmed_by='infinitepay' then coalesce(c.infinitepay_receipt_url,p_provider_ref)
    when p_confirmed_by='mercadopago' then c.mercadopago_ticket_url
    else p_provider_ref
  end;

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
    'pending','paid',now(),p_confirmed_by,v_payment_link,
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

-- -----------------------------------------------------------------------------
-- RECEBIMENTOS DO CARDÁPIO DIGITAL — AMBOS OS PROVEDORES
-- -----------------------------------------------------------------------------
drop function if exists public.digital_menu_finance_summary(timestamptz,timestamptz,text);
drop function if exists public.digital_menu_finance_summary(timestamptz,timestamptz,text,text);
create function public.digital_menu_finance_summary(
  p_since timestamptz,
  p_until timestamptz,
  p_payment_kind text,
  p_provider text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      total,
      payment_kind,
      coalesce(payment_provider,
        case when payment_kind like 'mercadopago%' then 'mercadopago'
             when payment_kind like 'infinitepay%' then 'infinitepay'
             else null end) as provider,
      case
        when payment_kind like 'mercadopago%' then coalesce(mercadopago_transaction_amount,total)
        else coalesce(infinitepay_amount_cents,round(total*100)::integer)/100.0
      end as amount,
      case
        when payment_kind like 'mercadopago%' then coalesce(mercadopago_transaction_amount,total)
        else coalesce(infinitepay_paid_amount_cents,infinitepay_amount_cents,round(total*100)::integer)/100.0
      end as paid_amount
    from public.site_checkout_sessions
    where status='paid'
      and payment_kind in ('infinitepay','infinitepay_card','infinitepay_pix','mercadopago','mercadopago_card','mercadopago_pix')
      and finance_hidden_at is null
      and (p_since is null or paid_at>=p_since)
      and (p_until is null or paid_at<=p_until)
      and (
        p_payment_kind is null or p_payment_kind='all'
        or (p_payment_kind='pix' and payment_kind in ('infinitepay_pix','mercadopago_pix'))
        or (p_payment_kind='card' and payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card'))
      )
      and (
        p_provider is null or p_provider='all'
        or (p_provider='infinitepay' and payment_kind in ('infinitepay','infinitepay_card','infinitepay_pix'))
        or (p_provider='mercadopago' and payment_kind in ('mercadopago','mercadopago_card','mercadopago_pix'))
      )
  )
  select jsonb_build_object(
    'transactions',count(*),
    'sales_total',coalesce(sum(amount),0),
    'customer_paid_total',coalesce(sum(paid_amount),0),
    'pix_total',coalesce(sum(case when payment_kind in ('infinitepay_pix','mercadopago_pix') then amount else 0 end),0),
    'pix_count',count(*) filter(where payment_kind in ('infinitepay_pix','mercadopago_pix')),
    'card_total',coalesce(sum(case when payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card') then amount else 0 end),0),
    'card_count',count(*) filter(where payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card')),
    'mercadopago_total',coalesce(sum(case when provider='mercadopago' then amount else 0 end),0),
    'mercadopago_count',count(*) filter(where provider='mercadopago'),
    'infinitepay_total',coalesce(sum(case when provider='infinitepay' then amount else 0 end),0),
    'infinitepay_count',count(*) filter(where provider='infinitepay')
  ) from base;
$$;
revoke all on function public.digital_menu_finance_summary(timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.digital_menu_finance_summary(timestamptz,timestamptz,text,text) to service_role;

-- Compatibilidade temporária com a versão anterior do painel durante o deploy.
create function public.digital_menu_finance_summary(
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_payment_kind text default null
) returns jsonb
language sql stable security definer set search_path=public as $$
  select public.digital_menu_finance_summary(p_since,p_until,p_payment_kind,'all');
$$;
revoke all on function public.digital_menu_finance_summary(timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.digital_menu_finance_summary(timestamptz,timestamptz,text) to service_role;

commit;

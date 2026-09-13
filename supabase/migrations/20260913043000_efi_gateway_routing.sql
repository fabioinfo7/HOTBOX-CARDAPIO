-- HotBox Delivery — Efí Bank + roteamento independente Pix/Cartão
begin;

-- Adiciona Efí às opções de roteamento já existentes.
alter table public.store_config drop constraint if exists store_config_digital_payment_provider_ck;
alter table public.store_config add constraint store_config_digital_payment_provider_ck
  check (digital_payment_provider in ('infinitepay','mercadopago','pagarme','efi','appmax'));
alter table public.store_config drop constraint if exists store_config_digital_pix_provider_ck;
alter table public.store_config add constraint store_config_digital_pix_provider_ck
  check (digital_pix_provider is null or digital_pix_provider in ('infinitepay','mercadopago','pagarme','efi','appmax'));
alter table public.store_config drop constraint if exists store_config_digital_card_provider_ck;
alter table public.store_config add constraint store_config_digital_card_provider_ck
  check (digital_card_provider is null or digital_card_provider in ('infinitepay','mercadopago','pagarme','efi','appmax'));

-- Efí API Cobranças + API Pix.
alter table public.store_config add column if not exists efi_enabled boolean not null default false;
alter table public.store_config add column if not exists efi_environment text not null default 'sandbox';
alter table public.store_config add column if not exists efi_client_id text;
alter table public.store_config add column if not exists efi_client_secret text;
alter table public.store_config add column if not exists efi_payee_code text;
alter table public.store_config add column if not exists efi_pix_key text;
alter table public.store_config add column if not exists efi_pix_certificate_base64 text;
alter table public.store_config add column if not exists efi_pix_certificate_password text;
alter table public.store_config add column if not exists efi_webhook_token text;
alter table public.store_config add column if not exists efi_max_installments smallint not null default 1;
update public.store_config set efi_webhook_token=coalesce(nullif(efi_webhook_token,''),gen_random_uuid()::text) where id=1;
alter table public.store_config drop constraint if exists store_config_efi_environment_ck;
alter table public.store_config add constraint store_config_efi_environment_ck check (efi_environment in ('sandbox','production'));
alter table public.store_config drop constraint if exists store_config_efi_max_installments_ck;
alter table public.store_config add constraint store_config_efi_max_installments_ck check (efi_max_installments between 1 and 12);

-- Auditoria da Efí no checkout.
alter table public.site_checkout_sessions add column if not exists efi_charge_id text;
alter table public.site_checkout_sessions add column if not exists efi_txid text;
alter table public.site_checkout_sessions add column if not exists efi_status text;
alter table public.site_checkout_sessions add column if not exists efi_qr_code text;
alter table public.site_checkout_sessions add column if not exists efi_qr_code_url text;
alter table public.site_checkout_sessions add column if not exists efi_payment_url text;
alter table public.site_checkout_sessions add column if not exists efi_attempt_no integer not null default 0;
alter table public.site_checkout_sessions add column if not exists efi_verified_at timestamptz;
alter table public.site_checkout_sessions add column if not exists efi_webhook_payload jsonb;
alter table public.site_checkout_sessions add column if not exists efi_verification_payload jsonb;
create unique index if not exists idx_site_checkout_efi_charge on public.site_checkout_sessions(efi_charge_id) where efi_charge_id is not null;
create unique index if not exists idx_site_checkout_efi_txid on public.site_checkout_sessions(efi_txid) where efi_txid is not null;

alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_provider_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_provider_ck
  check (payment_provider is null or payment_provider in ('infinitepay','mercadopago','pagarme','efi','appmax','stripe','pay_on_delivery'));
alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_kind_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_kind_ck
  check (payment_kind in (
    'stripe_card','stripe_pix',
    'infinitepay','infinitepay_card','infinitepay_pix',
    'mercadopago','mercadopago_card','mercadopago_pix',
    'pagarme','pagarme_card','pagarme_pix',
    'efi','efi_card','efi_pix',
    'appmax','appmax_card','appmax_pix',
    'delivery_card','delivery_pix'
  ));

-- Config pública: nunca expõe Client Secret nem certificado.
create or replace function public.get_public_payment_config()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'provider', coalesce(digital_payment_provider,'infinitepay'),
    'pix_provider', coalesce(digital_pix_provider,digital_payment_provider,'infinitepay'),
    'card_provider', coalesce(digital_card_provider,digital_payment_provider,'infinitepay'),
    'pix_payment_available', case coalesce(digital_pix_provider,digital_payment_provider,'infinitepay')
      when 'efi' then efi_enabled=true and coalesce(trim(efi_client_id),'')<>'' and coalesce(trim(efi_client_secret),'')<>'' and coalesce(trim(efi_pix_key),'')<>'' and coalesce(trim(efi_pix_certificate_base64),'')<>''
      when 'pagarme' then pagarme_enabled=true and coalesce(trim(pagarme_public_key),'')<>'' and coalesce(trim(pagarme_secret_key),'')<>''
      when 'mercadopago' then mercadopago_enabled=true and coalesce(trim(mercadopago_public_key),'')<>'' and coalesce(trim(mercadopago_access_token),'')<>''
      when 'appmax' then coalesce(appmax_enabled,false)=true and coalesce(trim(appmax_external_id),'')<>''
      else infinitepay_enabled=true and coalesce(trim(infinitepay_handle),'')<>'' end,
    'card_payment_available', case coalesce(digital_card_provider,digital_payment_provider,'infinitepay')
      when 'efi' then efi_enabled=true and coalesce(trim(efi_client_id),'')<>'' and coalesce(trim(efi_client_secret),'')<>'' and coalesce(trim(efi_payee_code),'')<>''
      when 'pagarme' then pagarme_enabled=true and coalesce(trim(pagarme_public_key),'')<>'' and coalesce(trim(pagarme_secret_key),'')<>''
      when 'mercadopago' then mercadopago_enabled=true and coalesce(trim(mercadopago_public_key),'')<>'' and coalesce(trim(mercadopago_access_token),'')<>''
      when 'appmax' then coalesce(appmax_enabled,false)=true and coalesce(trim(appmax_external_id),'')<>''
      else infinitepay_enabled=true and coalesce(trim(infinitepay_handle),'')<>'' end,
    'payment_available', (
      (coalesce(digital_menu_pix_enabled,true) and case coalesce(digital_pix_provider,digital_payment_provider,'infinitepay')
        when 'efi' then efi_enabled=true and coalesce(trim(efi_client_id),'')<>'' and coalesce(trim(efi_client_secret),'')<>'' and coalesce(trim(efi_pix_key),'')<>'' and coalesce(trim(efi_pix_certificate_base64),'')<>''
        when 'pagarme' then pagarme_enabled=true and coalesce(trim(pagarme_public_key),'')<>'' and coalesce(trim(pagarme_secret_key),'')<>''
        when 'mercadopago' then mercadopago_enabled=true and coalesce(trim(mercadopago_public_key),'')<>'' and coalesce(trim(mercadopago_access_token),'')<>''
        when 'appmax' then coalesce(appmax_enabled,false)=true and coalesce(trim(appmax_external_id),'')<>''
        else infinitepay_enabled=true and coalesce(trim(infinitepay_handle),'')<>'' end)
      or
      (coalesce(digital_menu_card_enabled,true) and case coalesce(digital_card_provider,digital_payment_provider,'infinitepay')
        when 'efi' then efi_enabled=true and coalesce(trim(efi_client_id),'')<>'' and coalesce(trim(efi_client_secret),'')<>'' and coalesce(trim(efi_payee_code),'')<>''
        when 'pagarme' then pagarme_enabled=true and coalesce(trim(pagarme_public_key),'')<>'' and coalesce(trim(pagarme_secret_key),'')<>''
        when 'mercadopago' then mercadopago_enabled=true and coalesce(trim(mercadopago_public_key),'')<>'' and coalesce(trim(mercadopago_access_token),'')<>''
        when 'appmax' then coalesce(appmax_enabled,false)=true and coalesce(trim(appmax_external_id),'')<>''
        else infinitepay_enabled=true and coalesce(trim(infinitepay_handle),'')<>'' end)
    ),
    'mercadopago_enabled', mercadopago_enabled=true,
    'infinitepay_enabled', infinitepay_enabled=true,
    'pagarme_enabled', pagarme_enabled=true,
    'efi_enabled', efi_enabled=true,
    'mercadopago_public_key', case when mercadopago_enabled=true then coalesce(mercadopago_public_key,'') else '' end,
    'mercadopago_max_installments', greatest(1,least(12,coalesce(mercadopago_max_installments,1))),
    'pagarme_public_key', case when pagarme_enabled=true then coalesce(pagarme_public_key,'') else '' end,
    'pagarme_max_installments', greatest(1,least(12,coalesce(pagarme_max_installments,1))),
    'efi_payee_code', case when efi_enabled=true then coalesce(efi_payee_code,'') else '' end,
    'efi_environment', case when efi_environment='production' then 'production' else 'sandbox' end,
    'efi_max_installments', greatest(1,least(12,coalesce(efi_max_installments,1))),
    'appmax_external_id', case when coalesce(appmax_enabled,false)=true then coalesce(appmax_external_id,'') else '' end,
    'appmax_max_installments', greatest(1,least(12,coalesce(appmax_max_installments,1))),
    'pay_on_delivery_enabled', coalesce(digital_menu_pay_on_delivery_enabled,false),
    'pay_on_delivery_card_enabled', coalesce(digital_menu_pay_on_delivery_card_enabled,true),
    'pay_on_delivery_pix_enabled', coalesce(digital_menu_pay_on_delivery_pix_enabled,true)
  ) from public.store_config where id=1;
$$;
revoke all on function public.get_public_payment_config() from public;
grant execute on function public.get_public_payment_config() to anon, authenticated, service_role;


-- Atualiza finalização e financeiro para reconhecer efi_pix/efi_card.
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
    when c.payment_kind in ('stripe_pix','infinitepay_pix','mercadopago_pix','pagarme_pix','efi_pix') then 'pix'
    else 'card'
  end;

  v_payment_link := case
    when p_confirmed_by='infinitepay' then coalesce(c.infinitepay_receipt_url,p_provider_ref)
    when p_confirmed_by='mercadopago' then c.mercadopago_ticket_url
    when p_confirmed_by='pagarme' then p_provider_ref
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
      coalesce(
        payment_provider,
        case
          when payment_kind like 'mercadopago%' then 'mercadopago'
          when payment_kind like 'infinitepay%' then 'infinitepay'
          when payment_kind like 'pagarme%' then 'pagarme'
          when payment_kind like 'efi%' then 'efi'
          when payment_kind like 'appmax%' then 'appmax'
          else null
        end
      ) as provider,
      case
        when payment_kind like 'mercadopago%' then coalesce(mercadopago_transaction_amount,total)
        when payment_kind like 'infinitepay%' then coalesce(infinitepay_amount_cents,round(total*100)::integer)/100.0
        else total
      end as amount,
      case
        when payment_kind like 'mercadopago%' then coalesce(mercadopago_transaction_amount,total)
        when payment_kind like 'infinitepay%' then coalesce(infinitepay_paid_amount_cents,infinitepay_amount_cents,round(total*100)::integer)/100.0
        else total
      end as paid_amount
    from public.site_checkout_sessions
    where status='paid'
      and payment_kind in (
        'infinitepay','infinitepay_card','infinitepay_pix',
        'mercadopago','mercadopago_card','mercadopago_pix',
        'pagarme','pagarme_card','pagarme_pix',
        'efi','efi_card','efi_pix',
        'appmax','appmax_card','appmax_pix'
      )
      and finance_hidden_at is null
      and (p_since is null or paid_at>=p_since)
      and (p_until is null or paid_at<=p_until)
      and (
        p_payment_kind is null or p_payment_kind='all'
        or (p_payment_kind='pix' and payment_kind in ('infinitepay_pix','mercadopago_pix','pagarme_pix','efi_pix','appmax_pix'))
        or (p_payment_kind='card' and payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card','pagarme','pagarme_card','efi','efi_card','appmax','appmax_card'))
      )
  ), filtered as (
    select * from base
    where p_provider is null or p_provider='all' or provider=p_provider
  )
  select jsonb_build_object(
    'transactions',count(*),
    'sales_total',coalesce(sum(amount),0),
    'customer_paid_total',coalesce(sum(paid_amount),0),
    'pix_total',coalesce(sum(case when payment_kind in ('infinitepay_pix','mercadopago_pix','pagarme_pix','efi_pix','appmax_pix') then amount else 0 end),0),
    'pix_count',count(*) filter(where payment_kind in ('infinitepay_pix','mercadopago_pix','pagarme_pix','efi_pix','appmax_pix')),
    'card_total',coalesce(sum(case when payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card','pagarme','pagarme_card','efi','efi_card','appmax','appmax_card') then amount else 0 end),0),
    'card_count',count(*) filter(where payment_kind in ('infinitepay','infinitepay_card','mercadopago','mercadopago_card','pagarme','pagarme_card','efi','efi_card','appmax','appmax_card')),
    'mercadopago_total',coalesce(sum(case when provider='mercadopago' then amount else 0 end),0),
    'mercadopago_count',count(*) filter(where provider='mercadopago'),
    'infinitepay_total',coalesce(sum(case when provider='infinitepay' then amount else 0 end),0),
    'infinitepay_count',count(*) filter(where provider='infinitepay'),
    'pagarme_total',coalesce(sum(case when provider='pagarme' then amount else 0 end),0),
    'pagarme_count',count(*) filter(where provider='pagarme'),
    'efi_total',coalesce(sum(case when provider='efi' then amount else 0 end),0),
    'efi_count',count(*) filter(where provider='efi'),
    'appmax_total',coalesce(sum(case when provider='appmax' then amount else 0 end),0),
    'appmax_count',count(*) filter(where provider='appmax')
  ) from filtered;
$$;
revoke all on function public.digital_menu_finance_summary(timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.digital_menu_finance_summary(timestamptz,timestamptz,text,text) to service_role;

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

commit;

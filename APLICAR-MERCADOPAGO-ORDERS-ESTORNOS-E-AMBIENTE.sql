-- HotBox Delivery — Mercado Pago Orders API + estornos auditáveis
-- Execute UMA VEZ no Supabase > SQL Editor antes do deploy dos arquivos TypeScript.

begin;

create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
-- AMBIENTE MERCADO PAGO: TESTE x PRODUÇÃO
-- -----------------------------------------------------------------------------
alter table public.store_config
  add column if not exists mercadopago_environment text not null default 'test';

alter table public.store_config
  drop constraint if exists store_config_mercadopago_environment_ck;

alter table public.store_config
  add constraint store_config_mercadopago_environment_ck
  check (mercadopago_environment in ('test','production'));

-- Mantém TESTE como padrão seguro em instalações existentes até que o lojista
-- selecione explicitamente Produção no ADM.
update public.store_config
   set mercadopago_environment = 'test'
 where id = 1
   and coalesce(mercadopago_environment,'') not in ('test','production');

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
    'mercadopago_environment', case when mercadopago_environment='production' then 'production' else 'test' end,
    'pay_on_delivery_enabled', coalesce(digital_menu_pay_on_delivery_enabled,false),
    'pay_on_delivery_card_enabled', coalesce(digital_menu_pay_on_delivery_card_enabled,true),
    'pay_on_delivery_pix_enabled', coalesce(digital_menu_pay_on_delivery_pix_enabled,true)
  )
  from public.store_config
  where id=1;
$$;

revoke all on function public.get_public_payment_config() from public;
grant execute on function public.get_public_payment_config() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- ORDERS API: IDs e estados canônicos
-- -----------------------------------------------------------------------------
alter table public.site_checkout_sessions add column if not exists mercadopago_order_id text;
alter table public.site_checkout_sessions add column if not exists mercadopago_order_status text;
alter table public.site_checkout_sessions add column if not exists mercadopago_order_status_detail text;
alter table public.site_checkout_sessions add column if not exists mercadopago_refunded_amount numeric(12,2) not null default 0;
alter table public.site_checkout_sessions add column if not exists mercadopago_refund_status text;
alter table public.site_checkout_sessions add column if not exists mercadopago_refunded_at timestamptz;

create unique index if not exists idx_site_checkout_mercadopago_order
  on public.site_checkout_sessions(mercadopago_order_id)
  where mercadopago_order_id is not null;

-- -----------------------------------------------------------------------------
-- HISTÓRICO DE ESTORNOS
-- -----------------------------------------------------------------------------
create table if not exists public.mercadopago_refunds (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.site_checkout_sessions(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  mercadopago_order_id text not null,
  mercadopago_transaction_id text,
  mercadopago_refund_id text,
  refund_type text not null check (refund_type in ('total','partial')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','processing','processed','failed')),
  idempotency_key text not null,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  response_payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_mp_refunds_idempotency on public.mercadopago_refunds(idempotency_key);
create unique index if not exists idx_mp_refunds_provider_id on public.mercadopago_refunds(mercadopago_refund_id) where mercadopago_refund_id is not null;
create index if not exists idx_mp_refunds_checkout on public.mercadopago_refunds(checkout_id,requested_at desc);
create index if not exists idx_mp_refunds_order on public.mercadopago_refunds(order_id,requested_at desc);

alter table public.mercadopago_refunds enable row level security;
drop policy if exists "mercadopago_refunds_admin_select" on public.mercadopago_refunds;
create policy "mercadopago_refunds_admin_select" on public.mercadopago_refunds
for select to authenticated using (public.has_role(auth.uid(),'store_admin'));
revoke all on public.mercadopago_refunds from anon, authenticated;
grant select on public.mercadopago_refunds to authenticated;
grant all on public.mercadopago_refunds to service_role;

-- O livro-caixa passa a aceitar saída específica de estorno.
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid='public.financial_transactions'::regclass
       and contype='c'
       and pg_get_constraintdef(oid) ilike '%source_type%'
  loop
    execute format('alter table public.financial_transactions drop constraint %I',r.conname);
  end loop;
end $$;
alter table public.financial_transactions add constraint financial_transactions_source_type_ck
  check (source_type in ('order','receivable','expense','manual','adjustment','refund'));

-- -----------------------------------------------------------------------------
-- PAGAMENTO APROVADO NÃO PODE SER PERDIDO POR EXPIRAÇÃO VISUAL DO CHECKOUT.
-- A expiração continua sendo checada ANTES de iniciar uma nova cobrança no backend.
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
  if c.status not in ('created','payment_pending','expired') then return jsonb_build_object('ok',false,'error','Checkout não está aguardando pagamento'); end if;
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
    when p_confirmed_by='mercadopago' then coalesce(c.mercadopago_ticket_url,p_provider_ref)
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
-- CONCILIAÇÃO DO CARDÁPIO DIGITAL NO FINANCEIRO GERAL PARA OS DOIS GATEWAYS.
-- -----------------------------------------------------------------------------
create or replace function public.trg_sync_financial_site_checkout()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_amount numeric(12,2);
  v_method text;
  v_account text;
  v_notes text;
begin
  if new.status='paid' and new.order_id is not null then
    if new.payment_provider='mercadopago' or new.payment_kind like 'mercadopago%' then
      v_amount := coalesce(new.mercadopago_transaction_amount,new.total);
      v_method := case when new.payment_kind='mercadopago_pix' then 'pix' else 'card' end;
      v_account := 'Mercado Pago';
      v_notes := 'Pagamento conciliado automaticamente com Mercado Pago Orders API.';
    else
      v_amount := coalesce(new.infinitepay_paid_amount_cents,new.infinitepay_amount_cents,round(new.total*100)::integer)/100.0;
      v_method := case when new.payment_kind='infinitepay_pix' then 'pix' else 'card' end;
      v_account := 'InfinitePay';
      v_notes := 'Pagamento conciliado automaticamente com a InfinitePay.';
    end if;

    update public.financial_transactions
       set amount=v_amount,status='paid',category='venda',
           description='Recebimento cardápio digital — '||v_account,
           account=v_account,payment_method=v_method,
           paid_at=coalesce(new.paid_at,new.mercadopago_verified_at,new.infinitepay_verified_at,now()),
           occurred_at=coalesce(new.paid_at,new.mercadopago_verified_at,new.infinitepay_verified_at,now()),
           due_date=null,notes=v_notes
     where source_type='order' and source_id=new.order_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_financial_site_checkout on public.site_checkout_sessions;
create trigger trg_sync_financial_site_checkout
after insert or update of status,order_id,paid_at,payment_provider,payment_kind,
  infinitepay_paid_amount_cents,infinitepay_amount_cents,infinitepay_verified_at,
  mercadopago_transaction_amount,mercadopago_verified_at
on public.site_checkout_sessions
for each row execute function public.trg_sync_financial_site_checkout();

-- -----------------------------------------------------------------------------
-- FINALIZAÇÃO LOCAL DO ESTORNO APÓS O MERCADO PAGO ACEITAR A OPERAÇÃO.
-- Mantém a venda original e grava uma SAÍDA separada no livro-caixa.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_mercadopago_refund(
  p_refund_log_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_response_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  r public.mercadopago_refunds%rowtype;
  c public.site_checkout_sessions%rowtype;
  v_total_refunded numeric(12,2);
  v_fin_status text;
  v_now timestamptz := now();
begin
  select * into r from public.mercadopago_refunds where id=p_refund_log_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Registro de estorno não encontrado'); end if;
  select * into c from public.site_checkout_sessions where id=r.checkout_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Checkout não encontrado'); end if;

  update public.mercadopago_refunds
     set mercadopago_refund_id=coalesce(nullif(p_provider_refund_id,''),mercadopago_refund_id),
         status=case when lower(coalesce(p_provider_status,'')) in ('processed','refunded') then 'processed' else 'processing' end,
         processed_at=case when lower(coalesce(p_provider_status,'')) in ('processed','refunded') then v_now else processed_at end,
         response_payload=p_response_payload,
         error_message=null,
         updated_at=v_now
   where id=r.id;

  select coalesce(sum(amount),0)::numeric(12,2) into v_total_refunded
    from public.mercadopago_refunds
   where checkout_id=c.id and status in ('processed','processing');

  update public.site_checkout_sessions
     set mercadopago_refunded_amount=v_total_refunded,
         mercadopago_refund_status=case
           when v_total_refunded >= coalesce(total,0) then 'refunded'
           when v_total_refunded > 0 then 'partially_refunded'
           else null end,
         mercadopago_refunded_at=case when v_total_refunded > 0 then v_now else mercadopago_refunded_at end,
         updated_at=v_now
   where id=c.id;

  v_fin_status := case when lower(coalesce(p_provider_status,'')) in ('processed','refunded') then 'paid' else 'forecast' end;

  insert into public.financial_transactions(
    direction,status,amount,category,description,account,payment_method,
    source_type,source_id,order_id,customer_name,competence_date,due_date,
    occurred_at,paid_at,notes,is_system,created_by
  ) values (
    'out',v_fin_status,r.amount,'estorno',
    case when r.refund_type='total' then 'Estorno total Mercado Pago' else 'Estorno parcial Mercado Pago' end,
    'Mercado Pago',coalesce((select payment_method::text from public.orders where id=r.order_id),'online'),
    'refund',r.id,r.order_id,c.customer_name,
    (v_now at time zone 'America/Sao_Paulo')::date,
    case when v_fin_status='forecast' then (v_now at time zone 'America/Sao_Paulo')::date else null end,
    v_now,case when v_fin_status='paid' then v_now else null end,
    'Motivo: '||r.reason||coalesce(' | Refund ID: '||nullif(p_provider_refund_id,''),''),true,r.requested_by
  )
  on conflict (source_type,source_id) where source_id is not null do update set
    status=excluded.status,amount=excluded.amount,description=excluded.description,account=excluded.account,
    payment_method=excluded.payment_method,order_id=excluded.order_id,customer_name=excluded.customer_name,
    competence_date=excluded.competence_date,due_date=excluded.due_date,occurred_at=excluded.occurred_at,
    paid_at=excluded.paid_at,notes=excluded.notes;

  return jsonb_build_object('ok',true,'refunded_amount',v_total_refunded,'refund_status',
    case when v_total_refunded >= coalesce(c.total,0) then 'refunded' else 'partially_refunded' end);
end $$;
revoke all on function public.finalize_mercadopago_refund(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_mercadopago_refund(uuid,text,text,jsonb) to service_role;

commit;

-- HotBox — InfinitePay no cardápio digital + redirecionamento iFood por bairro.
-- Não altera o fluxo de pedidos WhatsApp/manual.

alter table public.store_config add column if not exists payment_link_url text;
alter table public.store_config add column if not exists ifood_store_link text;
alter table public.store_config add column if not exists nfood_store_link text;
alter table public.store_config add column if not exists stripe_pix_enabled boolean not null default false;
alter table public.store_config add column if not exists infinitepay_enabled boolean not null default false;
alter table public.store_config add column if not exists infinitepay_handle text;
alter table public.store_config add column if not exists infinitepay_webhook_token text;
update public.store_config
   set infinitepay_webhook_token = replace(gen_random_uuid()::text,'-','')
 where id = 1 and coalesce(infinitepay_webhook_token,'') = '';

alter table public.site_checkout_sessions add column if not exists infinitepay_order_nsu text;
alter table public.site_checkout_sessions add column if not exists infinitepay_transaction_nsu text;
alter table public.site_checkout_sessions add column if not exists infinitepay_invoice_slug text;
alter table public.site_checkout_sessions add column if not exists infinitepay_receipt_url text;
create unique index if not exists idx_site_checkout_infinitepay_transaction
  on public.site_checkout_sessions(infinitepay_transaction_nsu)
  where infinitepay_transaction_nsu is not null;

alter table public.site_checkout_sessions drop constraint if exists site_checkout_payment_kind_ck;
alter table public.site_checkout_sessions add constraint site_checkout_payment_kind_ck
  check (payment_kind in ('stripe_card','stripe_pix','infinitepay','infinitepay_card','infinitepay_pix'));

-- Recria a view para evitar conflito de ordem de colunas e expõe somente dados não secretos.
drop view if exists public.store_config_public;
create view public.store_config_public as
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
         stripe_pix_enabled,
         payment_link_url,
         ifood_store_link,
         nfood_store_link,
         infinitepay_enabled,
         infinitepay_handle
    from public.store_config
   where id = 1;
grant select on public.store_config_public to anon, authenticated;

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

  v_method := case when c.payment_kind in ('stripe_pix','infinitepay_pix') then 'pix' else 'card' end;

  insert into public.orders(
    source,customer_name,customer_phone,delivery_mode,
    address_street,address_number,address_complement,address_neighborhood,address_city,address_cep,
    payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,
    status,payment_status,payment_confirmed_at,payment_confirmed_by,payment_link
  ) values (
    'site',c.customer_name,c.customer_phone,coalesce(c.order_data->>'delivery_mode','delivery'),
    nullif(c.order_data->>'address_street',''),nullif(c.order_data->>'address_number',''),
    nullif(c.order_data->>'address_complement',''),nullif(c.order_data->>'address_neighborhood',''),
    nullif(c.order_data->>'address_city',''),nullif(c.order_data->>'address_cep',''),
    v_method::public.payment_method,'now',null,null,
    c.subtotal,c.delivery_fee,c.coupon_code,c.coupon_discount,c.total,
    'pending','paid',now(),p_confirmed_by,
    coalesce(c.infinitepay_receipt_url,p_provider_ref)
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
      update public.coupons set usage_count=coalesce(usage_count,0)+1,updated_at=now() where id=v_coupon.id;
      insert into public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total)
      values(v_coupon.id,v_order.id,c.customer_phone,c.coupon_discount,c.subtotal,c.total)
      on conflict(order_id) do nothing;
    end if;
  end if;

  update public.site_checkout_sessions
     set status='paid',paid_at=now(),order_id=v_order.id,
         stripe_session_id=coalesce(p_stripe_session_id,stripe_session_id),
         stripe_payment_intent_id=case when p_confirmed_by='stripe' then coalesce(p_provider_ref,stripe_payment_intent_id) else stripe_payment_intent_id end,
         updated_at=now()
   where id=c.id;

  return jsonb_build_object('ok',true,'order_id',v_order.id,'order_number',v_order.order_number,'payment_method',v_method,'payment_status','paid');
end $$;

revoke all on function public.finalize_site_checkout_paid(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_site_checkout_paid(uuid,text,text,text) to service_role;

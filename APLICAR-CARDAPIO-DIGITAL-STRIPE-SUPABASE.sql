-- HotBox Delivery — Cardápio digital premium + pagamentos antecipados
-- Adiciona configuração do Stripe no painel e endurece o fluxo de pagamento do site.

alter table public.store_config add column if not exists stripe_enabled boolean not null default false;
alter table public.store_config add column if not exists stripe_publishable_key text;
alter table public.store_config add column if not exists stripe_secret_key text;
alter table public.store_config add column if not exists stripe_webhook_secret text;
alter table public.store_config add column if not exists digital_menu_cash_enabled boolean not null default true;
alter table public.store_config add column if not exists digital_menu_pix_enabled boolean not null default true;
alter table public.store_config add column if not exists digital_menu_card_enabled boolean not null default true;

-- A view pública expõe SOMENTE flags seguras. Segredos do Stripe nunca saem para o cliente.
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
         digital_menu_card_enabled
    from public.store_config
   where id = 1;

grant select on public.store_config_public to anon, authenticated;

-- Site: toda forma é antecipada. Pedido nasce aguardando pagamento e só entra
-- no fluxo operacional após confirmação de pagamento (automática no cartão,
-- manual no Pix/dinheiro).
create or replace function public.create_site_order_secure(
  p_order jsonb,
  p_items jsonb,
  p_coupon_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_quote jsonb;
  v_discount numeric := 0;
  v_subtotal numeric := 0;
  v_delivery numeric := greatest(coalesce((p_order->>'delivery_fee')::numeric,0),0);
  v_total numeric := 0;
  v_phone text := regexp_replace(coalesce(p_order->>'customer_phone',''), '\D', '', 'g');
  v_coupon public.coupons%rowtype;
  v_method text := coalesce(p_order->>'payment_method','');
  item jsonb;
begin
  if coalesce(trim(p_order->>'customer_name'),'') = '' or v_phone = '' then raise exception 'Nome e telefone são obrigatórios'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Carrinho vazio'; end if;
  if v_method not in ('pix','card','cash') then raise exception 'Forma de pagamento não permitida no cardápio digital'; end if;

  select coalesce(sum((x->>'unit_price')::numeric * greatest((x->>'qty')::int,0)),0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  if v_subtotal <= 0 then raise exception 'Subtotal inválido'; end if;

  if coalesce(trim(p_coupon_code),'') <> '' then
    select * into v_coupon from public.coupons where upper(code)=upper(trim(p_coupon_code)) for update;
    if not found then raise exception 'Cupom não encontrado'; end if;
    v_quote := public._coupon_quote_internal(p_coupon_code,v_subtotal,v_phone,p_items,now());
    if not coalesce((v_quote->>'ok')::boolean,false) then raise exception '%', coalesce(v_quote->>'reason','Cupom inválido'); end if;
    v_discount := coalesce((v_quote->>'discount')::numeric,0);
  end if;

  v_total := greatest(0,v_subtotal-v_discount)+v_delivery;

  insert into public.orders(
    source,customer_name,customer_phone,delivery_mode,address_street,address_number,address_complement,
    address_neighborhood,address_city,address_cep,payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,status,payment_status
  ) values (
    'site',trim(p_order->>'customer_name'),v_phone,coalesce(p_order->>'delivery_mode','delivery'),
    nullif(p_order->>'address_street',''),nullif(p_order->>'address_number',''),nullif(p_order->>'address_complement',''),
    nullif(p_order->>'address_neighborhood',''),nullif(p_order->>'address_city',''),nullif(p_order->>'address_cep',''),
    v_method::public.payment_method,'now',null,
    case when v_method='pix' then nullif(p_order->>'pix_code','') else null end,
    v_subtotal,v_delivery,
    case when v_discount > 0 then v_coupon.code else null end,v_discount,v_total,
    'pending_review','awaiting_payment'
  ) returning * into v_order;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes)
    values(v_order.id,(item->>'product_id')::uuid,item->>'product_name',greatest((item->>'qty')::int,1),
      (item->>'unit_price')::numeric,nullif(item->>'list_price','')::numeric,coalesce((item->>'is_promotion_price')::boolean,false),nullif(item->>'notes',''));
  end loop;

  if v_discount > 0 then
    update public.coupons set usage_count=usage_count+1,updated_at=now() where id=v_coupon.id;
    insert into public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total)
    values(v_coupon.id,v_order.id,v_phone,v_discount,v_subtotal,v_total);
  end if;

  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'coupon_discount',v_discount,'total',v_total,'payment_status','awaiting_payment');
end $$;

grant execute on function public.create_site_order_secure(jsonb,jsonb,text) to anon, authenticated;

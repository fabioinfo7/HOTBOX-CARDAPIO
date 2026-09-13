-- HOTBOX — Cardápio digital: validação pública de área + checkout flexível
-- Não altera o fluxo do WhatsApp, chat, IA ou pedidos criados por outros canais.

create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_delivery_text(p_text text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9 ]+', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  );
$$;

create or replace function public.canonical_delivery_neighborhood(p_text text)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v text := public.normalize_delivery_text(p_text);
begin
  -- Variações comuns que já apareceram no atendimento.
  v := regexp_replace(v, '^dr\s+', 'doutor ');
  v := regexp_replace(v, '^dra\s+', 'doutora ');
  return v;
end;
$$;

create or replace function public.check_delivery_area_public(
  p_neighborhood text,
  p_street text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_neighborhood public.bairros_atendidos%rowtype;
  v_zone public.zonas_entrega%rowtype;
  v_fee numeric := 0;
  v_default_fee numeric := 0;
  v_normalized_neighborhood text := public.canonical_delivery_neighborhood(p_neighborhood);
  v_normalized_street text := public.normalize_delivery_text(p_street);
  v_zone_found boolean := false;
begin
  if v_normalized_neighborhood = '' then
    return jsonb_build_object('supported', false, 'reason', 'missing_neighborhood');
  end if;

  select b.* into v_neighborhood
    from public.bairros_atendidos b
   where b.ativo = true
     and public.canonical_delivery_neighborhood(b.nome) = v_normalized_neighborhood
   order by b.updated_at desc nulls last
   limit 1;

  if not found then
    return jsonb_build_object(
      'supported', false,
      'reason', 'outside_area',
      'neighborhood', nullif(trim(p_neighborhood), '')
    );
  end if;

  select coalesce(sc.default_delivery_fee, 0)
    into v_default_fee
    from public.store_config sc
   where sc.id = 1;
  v_fee := coalesce(v_default_fee, 0);

  -- Quando a rua já existe na tabela de zonas, respeita bloqueio e faixa específica.
  if v_normalized_street <> '' then
    select z.* into v_zone
      from public.zonas_entrega z
     where public.canonical_delivery_neighborhood(coalesce(z.bairro, v_neighborhood.nome)) = public.canonical_delivery_neighborhood(v_neighborhood.nome)
       and public.normalize_delivery_text(z.rua) = v_normalized_street
     order by z.updated_at desc nulls last
     limit 1;

    if found then
      v_zone_found := true;
      if v_zone.entrega_disponivel is false then
        return jsonb_build_object(
          'supported', false,
          'reason', 'street_unavailable',
          'neighborhood', v_neighborhood.nome,
          'matched_zone', true
        );
      end if;

      if v_zone.faixa_id is not null then
        select f.fee into v_fee
          from public.faixas_entrega f
         where f.id = v_zone.faixa_id
           and f.ativo = true
         limit 1;
        v_fee := coalesce(v_fee, v_default_fee, 0);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'supported', true,
    'reason', 'supported',
    'neighborhood', v_neighborhood.nome,
    'fee', coalesce(v_fee, 0),
    'matched_zone', v_zone_found
  );
end;
$$;

grant execute on function public.check_delivery_area_public(text,text) to anon, authenticated;

-- A criação de pedido pelo site revalida a área no banco.
-- Assim não basta alterar JavaScript no navegador para comprar de um bairro não atendido.
create or replace function public.create_site_order_secure(
  p_order jsonb,
  p_items jsonb,
  p_coupon_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_coupon_quote jsonb;
  v_area_quote jsonb;
  v_discount numeric := 0;
  v_subtotal numeric := 0;
  v_delivery numeric := 0;
  v_total numeric := 0;
  v_phone text := regexp_replace(coalesce(p_order->>'customer_phone',''), '\D', '', 'g');
  v_coupon public.coupons%rowtype;
  v_method text := coalesce(p_order->>'payment_method','');
  v_timing text := coalesce(nullif(p_order->>'payment_timing',''), 'delivery');
  v_delivery_mode text := coalesce(nullif(p_order->>'delivery_mode',''), 'delivery');
  v_status text;
  v_payment_status text;
  item jsonb;
begin
  if coalesce(trim(p_order->>'customer_name'),'') = '' or v_phone = '' then
    raise exception 'Nome e telefone são obrigatórios';
  end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'Carrinho vazio';
  end if;

  -- Hotbox não aceita dinheiro em espécie no cardápio digital.
  if v_method not in ('pix','card') then
    raise exception 'Forma de pagamento não permitida no cardápio digital';
  end if;
  if v_timing not in ('now','delivery') then
    raise exception 'Momento de pagamento inválido';
  end if;

  if v_delivery_mode = 'delivery' then
    if coalesce(trim(p_order->>'address_street'),'') = ''
       or coalesce(trim(p_order->>'address_number'),'') = ''
       or coalesce(trim(p_order->>'address_neighborhood'),'') = '' then
      raise exception 'Endereço de entrega incompleto';
    end if;

    v_area_quote := public.check_delivery_area_public(
      p_order->>'address_neighborhood',
      p_order->>'address_street'
    );

    if not coalesce((v_area_quote->>'supported')::boolean, false) then
      raise exception 'Endereço fora da área de entrega própria';
    end if;

    v_delivery := greatest(coalesce((v_area_quote->>'fee')::numeric, 0), 0);
  else
    v_delivery := 0;
  end if;

  select coalesce(sum((x->>'unit_price')::numeric * greatest((x->>'qty')::int,0)),0)
    into v_subtotal
    from jsonb_array_elements(p_items) x;
  if v_subtotal <= 0 then raise exception 'Subtotal inválido'; end if;

  if coalesce(trim(p_coupon_code),'') <> '' then
    select * into v_coupon
      from public.coupons
     where upper(code)=upper(trim(p_coupon_code))
     for update;
    if not found then raise exception 'Cupom não encontrado'; end if;

    v_coupon_quote := public._coupon_quote_internal(p_coupon_code,v_subtotal,v_phone,p_items,now());
    if not coalesce((v_coupon_quote->>'ok')::boolean,false) then
      raise exception '%', coalesce(v_coupon_quote->>'reason','Cupom inválido');
    end if;
    v_discount := coalesce((v_coupon_quote->>'discount')::numeric,0);
  end if;

  v_total := greatest(0,v_subtotal-v_discount)+v_delivery;

  if v_timing = 'now' then
    v_status := 'pending_review';
    v_payment_status := 'awaiting_payment';
  else
    v_status := 'pending';
    v_payment_status := 'pending';
  end if;

  insert into public.orders(
    source,customer_name,customer_phone,delivery_mode,address_street,address_number,address_complement,
    address_neighborhood,address_city,address_cep,payment_method,payment_timing,change_for,pix_code,
    subtotal,delivery_fee,coupon_code,coupon_discount,total,status,payment_status
  ) values (
    'site',trim(p_order->>'customer_name'),v_phone,v_delivery_mode,
    nullif(p_order->>'address_street',''),nullif(p_order->>'address_number',''),nullif(p_order->>'address_complement',''),
    nullif(p_order->>'address_neighborhood',''),nullif(p_order->>'address_city',''),nullif(p_order->>'address_cep',''),
    v_method::public.payment_method,v_timing,null,
    case when v_method='pix' and v_timing='now' then nullif(p_order->>'pix_code','') else null end,
    v_subtotal,v_delivery,
    case when v_discount > 0 then v_coupon.code else null end,v_discount,v_total,
    v_status,v_payment_status
  ) returning * into v_order;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,list_price,is_promotion_price,notes)
    values(
      v_order.id,(item->>'product_id')::uuid,item->>'product_name',greatest((item->>'qty')::int,1),
      (item->>'unit_price')::numeric,nullif(item->>'list_price','')::numeric,
      coalesce((item->>'is_promotion_price')::boolean,false),nullif(item->>'notes','')
    );
  end loop;

  if v_discount > 0 then
    update public.coupons
       set usage_count=usage_count+1, updated_at=now()
     where id=v_coupon.id;
    insert into public.coupon_redemptions(coupon_id,order_id,customer_phone,discount_amount,order_subtotal,order_total)
    values(v_coupon.id,v_order.id,v_phone,v_discount,v_subtotal,v_total);
  end if;

  return jsonb_build_object(
    'id',v_order.id,
    'order_number',v_order.order_number,
    'coupon_discount',v_discount,
    'delivery_fee',v_delivery,
    'total',v_total,
    'payment_status',v_payment_status,
    'payment_timing',v_timing
  );
end;
$$;

grant execute on function public.create_site_order_secure(jsonb,jsonb,text) to anon, authenticated;

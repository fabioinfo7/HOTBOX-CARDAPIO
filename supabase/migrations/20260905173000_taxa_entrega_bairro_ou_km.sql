-- HotBox Delivery — taxa de entrega por BAIRRO ou por QUILOMETRAGEM
-- Mantém compatibilidade com o modo antigo: delivery_pricing_mode='flat' passa a representar cobrança por bairro.
-- O cardápio digital revalida tudo no backend antes de criar o checkout.

begin;

alter table public.bairros_atendidos
  add column if not exists delivery_fee numeric(10,2);

-- Preserva o comportamento atual: bairros já cadastrados herdam a taxa padrão até o gerente personalizar.
update public.bairros_atendidos b
   set delivery_fee = coalesce(b.delivery_fee, (select default_delivery_fee from public.store_config where id = 1), 0)
 where b.delivery_fee is null;

alter table public.bairros_atendidos
  drop constraint if exists bairros_atendidos_delivery_fee_nonnegative;
alter table public.bairros_atendidos
  add constraint bairros_atendidos_delivery_fee_nonnegative
  check (delivery_fee is null or delivery_fee >= 0);

comment on column public.bairros_atendidos.delivery_fee is
  'Taxa cobrada quando delivery_pricing_mode = flat (modo por bairro). NULL usa default_delivery_fee como fallback.';

-- A validação pública continua decidindo se o bairro é atendido, mas agora informa
-- também qual motor de preço está ativo. No modo por distância, a taxa exata só é
-- calculada no backend após receber o número do endereço.
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
  v_mode text := 'flat';
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

  select coalesce(sc.default_delivery_fee, 0), coalesce(sc.delivery_pricing_mode, 'flat')
    into v_default_fee, v_mode
    from public.store_config sc
   where sc.id = 1;

  -- Rua explicitamente indisponível em zonas_entrega continua bloqueada.
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
          'matched_zone', true,
          'pricing_mode', case when v_mode = 'distance' then 'distance' else 'neighborhood' end
        );
      end if;
    end if;
  end if;

  if v_mode = 'distance' then
    return jsonb_build_object(
      'supported', true,
      'reason', 'supported',
      'neighborhood', v_neighborhood.nome,
      'fee', null,
      'pricing_mode', 'distance',
      'needs_number', true,
      'matched_zone', v_zone_found
    );
  end if;

  v_fee := coalesce(v_neighborhood.delivery_fee, v_default_fee, 0);
  return jsonb_build_object(
    'supported', true,
    'reason', 'supported',
    'neighborhood', v_neighborhood.nome,
    'fee', v_fee,
    'pricing_mode', 'neighborhood',
    'needs_number', false,
    'matched_zone', v_zone_found
  );
end;
$$;

grant execute on function public.check_delivery_area_public(text,text) to anon, authenticated, service_role;

commit;

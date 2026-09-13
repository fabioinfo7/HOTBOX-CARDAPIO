-- HOTBOX — BAIRROS ATENDIDOS + CEPs LIBERADOS MANUALMENTE
-- Permite liberar o cardápio por nome do bairro OU por CEP cadastrado manualmente.
-- CEP manual é uma exceção positiva e herda o bairro/taxa em que foi cadastrado.
-- Não apaga bairros, pedidos, produtos, financeiro ou configurações.

begin;

alter table public.bairros_atendidos
  add column if not exists ceps text[] not null default '{}'::text[];

comment on column public.bairros_atendidos.ceps is
  'CEPs liberados manualmente para este bairro. São armazenados preferencialmente com 8 dígitos, sem máscara.';

-- Limpa máscara/espaços de CEPs já existentes, caso esta migration seja reaplicada.
update public.bairros_atendidos b
   set ceps = coalesce(
     (
       select array_agg(distinct regexp_replace(value, '\D', '', 'g'))
         from unnest(coalesce(b.ceps, '{}'::text[])) as value
        where length(regexp_replace(value, '\D', '', 'g')) = 8
     ),
     '{}'::text[]
   );

-- Nova versão com CEP opcional.
create or replace function public.check_delivery_area_public(
  p_neighborhood text,
  p_street text,
  p_cep text
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
  v_cep text := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  v_zone_found boolean := false;
  v_matched_cep boolean := false;
begin
  -- 1) CEP manual tem prioridade positiva.
  if length(v_cep) = 8 then
    select b.* into v_neighborhood
      from public.bairros_atendidos b
     where b.ativo = true
       and exists (
         select 1
           from unnest(coalesce(b.ceps, '{}'::text[])) as configured_cep
          where regexp_replace(configured_cep, '\D', '', 'g') = v_cep
       )
     order by b.updated_at desc nulls last
     limit 1;

    if found then
      v_matched_cep := true;
      v_normalized_neighborhood := public.canonical_delivery_neighborhood(v_neighborhood.nome);
    end if;
  end if;

  -- 2) Se o CEP não foi liberado manualmente, valida pelo nome do bairro.
  if not v_matched_cep then
    if v_normalized_neighborhood = '' then
      return jsonb_build_object(
        'supported', false,
        'reason', 'missing_neighborhood',
        'matched_cep', false
      );
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
        'neighborhood', nullif(trim(p_neighborhood), ''),
        'matched_cep', false
      );
    end if;
  end if;

  select coalesce(sc.default_delivery_fee, 0), coalesce(sc.delivery_pricing_mode, 'flat')
    into v_default_fee, v_mode
    from public.store_config sc
   where sc.id = 1;

  -- Rua explicitamente indisponível continua bloqueada mesmo quando o CEP foi liberado.
  if v_normalized_street <> '' then
    select z.* into v_zone
      from public.zonas_entrega z
     where public.canonical_delivery_neighborhood(coalesce(z.bairro, v_neighborhood.nome))
           = public.canonical_delivery_neighborhood(v_neighborhood.nome)
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
          'matched_cep', v_matched_cep,
          'pricing_mode', case when v_mode = 'distance' then 'distance' else 'neighborhood' end
        );
      end if;
    end if;
  end if;

  if v_mode = 'distance' then
    return jsonb_build_object(
      'supported', true,
      'reason', case when v_matched_cep then 'manual_cep' else 'supported' end,
      'neighborhood', v_neighborhood.nome,
      'fee', null,
      'pricing_mode', 'distance',
      'needs_number', true,
      'matched_zone', v_zone_found,
      'matched_cep', v_matched_cep
    );
  end if;

  v_fee := coalesce(v_neighborhood.delivery_fee, v_default_fee, 0);

  return jsonb_build_object(
    'supported', true,
    'reason', case when v_matched_cep then 'manual_cep' else 'supported' end,
    'neighborhood', v_neighborhood.nome,
    'fee', v_fee,
    'pricing_mode', 'neighborhood',
    'needs_number', false,
    'matched_zone', v_zone_found,
    'matched_cep', v_matched_cep
  );
end;
$$;

-- Mantém compatibilidade com código antigo que ainda chama a função com 2 argumentos.
create or replace function public.check_delivery_area_public(
  p_neighborhood text,
  p_street text default null
) returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select public.check_delivery_area_public(p_neighborhood, p_street, null);
$$;

grant execute on function public.check_delivery_area_public(text,text,text)
  to anon, authenticated, service_role;
grant execute on function public.check_delivery_area_public(text,text)
  to anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';

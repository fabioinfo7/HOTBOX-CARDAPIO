-- HOTBOX — CONTROLE MANUAL COMPLETO DO CLUBE HOTBOX
-- Adiciona remoção/reativação de participante, anotações administrativas,
-- ajustes manuais e emissão/cancelamento de recompensas.
-- Não apaga pedidos, usuários de login ou histórico de compras.

begin;

alter table public.loyalty_accounts
  add column if not exists active boolean not null default true,
  add column if not exists admin_notes text;

comment on column public.loyalty_accounts.active is
  'Quando false, o cliente permanece com histórico preservado mas fica fora do Clube HotBox.';
comment on column public.loyalty_accounts.admin_notes is
  'Anotações internas da loja sobre a participação do cliente no Clube HotBox.';

create index if not exists idx_loyalty_accounts_active_updated
  on public.loyalty_accounts(active, updated_at desc);

-- Emite uma recompensa manual sem mexer nas marcações atuais.
create or replace function public.loyalty_admin_issue_reward(
  p_user_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_coupon_id uuid;
  v_reward_id uuid;
begin
  if not exists (
    select 1 from public.loyalty_accounts
    where user_id = p_user_id and active = true
  ) then
    raise exception 'Participante não encontrado ou inativo';
  end if;

  loop
    v_code := 'HB-FIEL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    exit when not exists(select 1 from public.coupons where upper(code)=upper(v_code))
              and not exists(select 1 from public.loyalty_rewards where upper(code)=upper(v_code));
  end loop;

  insert into public.coupons(
    code,description,discount_type,discount_value,active,usage_limit,usage_count,
    max_uses_per_customer,first_order_only,min_order_value,allow_promotion_stack,
    valid_from,valid_until
  ) values (
    v_code,'Clube HotBox — 1 batata grátis','fixed',0,true,1,0,1,false,0,false,now(),null
  ) returning id into v_coupon_id;

  insert into public.loyalty_rewards(user_id,coupon_id,code,status)
  values(p_user_id,v_coupon_id,v_code,'available')
  returning id into v_reward_id;

  update public.loyalty_accounts
     set rewards_earned = rewards_earned + 1,
         updated_at = now()
   where user_id = p_user_id;

  insert into public.loyalty_ledger(
    user_id,reward_id,event_type,points_delta,description
  ) values (
    p_user_id,
    v_reward_id,
    'reward_issued',
    0,
    coalesce(nullif(trim(p_reason),''),'Recompensa concedida manualmente pela loja')
  );

  return jsonb_build_object(
    'reward_id', v_reward_id,
    'code', v_code,
    'status', 'available'
  );
end;
$$;

revoke all on function public.loyalty_admin_issue_reward(uuid,text)
  from public, anon, authenticated;
grant execute on function public.loyalty_admin_issue_reward(uuid,text)
  to service_role;

-- Converte marcações excedentes em recompensas.
create or replace function public.loyalty_admin_sync_rewards(
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer;
  v_points integer;
  v_created integer := 0;
  v_result jsonb;
begin
  select greatest(1,coalesce(loyalty_orders_required,10))
    into v_required
    from public.store_config
   where id = 1;

  select points
    into v_points
    from public.loyalty_accounts
   where user_id = p_user_id
   for update;

  if not found then
    raise exception 'Participante não encontrado';
  end if;

  while v_points >= v_required loop
    update public.loyalty_accounts
       set points = points - v_required,
           updated_at = now()
     where user_id = p_user_id
     returning points into v_points;

    select public.loyalty_admin_issue_reward(
      p_user_id,
      'Recompensa liberada após ajuste manual atingir a meta'
    ) into v_result;

    insert into public.loyalty_ledger(
      user_id,reward_id,event_type,points_delta,description
    ) values (
      p_user_id,
      nullif(v_result->>'reward_id','')::uuid,
      'adjustment',
      -v_required,
      'Marcações consumidas para recompensa após ajuste manual'
    );

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'rewards_created', v_created,
    'remaining_points', v_points
  );
end;
$$;

revoke all on function public.loyalty_admin_sync_rewards(uuid)
  from public, anon, authenticated;
grant execute on function public.loyalty_admin_sync_rewards(uuid)
  to service_role;

-- Cancela uma recompensa que ainda não foi utilizada.
create or replace function public.loyalty_admin_cancel_reward(
  p_reward_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.loyalty_rewards%rowtype;
begin
  select * into v_reward
    from public.loyalty_rewards
   where id = p_reward_id
   for update;

  if not found then
    raise exception 'Recompensa não encontrada';
  end if;

  if v_reward.status = 'redeemed' then
    raise exception 'Uma recompensa já utilizada não pode ser cancelada';
  end if;

  update public.loyalty_rewards
     set status = 'cancelled',
         checkout_id = null,
         reserved_at = null,
         updated_at = now()
   where id = p_reward_id;

  if v_reward.coupon_id is not null then
    update public.coupons
       set active = false,
           updated_at = now()
     where id = v_reward.coupon_id;
  end if;

  insert into public.loyalty_ledger(
    user_id,reward_id,event_type,points_delta,description
  ) values (
    v_reward.user_id,
    v_reward.id,
    'adjustment',
    0,
    coalesce(nullif(trim(p_reason),''),'Recompensa cancelada manualmente pela loja')
  );

  return jsonb_build_object(
    'reward_id', v_reward.id,
    'status', 'cancelled'
  );
end;
$$;

revoke all on function public.loyalty_admin_cancel_reward(uuid,text)
  from public, anon, authenticated;
grant execute on function public.loyalty_admin_cancel_reward(uuid,text)
  to service_role;

-- Remove/reativa a participação sem apagar usuário, pedidos ou histórico.
create or replace function public.loyalty_admin_set_participant_active(
  p_user_id uuid,
  p_active boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not exists (
    select 1 from public.loyalty_accounts where user_id = p_user_id
  ) then
    raise exception 'Participante não encontrado';
  end if;

  update public.loyalty_accounts
     set active = coalesce(p_active,false),
         updated_at = now()
   where user_id = p_user_id;

  if coalesce(p_active,false) = false then
    for r in
      select id
        from public.loyalty_rewards
       where user_id = p_user_id
         and status in ('available','reserved')
    loop
      perform public.loyalty_admin_cancel_reward(
        r.id,
        'Recompensa cancelada porque o participante foi removido do Clube'
      );
    end loop;
  end if;

  insert into public.loyalty_ledger(
    user_id,event_type,points_delta,description
  ) values (
    p_user_id,
    'adjustment',
    0,
    coalesce(
      nullif(trim(p_reason),''),
      case
        when coalesce(p_active,false)
        then 'Participação reativada manualmente'
        else 'Participação removida manualmente'
      end
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'active', coalesce(p_active,false)
  );
end;
$$;

revoke all on function public.loyalty_admin_set_participant_active(uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.loyalty_admin_set_participant_active(uuid,boolean,text)
  to service_role;

-- A contagem automática passa a respeitar participante removido.
create or replace function public.process_loyalty_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
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
  if o.source <> 'site'
     or o.customer_user_id is null
     or o.status <> 'delivered'
     or o.payment_status <> 'paid'
  then return; end if;

  if coalesce(o.loyalty_reward_used,false) then return; end if;
  if not coalesce((select loyalty_enabled from public.store_config where id=1),true) then return; end if;

  insert into public.loyalty_accounts(user_id)
  values(o.customer_user_id)
  on conflict(user_id) do nothing;

  if exists (
    select 1 from public.loyalty_accounts
    where user_id = o.customer_user_id and active = false
  ) then
    return;
  end if;

  insert into public.loyalty_ledger(
    user_id,order_id,event_type,points_delta,description
  )
  values(
    o.customer_user_id,
    o.id,
    'order_completed',
    1,
    'Pedido do cardápio digital concluído'
  )
  on conflict(order_id)
  where event_type='order_completed' and order_id is not null
  do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return; end if;

  update public.loyalty_accounts
     set points=points+1,
         lifetime_qualifying_orders=lifetime_qualifying_orders+1,
         updated_at=now()
   where user_id=o.customer_user_id
   returning points into v_points;

  v_required := greatest(
    1,
    coalesce((select loyalty_orders_required from public.store_config where id=1),10)
  );

  if v_points >= v_required then
    loop
      v_code := 'HB-FIEL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
      exit when not exists(select 1 from public.coupons where upper(code)=upper(v_code))
                and not exists(select 1 from public.loyalty_rewards where upper(code)=upper(v_code));
    end loop;

    insert into public.coupons(
      code,description,discount_type,discount_value,active,usage_limit,usage_count,
      max_uses_per_customer,first_order_only,min_order_value,allow_promotion_stack,
      valid_from,valid_until
    ) values (
      v_code,'Clube HotBox — 1 batata grátis','fixed',0,true,1,0,1,false,0,false,now(),null
    ) returning id into v_coupon_id;

    insert into public.loyalty_rewards(user_id,coupon_id,code,status)
    values(o.customer_user_id,v_coupon_id,v_code,'available')
    returning id into v_reward_id;

    update public.loyalty_accounts
       set points=points-v_required,
           rewards_earned=rewards_earned+1,
           updated_at=now()
     where user_id=o.customer_user_id;

    insert into public.loyalty_ledger(
      user_id,reward_id,event_type,points_delta,description
    )
    values(
      o.customer_user_id,
      v_reward_id,
      'reward_issued',
      -v_required,
      'Cupom de 1 batata grátis desbloqueado'
    );
  end if;
end;
$$;

revoke all on function public.process_loyalty_order(uuid)
  from public,anon,authenticated;
grant execute on function public.process_loyalty_order(uuid)
  to service_role;

commit;

notify pgrst, 'reload schema';

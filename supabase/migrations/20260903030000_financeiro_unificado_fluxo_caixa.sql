-- HotBox Delivery — Financeiro unificado / Fluxo de Caixa canônico
-- Objetivos:
-- 1) Uma única fonte para ENTRADAS e SAÍDAS realizadas e previstas.
-- 2) Cardápio digital / InfinitePay faz parte do Financeiro Geral, sem dupla contagem.
-- 3) Contas a receber só entram no caixa quando efetivamente pagas.
-- 4) Despesas só saem do caixa quando efetivamente pagas.
-- 5) Todas as datas financeiras são agrupadas no dia civil de Brasília.
-- 6) Pedidos de iFood/99Food são faturamento ao serem entregues, mas o repasse fica PREVISTO
--    até ser conciliado/recebido no Fluxo de Caixa, pois o checkout não informa o repasse bancário real.

begin;

create extension if not exists pgcrypto;

-- Competência da despesa: separa "quando a despesa pertence" de "quando venceu/pagou".
alter table public.expenses add column if not exists competence_date date;
update public.expenses set competence_date = due_date where competence_date is null;

-- Liga um A Receber ao pedido que o originou. Isso evita dupla contagem.
alter table public.receivables add column if not exists order_id uuid references public.orders(id) on delete set null;
create unique index if not exists idx_receivables_order_id_unique
  on public.receivables(order_id)
  where order_id is not null;

-- Livro-caixa único. Registros automáticos têm source_type/source_id.
create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('in','out')),
  status text not null default 'forecast' check (status in ('forecast','paid','cancelled')),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null default 'outros',
  description text not null,
  account text,
  payment_method text,
  source_type text not null default 'manual' check (source_type in ('order','receivable','expense','manual','adjustment')),
  source_id uuid,
  order_id uuid references public.orders(id) on delete set null,
  receivable_id uuid references public.receivables(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  customer_name text,
  competence_date date,
  due_date date,
  occurred_at timestamptz,
  paid_at timestamptz,
  notes text,
  is_system boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_financial_transactions_source
  on public.financial_transactions(source_type, source_id)
  where source_id is not null;
create index if not exists idx_financial_transactions_paid_at on public.financial_transactions(paid_at desc) where status='paid';
create index if not exists idx_financial_transactions_due on public.financial_transactions(due_date, direction) where status='forecast';
create index if not exists idx_financial_transactions_order on public.financial_transactions(order_id) where order_id is not null;

alter table public.financial_transactions enable row level security;

do $$ begin
  drop policy if exists "financial_transactions_admin_select" on public.financial_transactions;
  drop policy if exists "financial_transactions_admin_insert" on public.financial_transactions;
  drop policy if exists "financial_transactions_admin_update" on public.financial_transactions;
  drop policy if exists "financial_transactions_admin_delete_manual" on public.financial_transactions;
exception when undefined_object then null; end $$;

create policy "financial_transactions_admin_select" on public.financial_transactions
for select to authenticated using (public.has_role(auth.uid(), 'store_admin'));
create policy "financial_transactions_admin_insert" on public.financial_transactions
for insert to authenticated with check (public.has_role(auth.uid(), 'store_admin'));
create policy "financial_transactions_admin_update" on public.financial_transactions
for update to authenticated using (public.has_role(auth.uid(), 'store_admin')) with check (public.has_role(auth.uid(), 'store_admin'));
create policy "financial_transactions_admin_delete_manual" on public.financial_transactions
for delete to authenticated using (public.has_role(auth.uid(), 'store_admin') and is_system = false);

grant select, insert, update, delete on public.financial_transactions to authenticated;
grant all on public.financial_transactions to service_role;

-- Atualização automática de updated_at.
create or replace function public.financial_touch_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_financial_transactions_updated_at on public.financial_transactions;
create trigger trg_financial_transactions_updated_at
before update on public.financial_transactions
for each row execute function public.financial_touch_updated_at();

-- Sincroniza pedido -> livro-caixa.
create or replace function public.sync_financial_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare
  o public.orders%rowtype;
  v_ref text;
  v_pct numeric := 0;
  v_amount numeric(12,2);
  v_when timestamptz;
  v_existing_status text;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return; end if;

  v_ref := coalesce(nullif(o.external_display_id,''), case when o.order_number is not null then '#'||o.order_number::text else null end, 'pedido');

  -- Pedido "pagar depois" é controlado exclusivamente pelo A Receber.
  if coalesce(o.payment_timing,'') = 'later' then
    update public.financial_transactions
       set status = case when status='paid' then status else 'cancelled' end,
           notes = case when status='paid' then coalesce(notes,'') || ' | Pedido convertido para pagar depois após recebimento já registrado.' else notes end
     where source_type='order' and source_id=o.id;
    return;
  end if;

  -- Cancelamento não apaga dinheiro já recebido: se houve recebimento, ele continua no caixa
  -- e deve haver um estorno separado somente quando o dinheiro realmente sair.
  if o.status = 'cancelled' then
    select status into v_existing_status from public.financial_transactions where source_type='order' and source_id=o.id;
    if v_existing_status = 'paid' then
      update public.financial_transactions
         set notes = trim(both ' ' from concat_ws(' | ', nullif(notes,''), 'Pedido cancelado: conferir se houve estorno. O recebimento não foi apagado automaticamente.'))
       where source_type='order' and source_id=o.id;
    else
      update public.financial_transactions set status='cancelled' where source_type='order' and source_id=o.id;
    end if;
    return;
  end if;

  -- Marketplaces: faturamento e caixa são conceitos diferentes. Sem extrato de repasse,
  -- o valor fica previsto e é conciliado manualmente quando o repasse realmente cair.
  if o.source in ('ifood','99food') then
    if o.status <> 'delivered' then return; end if;
    select case o.source
      when 'ifood' then coalesce(fee_pct_ifood,0)
      when '99food' then coalesce(fee_pct_99food,0)
      else 0 end
      into v_pct
      from public.store_config limit 1;
    v_amount := round(greatest(coalesce(o.total,0),0) * greatest(0, 1 - coalesce(v_pct,0)/100.0), 2);

    insert into public.financial_transactions(
      direction,status,amount,category,description,account,payment_method,source_type,source_id,order_id,
      customer_name,competence_date,due_date,occurred_at,paid_at,notes,is_system
    ) values (
      'in','forecast',v_amount,'repasse_plataforma',
      'Repasse previsto '||case when o.source='ifood' then 'iFood' else '99Food' end||' — '||v_ref,
      case when o.source='ifood' then 'iFood' else '99Food' end,
      coalesce(o.payment_method::text,'online'),'order',o.id,o.id,o.customer_name,
      (coalesce(o.delivered_at,o.created_at) at time zone 'America/Sao_Paulo')::date,
      null,coalesce(o.delivered_at,o.created_at),null,
      'Valor líquido estimado usando a taxa configurada. Marque como recebido quando o repasse real for conciliado.',true
    )
    on conflict (source_type,source_id) where source_id is not null do update set
      amount=excluded.amount,
      description=excluded.description,
      account=excluded.account,
      payment_method=excluded.payment_method,
      order_id=excluded.order_id,
      customer_name=excluded.customer_name,
      competence_date=excluded.competence_date,
      occurred_at=excluded.occurred_at,
      notes=case when public.financial_transactions.status='paid' then public.financial_transactions.notes else excluded.notes end,
      status=case when public.financial_transactions.status='paid' then 'paid' else 'forecast' end,
      paid_at=case when public.financial_transactions.status='paid' then public.financial_transactions.paid_at else null end;
    return;
  end if;

  v_when := coalesce(o.payment_confirmed_at, o.delivered_at, o.created_at);
  v_amount := greatest(coalesce(o.total,0),0);

  -- Pedido direto ainda não pago só vira previsão depois de entregue.
  if o.payment_status <> 'paid' and o.status <> 'delivered' then
    update public.financial_transactions set status='cancelled'
     where source_type='order' and source_id=o.id and status='forecast';
    return;
  end if;

  insert into public.financial_transactions(
    direction,status,amount,category,description,account,payment_method,source_type,source_id,order_id,
    customer_name,competence_date,due_date,occurred_at,paid_at,notes,is_system
  ) values (
    'in',case when o.payment_status='paid' then 'paid' else 'forecast' end,v_amount,'venda',
    'Recebimento de venda — '||v_ref,
    case when o.source='site' and o.payment_confirmed_by='infinitepay' then 'InfinitePay' else 'Operação' end,
    o.payment_method::text,'order',o.id,o.id,o.customer_name,
    (coalesce(o.delivered_at,o.created_at) at time zone 'America/Sao_Paulo')::date,
    case when o.payment_status='paid' then null else (coalesce(o.delivered_at,o.created_at) at time zone 'America/Sao_Paulo')::date end,
    v_when,case when o.payment_status='paid' then v_when else null end,null,true
  )
  on conflict (source_type,source_id) where source_id is not null do update set
    amount=excluded.amount,
    category=excluded.category,
    description=excluded.description,
    account=excluded.account,
    payment_method=excluded.payment_method,
    order_id=excluded.order_id,
    customer_name=excluded.customer_name,
    competence_date=excluded.competence_date,
    due_date=excluded.due_date,
    occurred_at=excluded.occurred_at,
    status=excluded.status,
    paid_at=excluded.paid_at;
end $$;

create or replace function public.trg_sync_financial_order()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.sync_financial_order(new.id);
  return new;
end $$;
drop trigger if exists trg_sync_financial_order on public.orders;
create trigger trg_sync_financial_order
after insert or update of status,total,payment_status,payment_confirmed_at,payment_timing,payment_method,delivered_at,source on public.orders
for each row execute function public.trg_sync_financial_order();

-- InfinitePay -> refinamento do mesmo lançamento do pedido com o valor realmente confirmado.
create or replace function public.trg_sync_financial_site_checkout()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_amount numeric(12,2);
  v_method text;
begin
  if new.status='paid' and new.order_id is not null then
    v_amount := coalesce(new.infinitepay_paid_amount_cents, new.infinitepay_amount_cents, round(new.total*100)::integer) / 100.0;
    v_method := case when new.payment_kind='infinitepay_pix' then 'pix' else 'card' end;
    update public.financial_transactions
       set amount=v_amount,
           status='paid',
           category='venda',
           description='Recebimento cardápio digital — InfinitePay',
           account='InfinitePay',
           payment_method=v_method,
           paid_at=coalesce(new.paid_at,new.infinitepay_verified_at,now()),
           occurred_at=coalesce(new.paid_at,new.infinitepay_verified_at,now()),
           due_date=null,
           notes='Pagamento conciliado automaticamente com a InfinitePay.'
     where source_type='order' and source_id=new.order_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_financial_site_checkout on public.site_checkout_sessions;
create trigger trg_sync_financial_site_checkout
after insert or update of status,order_id,paid_at,infinitepay_paid_amount_cents,infinitepay_amount_cents,infinitepay_verified_at,payment_kind
on public.site_checkout_sessions
for each row execute function public.trg_sync_financial_site_checkout();

-- A Receber -> previsão até pagar; quando pago, vira entrada REAL.
create or replace function public.trg_sync_financial_receivable()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.financial_transactions(
    direction,status,amount,category,description,account,source_type,source_id,receivable_id,order_id,
    customer_name,competence_date,due_date,occurred_at,paid_at,notes,is_system
  ) values (
    'in',case when new.status='paid' then 'paid' else 'forecast' end,greatest(coalesce(new.amount,0),0),'contas_receber',
    coalesce(nullif(new.description,''),'Valor a receber — '||new.customer_name),'Operação','receivable',new.id,new.id,new.order_id,
    new.customer_name,new.purchase_date,new.due_date,
    case when new.status='paid' then coalesce(new.paid_at,now()) else null end,
    case when new.status='paid' then coalesce(new.paid_at,now()) else null end,
    new.notes,true
  )
  on conflict (source_type,source_id) where source_id is not null do update set
    status=excluded.status,amount=excluded.amount,description=excluded.description,receivable_id=excluded.receivable_id,
    order_id=excluded.order_id,customer_name=excluded.customer_name,competence_date=excluded.competence_date,
    due_date=excluded.due_date,occurred_at=excluded.occurred_at,paid_at=excluded.paid_at,notes=excluded.notes;

  if new.order_id is not null then
    update public.orders
       set payment_status = case when new.status='paid' then 'paid' else 'pending' end,
           payment_confirmed_at = case when new.status='paid' then coalesce(new.paid_at,now()) else null end
     where id=new.order_id and coalesce(payment_timing,'')='later';
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_financial_receivable on public.receivables;
create trigger trg_sync_financial_receivable
after insert or update of status,amount,paid_at,due_date,purchase_date,customer_name,description,notes,order_id on public.receivables
for each row execute function public.trg_sync_financial_receivable();

-- Despesa -> previsão até pagar; quando paga, vira saída REAL.
create or replace function public.trg_sync_financial_expense()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.financial_transactions(
    direction,status,amount,category,description,account,source_type,source_id,expense_id,
    competence_date,due_date,occurred_at,paid_at,notes,is_system
  ) values (
    'out',case when new.is_paid then 'paid' else 'forecast' end,greatest(coalesce(new.amount,0),0),new.category,new.description,
    'Operação','expense',new.id,new.id,coalesce(new.competence_date,new.due_date),new.due_date,
    case when new.is_paid then coalesce(new.paid_at,now()) else null end,
    case when new.is_paid then coalesce(new.paid_at,now()) else null end,new.notes,true
  )
  on conflict (source_type,source_id) where source_id is not null do update set
    status=excluded.status,amount=excluded.amount,category=excluded.category,description=excluded.description,
    expense_id=excluded.expense_id,competence_date=excluded.competence_date,due_date=excluded.due_date,
    occurred_at=excluded.occurred_at,paid_at=excluded.paid_at,notes=excluded.notes;
  return new;
end $$;
drop trigger if exists trg_sync_financial_expense on public.expenses;
create trigger trg_sync_financial_expense
after insert or update of is_paid,amount,paid_at,due_date,competence_date,category,description,notes on public.expenses
for each row execute function public.trg_sync_financial_expense();

-- Reprocessa histórico sem apagar lançamentos manuais.
do $$ declare r record; begin
  for r in select id from public.orders loop perform public.sync_financial_order(r.id); end loop;
  for r in select id from public.receivables loop
    update public.receivables set amount=amount where id=r.id;
  end loop;
  for r in select id from public.expenses loop
    update public.expenses set amount=amount where id=r.id;
  end loop;
  -- Reaplica os dados reais da InfinitePay nos lançamentos do cardápio digital.
  update public.site_checkout_sessions set paid_at=paid_at where status='paid' and order_id is not null;
end $$;

-- Fluxo de caixa REAL: só status pago, usando dia civil de Brasília.
create or replace function public.financial_cash_daily(p_from date, p_to date)
returns table(day date, inflow numeric, outflow numeric)
language sql stable security definer set search_path=public as $$
with days as (
  select generate_series(p_from,p_to,interval '1 day')::date day
), x as (
  select (coalesce(paid_at,occurred_at,created_at) at time zone 'America/Sao_Paulo')::date day,
         sum(case when direction='in' then amount else 0 end)::numeric inflow,
         sum(case when direction='out' then amount else 0 end)::numeric outflow
  from public.financial_transactions
  where status='paid'
    and (coalesce(paid_at,occurred_at,created_at) at time zone 'America/Sao_Paulo')::date between p_from and p_to
  group by 1
)
select d.day,coalesce(x.inflow,0),coalesce(x.outflow,0)
from days d left join x using(day) order by d.day;
$$;

grant execute on function public.financial_cash_daily(date,date) to authenticated;

-- Resumo unificado para os cards do Financeiro Geral.
create or replace function public.financial_position_summary(p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path=public as $$
with realized as (
  select
    coalesce(sum(amount) filter(where direction='in'),0) cash_in,
    coalesce(sum(amount) filter(where direction='out'),0) cash_out
  from public.financial_transactions
  where status='paid'
    and (coalesce(paid_at,occurred_at,created_at) at time zone 'America/Sao_Paulo')::date between p_from and p_to
), forecast as (
  select
    coalesce(sum(amount) filter(where direction='in'),0) receivable,
    coalesce(sum(amount) filter(where direction='out'),0) payable,
    coalesce(sum(amount) filter(where direction='in' and due_date is not null and due_date < (now() at time zone 'America/Sao_Paulo')::date),0) receivable_overdue,
    coalesce(sum(amount) filter(where direction='out' and due_date is not null and due_date < (now() at time zone 'America/Sao_Paulo')::date),0) payable_overdue
  from public.financial_transactions
  where status='forecast'
)
select jsonb_build_object(
  'cash_in',realized.cash_in,
  'cash_out',realized.cash_out,
  'cash_net',realized.cash_in-realized.cash_out,
  'receivable',forecast.receivable,
  'payable',forecast.payable,
  'forecast_net',forecast.receivable-forecast.payable,
  'receivable_overdue',forecast.receivable_overdue,
  'payable_overdue',forecast.payable_overdue
) from realized,forecast;
$$;
grant execute on function public.financial_position_summary(date,date) to authenticated;

commit;

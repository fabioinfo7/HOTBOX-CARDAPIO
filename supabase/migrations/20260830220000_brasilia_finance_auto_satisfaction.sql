-- HotBox Delivery — datas comerciais em Brasília + garantia do convite automático
-- de avaliação 10 minutos após a entrega.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Fluxo de caixa: timestamptz deve ser convertido para o dia civil de Brasília
-- antes de agrupar/filtrar. Sem isso, operações entre 21:00 e 23:59 de Brasília
-- podiam cair no dia seguinte quando o banco interpretava a data em UTC.
create or replace function public.financial_cash_daily(p_from date, p_to date)
returns table(day date, inflow numeric, outflow numeric)
language sql
stable
security definer
set search_path = public
as $$
with days as (
  select generate_series(p_from, p_to, interval '1 day')::date as day
), order_cash as (
  select (coalesce(payment_confirmed_at, delivered_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
         sum(total)::numeric as amount
  from public.orders
  where payment_status = 'paid'
    and status <> 'cancelled'
    and coalesce(payment_timing,'') <> 'later'
    and (coalesce(payment_confirmed_at, delivered_at, created_at) at time zone 'America/Sao_Paulo')::date between p_from and p_to
  group by 1
), receivable_cash as (
  select ((paid_at::timestamptz) at time zone 'America/Sao_Paulo')::date as day,
         sum(amount)::numeric as amount
  from public.receivables
  where status = 'paid' and paid_at is not null
    and ((paid_at::timestamptz) at time zone 'America/Sao_Paulo')::date between p_from and p_to
  group by 1
), expense_cash as (
  select ((paid_at::timestamptz) at time zone 'America/Sao_Paulo')::date as day,
         sum(amount)::numeric as amount
  from public.expenses
  where is_paid = true and paid_at is not null
    and ((paid_at::timestamptz) at time zone 'America/Sao_Paulo')::date between p_from and p_to
  group by 1
)
select d.day,
       coalesce(o.amount,0) + coalesce(r.amount,0) as inflow,
       coalesce(e.amount,0) as outflow
from days d
left join order_cash o using(day)
left join receivable_cash r using(day)
left join expense_cash e using(day)
order by d.day;
$$;

grant execute on function public.financial_cash_daily(date,date) to authenticated;

-- Garante que o job de avaliação automática aponte para a URL pública ATUAL.
-- É idempotente e pode ser executado novamente depois de mudar o domínio.
create or replace function public.reschedule_auto_satisfaction_job()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  select app_public_url into v_url from public.store_config limit 1;

  begin
    perform cron.unschedule('auto-satisfaction-10min');
  exception when others then null;
  end;

  if v_url is not null and btrim(v_url) <> '' then
    perform cron.schedule(
      'auto-satisfaction-10min',
      '* * * * *',
      format(
        $cmd$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb)$cmd$,
        rtrim(v_url, '/') || '/api/public/hooks/satisfaction-auto',
        '{"Content-Type":"application/json"}'
      )
    );
  end if;
end;
$$;

grant execute on function public.reschedule_auto_satisfaction_job() to authenticated;
select public.reschedule_auto_satisfaction_job();

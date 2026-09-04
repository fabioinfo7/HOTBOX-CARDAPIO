-- HotBox Delivery — avaliação automática 10 minutos após entrega
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- sent_at só representa envio confirmado pelo provedor.
alter table if exists public.customer_feedback
  alter column sent_at drop not null,
  alter column sent_at drop default;

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
        $cmd$select net.http_post(url := %L, headers := %L::jsonb)$cmd$,
        rtrim(v_url, '/') || '/api/public/hooks/satisfaction-auto',
        '{"Content-Type":"application/json"}'
      )
    );
  end if;
end;
$$;

grant execute on function public.reschedule_auto_satisfaction_job() to authenticated;
select public.reschedule_auto_satisfaction_job();

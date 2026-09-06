-- HotBox Delivery - Analytics comportamental da Bio e Cardápio Digital
begin;

create table if not exists public.analytics_sessions (
  session_id text primary key,
  visitor_id text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  landing_path text,
  last_path text,
  referrer text,
  source text,
  medium text,
  campaign text,
  content text,
  term text,
  device_type text,
  browser text,
  os text,
  screen text,
  viewport text,
  language text,
  timezone text,
  user_agent text,
  pageviews integer not null default 0,
  event_count integer not null default 0,
  max_scroll integer not null default 0,
  engagement_seconds integer not null default 0,
  checkout_started_at timestamptz,
  checkout_id text,
  converted_at timestamptz,
  order_id text,
  revenue numeric(12,2) not null default 0
);

create table if not exists public.analytics_events (
  id bigserial primary key,
  session_id text not null references public.analytics_sessions(session_id) on delete cascade,
  visitor_id text not null,
  event_name text not null,
  event_category text,
  event_label text,
  page_path text,
  page_title text,
  value numeric(12,2),
  product_id text,
  product_name text,
  checkout_id text,
  order_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_occurred on public.analytics_events(occurred_at desc);
create index if not exists idx_analytics_events_session on public.analytics_events(session_id, occurred_at);
create index if not exists idx_analytics_events_name on public.analytics_events(event_name, occurred_at desc);
create index if not exists idx_analytics_sessions_started on public.analytics_sessions(started_at desc);
create index if not exists idx_analytics_sessions_source on public.analytics_sessions(source, started_at desc);
create index if not exists idx_analytics_sessions_visitor on public.analytics_sessions(visitor_id, started_at desc);

alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;
revoke all on public.analytics_sessions from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;

create or replace function public.record_analytics_event(p_event jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session text := left(coalesce(p_event->>'session_id',''),100);
  v_visitor text := left(coalesce(p_event->>'visitor_id',''),100);
  v_name text := left(coalesce(p_event->>'event_name',''),80);
  v_category text := left(coalesce(p_event->>'event_category','behavior'),60);
  v_label text := left(coalesce(p_event->>'event_label',''),140);
  v_path text := left(coalesce(p_event->>'page_path','/'),300);
  v_title text := left(coalesce(p_event->>'page_title',''),180);
  v_client jsonb := coalesce(p_event->'client','{}'::jsonb);
  v_meta jsonb := coalesce(p_event->'metadata','{}'::jsonb);
  v_at timestamptz := now();
  v_value numeric := case when (p_event->>'value') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_event->>'value')::numeric else null end;
  v_scroll int := greatest(0, least(100, case
    when coalesce(v_meta->>'max_scroll','') ~ '^[0-9]+$' then (v_meta->>'max_scroll')::int
    when v_name='scroll_depth' and v_value is not null then v_value::int
    else 0 end));
  v_engage int := greatest(0, least(86400, case
    when coalesce(v_meta->>'engagement_seconds','') ~ '^[0-9]+$' then (v_meta->>'engagement_seconds')::int
    when v_name='engagement_heartbeat' and coalesce(v_meta->>'seconds','') ~ '^[0-9]+$' then (v_meta->>'seconds')::int
    else 0 end));
begin
  if v_session = '' or v_visitor = '' or v_name = '' then return; end if;

  insert into public.analytics_sessions(
    session_id, visitor_id, started_at, last_seen_at, landing_path, last_path, referrer, source, medium, campaign, content, term,
    device_type, browser, os, screen, viewport, language, timezone, user_agent, pageviews, event_count, max_scroll, engagement_seconds
  ) values (
    v_session, v_visitor, v_at, v_at, v_path, v_path,
    left(coalesce(v_client->>'referrer',''),1000), left(coalesce(v_client->>'source','Direto'),180), left(coalesce(v_client->>'medium',''),120),
    left(coalesce(v_client->>'campaign',''),180), left(coalesce(v_client->>'content',''),180), left(coalesce(v_client->>'term',''),180),
    left(coalesce(v_client->>'device_type',''),40), left(coalesce(v_client->>'browser',''),80), left(coalesce(v_client->>'os',''),80),
    left(coalesce(v_client->>'screen',''),40), left(coalesce(v_client->>'viewport',''),40), left(coalesce(v_client->>'language',''),30),
    left(coalesce(v_client->>'timezone',''),80), left(coalesce(v_client->>'user_agent',''),500),
    case when v_name='page_view' then 1 else 0 end, 1, v_scroll, v_engage
  )
  on conflict (session_id) do update set
    last_seen_at = greatest(analytics_sessions.last_seen_at, excluded.last_seen_at),
    last_path = excluded.last_path,
    pageviews = analytics_sessions.pageviews + case when v_name='page_view' then 1 else 0 end,
    event_count = analytics_sessions.event_count + 1,
    max_scroll = greatest(analytics_sessions.max_scroll, v_scroll),
    engagement_seconds = greatest(analytics_sessions.engagement_seconds, v_engage),
    checkout_started_at = case when v_name='checkout_start' then coalesce(analytics_sessions.checkout_started_at, v_at) else analytics_sessions.checkout_started_at end,
    checkout_id = case when coalesce(p_event->>'checkout_id','')<>'' then left(p_event->>'checkout_id',100) else analytics_sessions.checkout_id end,
    converted_at = case when v_name='purchase_completed' then coalesce(analytics_sessions.converted_at, v_at) else analytics_sessions.converted_at end,
    order_id = case when coalesce(p_event->>'order_id','')<>'' then left(p_event->>'order_id',100) else analytics_sessions.order_id end,
    revenue = case when v_name in ('checkout_created','order_created','purchase_completed') and v_value is not null then greatest(analytics_sessions.revenue, v_value) else analytics_sessions.revenue end,
    ended_at = case when v_name in ('page_exit','session_end') then v_at else analytics_sessions.ended_at end;

  insert into public.analytics_events(session_id, visitor_id, event_name, event_category, event_label, page_path, page_title, value, product_id, product_name, checkout_id, order_id, metadata, occurred_at)
  values (
    v_session, v_visitor, v_name, v_category, nullif(v_label,''), v_path, nullif(v_title,''), v_value,
    nullif(left(coalesce(p_event->>'product_id',''),100),''), nullif(left(coalesce(p_event->>'product_name',''),180),''),
    nullif(left(coalesce(p_event->>'checkout_id',''),100),''), nullif(left(coalesce(p_event->>'order_id',''),100),''), v_meta, v_at
  );
end;
$$;

revoke all on function public.record_analytics_event(jsonb) from public, anon, authenticated;
grant execute on function public.record_analytics_event(jsonb) to service_role;

commit;

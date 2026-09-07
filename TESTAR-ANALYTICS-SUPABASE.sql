-- HOTBOX ANALYTICS 360 - teste de estrutura
-- Execute no SQL Editor do Supabase.

select
  to_regclass('public.analytics_sessions') as analytics_sessions,
  to_regclass('public.analytics_events') as analytics_events;

select count(*) as sessoes from public.analytics_sessions;
select count(*) as eventos from public.analytics_events;

-- HOTBOX ANALYTICS PRO — otimiza a consulta de visitantes ativos por site.
create index if not exists idx_ap_sessions_site_last_seen
  on public.analytics_pro_sessions (site_id, last_seen_at desc);

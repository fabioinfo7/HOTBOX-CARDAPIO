alter table public.store_config add column if not exists visitor_location_prompt_enabled boolean not null default false;
alter table public.analytics_sessions add column if not exists visitor_neighborhood text, add column if not exists visitor_location_source text, add column if not exists visitor_location_accuracy_m integer, add column if not exists visitor_location_captured_at timestamptz;
create index if not exists idx_analytics_sessions_visitor_neighborhood on public.analytics_sessions(visitor_neighborhood) where visitor_neighborhood is not null;

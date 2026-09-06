-- HotBox Delivery — Meta Pixel configurável pelo painel
-- O código do Pixel deixa de depender de qualquer snippet fixo no frontend.
begin;

alter table public.store_config
  add column if not exists meta_pixel_script_enabled boolean not null default false,
  add column if not exists meta_pixel_script text;

-- Somente esta função expõe o snippet ao site público.
-- Credenciais privadas de store_config não são retornadas.
create or replace function public.get_public_tracking_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'meta_pixel_script_enabled', coalesce(meta_pixel_script_enabled, false),
    'meta_pixel_script', case
      when coalesce(meta_pixel_script_enabled, false) then coalesce(meta_pixel_script, '')
      else ''
    end
  )
  from public.store_config
  where id = 1;
$$;

revoke all on function public.get_public_tracking_config() from public;
grant execute on function public.get_public_tracking_config() to anon, authenticated, service_role;

commit;

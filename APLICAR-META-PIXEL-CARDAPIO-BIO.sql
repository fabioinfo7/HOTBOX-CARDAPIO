-- HOTBOX DELIVERY
-- Meta Pixel configurável pelo painel administrativo
-- Execute uma vez no SQL Editor do Supabase.

alter table public.store_config
  add column if not exists meta_pixel_enabled boolean not null default false,
  add column if not exists meta_pixel_script text,
  add column if not exists meta_pixel_on_menu boolean not null default true,
  add column if not exists meta_pixel_on_bio boolean not null default true;

comment on column public.store_config.meta_pixel_enabled
  is 'Ativa o Meta Pixel configurado pelo painel administrativo.';

comment on column public.store_config.meta_pixel_script
  is 'Script padrão do Meta Pixel colado pelo administrador. O frontend extrai o Pixel ID e carrega a integração de forma controlada.';

comment on column public.store_config.meta_pixel_on_menu
  is 'Carrega o Meta Pixel no cardápio digital público.';

comment on column public.store_config.meta_pixel_on_bio
  is 'Carrega o Meta Pixel na página pública /bio.';

select
  meta_pixel_enabled,
  meta_pixel_on_menu,
  meta_pixel_on_bio,
  case
    when coalesce(meta_pixel_script, '') = '' then 'SEM SCRIPT'
    else 'SCRIPT SALVO'
  end as meta_pixel_status
from public.store_config
where id = 1;

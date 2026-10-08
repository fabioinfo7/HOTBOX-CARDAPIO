-- Dados internos do produto: usados exclusivamente pela atendente IA.
-- Não entram na resposta do cardápio público.
alter table public.products
  add column if not exists menu_number integer,
  add column if not exists ai_information text;

alter table public.products
  drop constraint if exists products_menu_number_positive;

alter table public.products
  add constraint products_menu_number_positive
  check (menu_number is null or menu_number > 0);

create unique index if not exists idx_products_unique_menu_number
  on public.products(menu_number)
  where menu_number is not null;

comment on column public.products.menu_number is
  'Número interno do item no cardápio, usado pela IA para reconhecer pedidos como "quero o 5".';
comment on column public.products.ai_information is
  'Informações internas para consulta exclusiva da atendente IA; não exibir no cardápio público.';

create or replace function public.get_public_menu_products()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) - 'menu_number' - 'ai_information'
  from public.products p
  where p.active = true
  order by p.name;
$$;

revoke all on function public.get_public_menu_products() from public;
grant execute on function public.get_public_menu_products() to anon, authenticated;

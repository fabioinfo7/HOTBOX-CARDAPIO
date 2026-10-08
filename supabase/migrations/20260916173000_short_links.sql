-- Encurtador de links da HotBox: URLs públicas com apelido personalizado.
create table if not exists public.short_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  destination_url text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint short_links_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  constraint short_links_slug_reserved check (slug not in ('api', 'app', 'bio', 'admin', 'entregador', 'pedido', 'produto', 'avaliacao', 'checkout', 'obrigado', 'meus-pedidos', 'politica-de-privacidade')),
  constraint short_links_destination_url check (destination_url ~* '^https?://[^[:space:]]+$')
);

create index if not exists idx_short_links_created_at on public.short_links(created_at desc);

alter table public.short_links enable row level security;

drop policy if exists "public resolves active short links" on public.short_links;
create policy "public resolves active short links" on public.short_links
for select using (active = true);

drop policy if exists "store admin manages short links" on public.short_links;
create policy "store admin manages short links" on public.short_links
for all to authenticated
using (public.has_role(auth.uid(), 'store_admin'))
with check (public.has_role(auth.uid(), 'store_admin'));

grant select on public.short_links to anon, authenticated;
grant insert, update, delete on public.short_links to authenticated;
grant all on public.short_links to service_role;

comment on table public.short_links is 'Links curtos personalizados do domínio da HotBox, com redirecionamento para URLs externas ou internas.';

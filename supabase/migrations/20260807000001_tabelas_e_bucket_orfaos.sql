-- ============================================================
-- TABELAS E BUCKET "ÓRFÃOS" — existiam no projeto antigo (Lovable) mas
-- foram criados manualmente pelo painel (Table Editor / Storage), nunca
-- capturados em nenhuma migration. Por isso não vieram no schema
-- reconstruído a partir das migrations. Reconstruídos aqui a partir do
-- schema real (arquivo types.ts gerado pelo Supabase) e do uso no código.
-- ============================================================

-- ============ MENU_IMAGES (imagens do cardápio enviadas via WhatsApp) ============
create table if not exists public.menu_images (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  storage_path text not null,
  filename text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.menu_images to authenticated;
grant all on public.menu_images to service_role;
alter table public.menu_images enable row level security;
drop policy if exists "admins manage menu images" on public.menu_images;
create policy "admins manage menu images" on public.menu_images for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));

-- Bucket de storage para as imagens do cardápio
insert into storage.buckets (id, name, public)
values ('cardapio-imagens', 'cardapio-imagens', true)
on conflict (id) do nothing;

drop policy if exists "public read cardapio imagens" on storage.objects;
create policy "public read cardapio imagens" on storage.objects for select
  using (bucket_id = 'cardapio-imagens');

drop policy if exists "admins upload cardapio imagens" on storage.objects;
create policy "admins upload cardapio imagens" on storage.objects for insert to authenticated
  with check (bucket_id = 'cardapio-imagens' and public.has_role(auth.uid(), 'store_admin'));

drop policy if exists "admins update cardapio imagens" on storage.objects;
create policy "admins update cardapio imagens" on storage.objects for update to authenticated
  using (bucket_id = 'cardapio-imagens' and public.has_role(auth.uid(), 'store_admin'));

drop policy if exists "admins delete cardapio imagens" on storage.objects;
create policy "admins delete cardapio imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'cardapio-imagens' and public.has_role(auth.uid(), 'store_admin'));


-- ============ AI_INSTRUCTIONS (instruções globais/diárias pra IA de atendimento) ============
create table if not exists public.ai_instructions (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  content text not null,
  active boolean not null default true,
  valid_date date,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ai_instructions to authenticated;
grant all on public.ai_instructions to service_role;
alter table public.ai_instructions enable row level security;
drop policy if exists "admins manage ai instructions" on public.ai_instructions;
create policy "admins manage ai instructions" on public.ai_instructions for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ AUDIT_LOG (trilha de auditoria — populado por trigger/backend) ============
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  user_email text,
  created_at timestamptz not null default now()
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log" on public.audit_log for select to authenticated
  using (public.has_role(auth.uid(), 'store_admin'));


-- ============ BAIRROS_ATENDIDOS (bairros com entrega por motoboy próprio) ============
create table if not exists public.bairros_atendidos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.bairros_atendidos to authenticated;
grant all on public.bairros_atendidos to service_role;
alter table public.bairros_atendidos enable row level security;
drop policy if exists "admins manage bairros atendidos" on public.bairros_atendidos;
create policy "admins manage bairros atendidos" on public.bairros_atendidos for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ PRODUCT_CATEGORIES (categorias do cardápio) ============
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.product_categories to authenticated;
grant all on public.product_categories to service_role;
alter table public.product_categories enable row level security;
drop policy if exists "admins manage product categories" on public.product_categories;
create policy "admins manage product categories" on public.product_categories for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ COMBO_ITEMS (itens incluídos em produtos-combo) ============
create table if not exists public.combo_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  included_product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.combo_items to authenticated;
grant all on public.combo_items to service_role;
alter table public.combo_items enable row level security;
drop policy if exists "admins manage combo items" on public.combo_items;
create policy "admins manage combo items" on public.combo_items for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ RECEIVABLE_ITEMS (itens de contas a receber) ============
create table if not exists public.receivable_items (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  description text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  cost_price numeric not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.receivable_items to authenticated;
grant all on public.receivable_items to service_role;
alter table public.receivable_items enable row level security;
drop policy if exists "admins manage receivable items" on public.receivable_items;
create policy "admins manage receivable items" on public.receivable_items for all to authenticated
  using (public.has_role(auth.uid(), 'store_admin'))
  with check (public.has_role(auth.uid(), 'store_admin'));


-- ============ CUSTOMER_ADDRESS_CACHE (cache de geocodificação — só backend) ============
create table if not exists public.customer_address_cache (
  phone text primary key,
  address_normalized text not null,
  lat numeric not null,
  lng numeric not null,
  updated_at timestamptz not null default now()
);
grant all on public.customer_address_cache to service_role;
alter table public.customer_address_cache enable row level security;
-- Sem policy para authenticated/anon de propósito: só o backend
-- (supabaseAdmin, service_role) usa essa tabela.


-- ============ META_PROCESSED_MESSAGES (dedup de mensagens do webhook Meta — só backend) ============
create table if not exists public.meta_processed_messages (
  message_id text primary key,
  created_at timestamptz not null default now()
);
grant all on public.meta_processed_messages to service_role;
alter table public.meta_processed_messages enable row level security;
-- Sem policy para authenticated/anon de propósito: só o webhook
-- (supabaseAdmin, service_role) usa essa tabela.


-- ============ NFOOD_PRODUCT_MAP (mapeamento de produtos com a 99Food — só backend) ============
create table if not exists public.nfood_product_map (
  nfood_item_id text primary key,
  nfood_item_name text,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);
grant all on public.nfood_product_map to service_role;
alter table public.nfood_product_map enable row level security;
-- Sem policy para authenticated/anon de propósito: só o backend
-- (supabaseAdmin, service_role) usa essa tabela.

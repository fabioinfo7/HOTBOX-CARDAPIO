
-- ============ ENUMS ============
create type public.app_role as enum ('store_admin','deliverer');
create type public.product_kind as enum ('recipe','beverage');
create type public.order_status as enum (
  'pending_review','pending','preparing','ready_pickup',
  'out_for_delivery','delivered','failed','cancelled'
);
create type public.payment_method as enum ('pix','card');
create type public.order_source as enum ('site','whatsapp');
create type public.pix_mode as enum ('static','dynamic');

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create policy "users read own roles" on public.user_roles for select
  to authenticated using (auth.uid() = user_id);
create policy "admins read all roles" on public.user_roles for select
  to authenticated using (public.has_role(auth.uid(),'store_admin'));
create policy "admins manage roles" on public.user_roles for all
  to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "admins read all profiles" on public.profiles for select to authenticated
  using (public.has_role(auth.uid(),'store_admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ STORE CONFIG ============
create table public.store_config (
  id int primary key default 1 check (id = 1),
  store_name text not null default 'Minha Loja',
  pix_key text,
  pix_copia_cola text,
  pix_mode pix_mode not null default 'static',
  whatsapp_number text,
  evolution_api_url text,
  evolution_api_token text,
  evolution_instance text,
  alarm_sound_url text,
  default_delivery_fee numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.store_config to authenticated;
grant all on public.store_config to service_role;
alter table public.store_config enable row level security;
create policy "admins read config" on public.store_config for select to authenticated
  using (public.has_role(auth.uid(),'store_admin'));
create policy "admins update config" on public.store_config for update to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));
create policy "admins insert config" on public.store_config for insert to authenticated
  with check (public.has_role(auth.uid(),'store_admin'));
insert into public.store_config(id) values (1) on conflict do nothing;

-- ============ LEADS ============
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text not null unique,
  first_order_at timestamptz not null default now(),
  last_order_at timestamptz not null default now(),
  order_count int not null default 0,
  total_spent numeric(12,2) not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "admins manage leads" on public.leads for all to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

-- ============ INGREDIENTS ============
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  unit text not null default 'un',
  purchase_price numeric(12,2) not null default 0,
  purchase_quantity numeric(12,3) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ingredients to authenticated;
grant all on public.ingredients to service_role;
alter table public.ingredients enable row level security;
create policy "admins manage ingredients" on public.ingredients for all to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

-- ============ PRODUCTS ============
create table public.products (
  id uuid primary key default gen_random_uuid(),
  kind product_kind not null default 'recipe',
  name text not null,
  description text,
  category text,
  cost_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.products to anon;
grant select, insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;
create policy "public read active products" on public.products for select
  to anon, authenticated using (active = true or public.has_role(auth.uid(),'store_admin'));
create policy "admins manage products" on public.products for all to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

-- ============ RECIPE ITEMS ============
create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,3) not null default 0
);
grant select, insert, update, delete on public.recipe_items to authenticated;
grant all on public.recipe_items to service_role;
alter table public.recipe_items enable row level security;
create policy "admins manage recipe items" on public.recipe_items for all to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

create or replace function public.compute_recipe_cost(_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ri.quantity * (i.purchase_price / nullif(i.purchase_quantity,0))),0)::numeric(12,2)
  from public.recipe_items ri
  join public.ingredients i on i.id = ri.ingredient_id
  where ri.product_id = _product_id
$$;

-- ============ DELIVERERS ============
create table public.deliverers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  vehicle text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select on public.deliverers to authenticated;
grant insert, update on public.deliverers to authenticated;
grant all on public.deliverers to service_role;
alter table public.deliverers enable row level security;
create policy "read own deliverer" on public.deliverers for select to authenticated using (auth.uid() = id);
create policy "insert own deliverer" on public.deliverers for insert to authenticated with check (auth.uid() = id);
create policy "update own deliverer" on public.deliverers for update to authenticated using (auth.uid() = id);
create policy "admins read deliverers" on public.deliverers for select to authenticated
  using (public.has_role(auth.uid(),'store_admin'));
create policy "admins update deliverers" on public.deliverers for update to authenticated
  using (public.has_role(auth.uid(),'store_admin'));

-- ============ ORDERS ============
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial not null unique,
  source order_source not null default 'site',
  customer_name text not null,
  customer_phone text not null,
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_reference text,
  notes text,
  payment_method payment_method not null,
  payment_link text,
  pix_code text,
  payment_status text not null default 'pending',
  status order_status not null default 'pending',
  subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  deliverer_id uuid references public.deliverers(id) on delete set null,
  deliverer_name text,
  failure_reason text,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ready_at timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at timestamptz
);
grant select on public.orders to anon;
grant insert on public.orders to anon;
grant select, insert, update, delete on public.orders to authenticated;
grant all on public.orders to service_role;
alter table public.orders enable row level security;

-- anon can insert new orders from customer site
create policy "anon can insert orders" on public.orders for insert to anon
  with check (source = 'site' and status in ('pending','pending_review'));
create policy "authenticated can insert orders" on public.orders for insert to authenticated
  with check (true);
-- customers can look up an order they just created by id (they hold the id)
create policy "public read by id" on public.orders for select to anon using (true);
create policy "authenticated read orders" on public.orders for select to authenticated using (
  public.has_role(auth.uid(),'store_admin')
  or (public.has_role(auth.uid(),'deliverer') and (
    status = 'ready_pickup' or deliverer_id = auth.uid()
  ))
);
create policy "admins update orders" on public.orders for update to authenticated
  using (public.has_role(auth.uid(),'store_admin'));
-- deliverers can claim an unassigned ready order (atomic via WHERE clause in client)
create policy "deliverer claim/update assigned" on public.orders for update to authenticated
  using (
    public.has_role(auth.uid(),'deliverer') and (
      deliverer_id is null and status = 'ready_pickup'
      or deliverer_id = auth.uid()
    )
  )
  with check (
    public.has_role(auth.uid(),'deliverer') and (deliverer_id = auth.uid() or deliverer_id is null)
  );
create policy "admins delete orders" on public.orders for delete to authenticated
  using (public.has_role(auth.uid(),'store_admin'));

-- ============ ORDER ITEMS ============
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity int not null default 1,
  unit_price numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert on public.order_items to anon;
grant select, insert, update, delete on public.order_items to authenticated;
grant all on public.order_items to service_role;
alter table public.order_items enable row level security;
create policy "anon insert order items" on public.order_items for insert to anon with check (true);
create policy "public read order items" on public.order_items for select to anon using (true);
create policy "authenticated read items" on public.order_items for select to authenticated using (
  public.has_role(auth.uid(),'store_admin')
  or public.has_role(auth.uid(),'deliverer')
);
create policy "admins manage items" on public.order_items for all to authenticated
  using (public.has_role(auth.uid(),'store_admin'))
  with check (public.has_role(auth.uid(),'store_admin'));

-- ============ LEAD UPSERT TRIGGER ============
create or replace function public.upsert_lead_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare _lead_id uuid;
begin
  insert into public.leads(name, phone, last_order_at, order_count, total_spent)
  values (new.customer_name, new.customer_phone, now(), 1, new.total)
  on conflict (phone) do update set
    name = coalesce(public.leads.name, excluded.name),
    last_order_at = now(),
    order_count = public.leads.order_count + 1,
    total_spent = public.leads.total_spent + excluded.total_spent
  returning id into _lead_id;
  new.lead_id := _lead_id;
  return new;
end $$;
create trigger trg_upsert_lead before insert on public.orders
for each row execute function public.upsert_lead_from_order();

-- ============ UPDATED_AT TRIGGERS ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger t_ingredients_updated before update on public.ingredients for each row execute function public.set_updated_at();
create trigger t_products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger t_store_config_updated before update on public.store_config for each row execute function public.set_updated_at();

-- ============ REALTIME ============
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.deliverers;

-- ============ INDEXES ============
create index idx_orders_status on public.orders(status);
create index idx_orders_created on public.orders(created_at desc);
create index idx_orders_deliverer on public.orders(deliverer_id);
create index idx_order_items_order on public.order_items(order_id);
create index idx_recipe_items_product on public.recipe_items(product_id);
create index idx_leads_phone on public.leads(phone);

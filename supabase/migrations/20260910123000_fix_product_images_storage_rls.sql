-- HOTBOX — correção do upload de imagens de produtos no Supabase Storage
-- Erro corrigido: "new row violates row-level security policy"
--
-- A tela de produtos envia as imagens para o bucket "product-images".
-- Esta migration libera o gerenciamento desse bucket SOMENTE para usuários
-- internos cadastrados em public.user_roles, excluindo perfis de entregador
-- e eventuais perfis de cliente.
--
-- É segura para executar mais de uma vez.

-- Garante que o bucket exista e continue público para as imagens do cardápio.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update
set public = true;

-- Função auxiliar protegida. SECURITY DEFINER evita que uma policy de RLS em
-- user_roles impeça a própria checagem de permissão.
create or replace function public.can_manage_store_assets()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and lower(ur.role::text) not in ('deliverer', 'customer', 'cliente')
  );
$$;

revoke all on function public.can_manage_store_assets() from public;
grant execute on function public.can_manage_store_assets() to authenticated;

-- Recria somente as policies próprias da HotBox.
drop policy if exists "hotbox_product_images_insert" on storage.objects;
drop policy if exists "hotbox_product_images_update" on storage.objects;
drop policy if exists "hotbox_product_images_delete" on storage.objects;
drop policy if exists "hotbox_product_images_select" on storage.objects;

create policy "hotbox_product_images_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.can_manage_store_assets()
);

-- Necessária também porque o código usa upload(..., { upsert: true }).
create policy "hotbox_product_images_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.can_manage_store_assets()
)
with check (
  bucket_id = 'product-images'
  and public.can_manage_store_assets()
);

create policy "hotbox_product_images_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.can_manage_store_assets()
);

create policy "hotbox_product_images_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-images'
  and public.can_manage_store_assets()
);

notify pgrst, 'reload schema';

-- Diagnóstico opcional após executar:
-- select auth.uid();
-- select user_id, role from public.user_roles where user_id = auth.uid();

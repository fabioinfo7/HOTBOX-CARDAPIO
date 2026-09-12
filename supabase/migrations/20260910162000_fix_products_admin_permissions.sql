-- HOTBOX — correção de permissões da tabela products
-- Corrige: "permission denied for table products"
--
-- O painel administrativo usa o cliente autenticado do Supabase diretamente
-- para listar, criar, editar, ativar/desativar, destacar e excluir produtos.
-- Portanto, além das policies de RLS, a role "authenticated" precisa ter
-- privilégios SQL na tabela.
--
-- Esta migration:
-- 1) devolve SELECT/INSERT/UPDATE/DELETE para usuários autenticados;
-- 2) mantém RLS ligado;
-- 3) restringe as operações a usuários internos cadastrados em user_roles;
-- 4) NÃO libera edição pública/anon;
-- 5) pode ser executada mais de uma vez.

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Permissões de tabela necessárias antes mesmo de o PostgreSQL avaliar o RLS.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.products
TO authenticated;

-- Função segura para reconhecer usuário interno do painel.
CREATE OR REPLACE FUNCTION public.can_manage_products()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND lower(ur.role::text) NOT IN ('deliverer', 'customer', 'cliente')
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_products() TO authenticated;

-- Remove somente as policies desta correção para torná-la idempotente.
DROP POLICY IF EXISTS "hotbox_products_admin_select" ON public.products;
DROP POLICY IF EXISTS "hotbox_products_admin_insert" ON public.products;
DROP POLICY IF EXISTS "hotbox_products_admin_update" ON public.products;
DROP POLICY IF EXISTS "hotbox_products_admin_delete" ON public.products;

CREATE POLICY "hotbox_products_admin_select"
ON public.products
FOR SELECT
TO authenticated
USING (public.can_manage_products());

CREATE POLICY "hotbox_products_admin_insert"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_products());

CREATE POLICY "hotbox_products_admin_update"
ON public.products
FOR UPDATE
TO authenticated
USING (public.can_manage_products())
WITH CHECK (public.can_manage_products());

CREATE POLICY "hotbox_products_admin_delete"
ON public.products
FOR DELETE
TO authenticated
USING (public.can_manage_products());

NOTIFY pgrst, 'reload schema';

-- Diagnóstico opcional:
-- SELECT auth.uid();
-- SELECT user_id, role FROM public.user_roles WHERE user_id = auth.uid();

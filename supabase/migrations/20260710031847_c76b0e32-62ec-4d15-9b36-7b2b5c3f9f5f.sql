
-- Permite que qualquer usuário autenticado se registre como entregador.
CREATE OR REPLACE FUNCTION public.register_deliverer(_full_name text, _phone text, _vehicle text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _uid uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'not authenticated'; end if;
  insert into public.deliverers(id, full_name, phone, vehicle, active)
    values (_uid, _full_name, _phone, _vehicle, true)
    on conflict (id) do update set
      full_name = excluded.full_name,
      phone = excluded.phone,
      vehicle = excluded.vehicle;
  insert into public.user_roles(user_id, role)
    values (_uid, 'deliverer')
    on conflict do nothing;
  return true;
end;
$$;

-- Admin: conceder/revogar papel de entregador
CREATE OR REPLACE FUNCTION public.admin_set_deliverer_role(_user_id uuid, _grant boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if not public.has_role(auth.uid(), 'store_admin') then
    raise exception 'forbidden';
  end if;
  if _grant then
    insert into public.user_roles(user_id, role) values (_user_id, 'deliverer')
      on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user_id and role = 'deliverer';
  end if;
  return true;
end;
$$;

GRANT EXECUTE ON FUNCTION public.register_deliverer(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_deliverer_role(uuid, boolean) TO authenticated;

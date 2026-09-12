
create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
declare _uid uuid; _has_any boolean;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'not authenticated'; end if;
  select exists(select 1 from public.user_roles where role='store_admin') into _has_any;
  if _has_any then return false; end if;
  insert into public.user_roles(user_id, role) values (_uid, 'store_admin')
    on conflict do nothing;
  return true;
end $$;
revoke all on function public.claim_first_admin() from public;
grant execute on function public.claim_first_admin() to authenticated;

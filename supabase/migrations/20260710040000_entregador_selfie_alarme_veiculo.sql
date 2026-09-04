
-- ============ ENTREGADOR: selfie obrigatória + inativo por padrão ============
ALTER TABLE public.deliverers ADD COLUMN IF NOT EXISTS selfie_url text;
ALTER TABLE public.deliverers ALTER COLUMN active SET DEFAULT false;

-- ============ PEDIDOS: guarda o veículo de quem aceitou ============
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deliverer_vehicle text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS accepted_by_deliverer_at timestamptz;

-- ============ CONFIG: som de alarme separado para o app do entregador ============
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS deliverer_alarm_sound_url text;

-- ============ CADASTRO DE ENTREGADOR: agora exige selfie e sempre entra inativo ============
DROP FUNCTION IF EXISTS public.register_deliverer(text, text, text);

CREATE OR REPLACE FUNCTION public.register_deliverer(_full_name text, _phone text, _vehicle text, _selfie_url text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _uid uuid;
begin
  _uid := auth.uid();
  if _uid is null then raise exception 'not authenticated'; end if;
  if _selfie_url is null or _selfie_url = '' then
    raise exception 'Selfie é obrigatória para concluir o cadastro';
  end if;
  insert into public.deliverers(id, full_name, phone, vehicle, selfie_url, active)
    values (_uid, _full_name, _phone, _vehicle, _selfie_url, false)
    on conflict (id) do update set
      full_name = excluded.full_name,
      phone = excluded.phone,
      vehicle = excluded.vehicle,
      selfie_url = excluded.selfie_url;
  insert into public.user_roles(user_id, role)
    values (_uid, 'deliverer')
    on conflict do nothing;
  return true;
end;
$$;

REVOKE ALL ON FUNCTION public.register_deliverer(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_deliverer(text, text, text, text) TO authenticated;

-- ============ STORAGE: selfies dos entregadores ============
insert into storage.buckets (id, name, public)
values ('deliverer-selfies', 'deliverer-selfies', true)
on conflict (id) do nothing;

create policy "public read selfies" on storage.objects for select
  using (bucket_id = 'deliverer-selfies');
create policy "auth upload own selfie" on storage.objects for insert to authenticated
  with check (bucket_id = 'deliverer-selfies');

-- ============ STORAGE: sons de alarme (admin e entregador) ============
insert into storage.buckets (id, name, public)
values ('alarm-sounds', 'alarm-sounds', true)
on conflict (id) do nothing;

create policy "public read alarms" on storage.objects for select
  using (bucket_id = 'alarm-sounds');
create policy "admins upload alarms" on storage.objects for insert to authenticated
  with check (bucket_id = 'alarm-sounds' and public.has_role(auth.uid(),'store_admin'));
create policy "admins update alarms" on storage.objects for update to authenticated
  using (bucket_id = 'alarm-sounds' and public.has_role(auth.uid(),'store_admin'));
create policy "admins delete alarms" on storage.objects for delete to authenticated
  using (bucket_id = 'alarm-sounds' and public.has_role(auth.uid(),'store_admin'));

begin;

-- The portal can update only the authenticated Cliente's logo.  The actor
-- identity is supplied by the Edge gateway and the object namespace is fixed
-- to that identity; no caller-provided Cliente id or bucket is accepted.
create or replace function public.api_set_own_client_logo(object_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.cuentas
    where id = actor_id and rol = 'cliente' and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Cliente can change its logo';
  end if;

  if object_path is null
     or left(object_path, length('clients/' || actor_id::text || '/')) <> ('clients/' || actor_id::text || '/')
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'client-logos' and name = object_path
     ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Logo object is not authorized';
  end if;

  update public.clientes
  set logo_bucket = 'client-logos', logo_path = object_path
  where cuenta_id = actor_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;

  select jsonb_build_object(
    'id', cuenta_id,
    'logo_url', jsonb_build_object('bucket', logo_bucket, 'path', logo_path)
  ) into result
  from public.clientes where cuenta_id = actor_id;
  return result;
end;
$$;

revoke all on function public.api_set_own_client_logo(text) from public, anon, authenticated;
grant execute on function public.api_set_own_client_logo(text) to service_role;

commit;

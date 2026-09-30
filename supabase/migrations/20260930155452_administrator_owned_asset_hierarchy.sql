begin;

-- An administrative hierarchy must always be attached to an existing Cliente.
-- Do not silently fall back to auth.uid(): that would make a Yacimiento owned
-- by the administrator when the client selector is accidentally omitted.
create or replace function public.api_create_yacimiento_for_actor(
  target_client uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.yacimientos;
  owner_id uuid := coalesce(target_client, auth.uid());
  actor_is_admin boolean := public.api_actor_is_admin();
begin
  perform public.require_authenticated_cuenta();

  if actor_is_admin then
    if target_client is null then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'A Cliente is required to create a Yacimiento';
    end if;
    if not exists (
      select 1
      from public.cuentas c
      join public.clientes client on client.cuenta_id = c.id
      where c.id = target_client
        and c.rol = 'cliente'
        and c.activo
    ) then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'The target account is not an active Cliente';
    end if;
  elsif owner_id <> auth.uid()
    or not exists (
      select 1
      from public.cuentas c
      join public.clientes client on client.cuenta_id = c.id
      where c.id = auth.uid()
        and c.rol = 'cliente'
        and c.activo
    ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only the owning Cliente or an Administrador can create a Yacimiento';
  end if;

  insert into public.yacimientos(cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (
    owner_id,
    public.require_asset_name(asset_name),
    public.require_nonblank(asset_provincia, 'Provincia'),
    public.require_nonblank(asset_operadora, 'Operadora'),
    public.require_nonblank(asset_contratista, 'Contratista')
  )
  returning * into result;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'jerarquia', result.id, result.id, auth.uid(),
    jsonb_build_object('event', 'created', 'kind', 'yacimiento', 'cliente_cuenta_id', owner_id)
  );

  return result;
end;
$$;

grant execute on function public.api_create_yacimiento_for_actor(uuid, text, text, text, text) to service_role;

commit;

begin;

-- Administrative scheduling starts with an Administrador creating a canonical
-- Solicitud for a specific Cliente/Yacimiento. Keep the Cliente-owned request
-- RPC intact for compatibility callers.
create or replace function public.api_admin_create_service_request(
  target_client uuid,
  target_yacimiento uuid,
  selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();

  if not exists (
    select 1
    from public.cuentas actor
    where actor.id = auth.uid()
      and actor.rol in ('administrador_regular', 'super_administrador')
      and actor.activo
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only an active Administrador can create a service request';
  end if;

  if not exists (
    select 1
    from public.cuentas client_account
    join public.clientes client on client.cuenta_id = client_account.id
    where client_account.id = target_client
      and client_account.rol = 'cliente'
      and client_account.activo
      and client.activo
  ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'Cliente not found';
  end if;

  if not exists (
    select 1
    from public.yacimientos y
    where y.id = target_yacimiento
      and y.cliente_cuenta_id = target_client
  ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'The selected Cliente does not own the Yacimiento';
  end if;

  insert into public.solicitudes_servicio(yacimiento_id, cliente_cuenta_id)
  values (target_yacimiento, target_client)
  returning * into result;

  perform public.api_replace_service_selection(result.id, target_yacimiento, selections);

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', target_yacimiento, result.id, auth.uid(),
    jsonb_build_object('event', 'request_created', 'origin', 'administrator')
  );

  return public.api_service_request(result.id);
end;
$$;

revoke all on function public.api_admin_create_service_request(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_admin_create_service_request(uuid, uuid, jsonb)
  to service_role;

commit;

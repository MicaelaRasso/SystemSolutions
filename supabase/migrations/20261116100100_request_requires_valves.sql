-- D1: se quita la «Válvula 1» automática de la creación de tareas (decisión del cliente). Si un
-- equipo seleccionado no tiene válvulas, la solicitud se rechaza con un error claro y el formulario
-- ofrece cargarlas. Base: la definición de 20261112000001 (sin otros cambios).
begin;

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
  selection jsonb;
  selection_id uuid;
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
      -- Un Cliente invitado que todavía no activó su cuenta queda en 'pendiente' (activo = false):
      -- se le pueden crear solicitudes. Las cuentas deshabilitadas y los Clientes inactivos no.
      and client_account.estado in ('activa', 'pendiente')
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

  if jsonb_typeof(selections) = 'array' then
    for selection in select value from jsonb_array_elements(selections) loop
      if selection->>'kind' = 'equipo' then
        begin
          selection_id := (selection->>'id')::uuid;
        exception when invalid_text_representation then
          selection_id := null;
        end;
        -- D1: ya no se crea una «Válvula 1» automática. Un equipo sin válvulas no puede ser parte
        -- de una tarea: hay que cargarle sus válvulas primero.
        if selection_id is not null
          and exists (
            select 1
            from public.equipos_unidades e
            join public.plantas_locaciones p on p.id = e.planta_id
            where e.id = selection_id
              and p.yacimiento_id = target_yacimiento
          )
          and not exists (
            select 1
            from public.valvulas v
            where v.equipo_id = selection_id
          )
        then
          raise exception using
            errcode = 'invalid_parameter_value',
            message = 'The selected Equipo has no Válvulas';
        end if;
      end if;
    end loop;
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

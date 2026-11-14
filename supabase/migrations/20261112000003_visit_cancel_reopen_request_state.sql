begin;

-- S6 y S7: el estado de la Solicitud de servicio se recalcula a partir de sus Visitas al cancelar
-- o reabrir una visita, en lugar de forzarlo:
--   * cancelar una visita ya no cancela toda la solicitud si le queda otra visita activa o
--     completada (por ejemplo, al cancelar una visita de seguimiento);
--   * reabrir una visita cancelada que había sido aceptada limpia su accepted_at (el CHECK de
--     visitas_servicio prohíbe 'programada' con accepted_at) y deja la solicitud coherente.

-- Recalcula el estado de la solicitud desde sus visitas y devuelve el estado resultante:
--   * alguna visita aceptada, en curso o completada: 'aceptada' (conserva la aceptación, así las
--     visitas de seguimiento siguen siendo posibles);
--   * si no, alguna visita solicitada o programada: 'pendiente', sin aceptación ni taller, para
--     que se pueda volver a programar;
--   * si no queda ninguna visita viva: 'cancelada'.
-- Uso interno de los RPC de visitas (no es un endpoint).
create or replace function public.refresh_service_request_state(target_request uuid)
returns public.estado_solicitud
language plpgsql
set search_path = public
as $$
declare
  request_row public.solicitudes_servicio;
  accepted_visit public.visitas_servicio;
begin
  select * into request_row
  from public.solicitudes_servicio
  where id = target_request
  for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;

  select * into accepted_visit
  from public.visitas_servicio v
  where v.solicitud_id = target_request
    and v.estado in ('aceptada', 'en_curso', 'completada')
  order by v.accepted_at desc nulls last, v.starts_at desc, v.id
  limit 1;

  if accepted_visit.id is not null then
    update public.solicitudes_servicio
    set estado = 'aceptada',
        accepted_at = coalesce(accepted_at, accepted_visit.accepted_at, now()),
        taller_movil_id = coalesce(taller_movil_id, accepted_visit.taller_movil_id),
        updated_at = now()
    where id = target_request
      and (estado <> 'aceptada' or accepted_at is null or taller_movil_id is null);
    return 'aceptada';
  end if;

  if exists (
    select 1 from public.visitas_servicio v
    where v.solicitud_id = target_request and v.estado in ('solicitada', 'programada')
  ) then
    update public.solicitudes_servicio
    set estado = 'pendiente', accepted_at = null, taller_movil_id = null, updated_at = now()
    where id = target_request
      and (estado <> 'pendiente' or accepted_at is not null or taller_movil_id is not null);
    return 'pendiente';
  end if;

  update public.solicitudes_servicio
  set estado = 'cancelada', updated_at = now()
  where id = target_request and estado <> 'cancelada';
  return 'cancelada';
end;
$$;

revoke all on function public.refresh_service_request_state(uuid)
  from public, anon, authenticated, service_role;

-- Base: 20261005160000. Cambia solo el efecto sobre la solicitud y su asignación.
create or replace function public.api_admin_cancel_visit(visit_id uuid, action_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio;
  owner_id uuid;
  previous_status public.estado_visita;
  request_state public.estado_solicitud;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can cancel a visit';
  end if;
  if nullif(btrim(action_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A reason is required to cancel a visit';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado not in ('programada', 'aceptada') then
    raise exception using errcode = 'check_violation', message = 'Only a visit that has not started can be cancelled by an Administrador';
  end if;
  previous_status := visit_row.estado;

  update public.visitas_servicio
  set estado = 'cancelada', cancelled_at = now(), updated_at = now()
  where id = visit_id returning * into visit_row;
  delete from public.visita_equipos where visita_id = visit_id;

  request_state := public.refresh_service_request_state(visit_row.solicitud_id);
  -- La asignación activa termina cuando la solicitud queda cancelada, o cuando se cancela la
  -- visita aceptada y ninguna otra visita de la solicitud sigue aceptada o en curso.
  if request_state = 'cancelada' or (
    previous_status = 'aceptada' and not exists (
      select 1 from public.visitas_servicio other
      where other.solicitud_id = visit_row.solicitud_id
        and other.id <> visit_id
        and other.estado in ('aceptada', 'en_curso')
    )
  ) then
    update public.asignaciones_servicio
    set estado = 'finalizada', ended_at = now()
    where solicitud_id = visit_row.solicitud_id and estado = 'activa';
  end if;

  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_cancelled_by_administrator', 'estado_anterior', previous_status,
      'reason', btrim(action_reason), 'estado_solicitud', request_state));
  perform public.record_audit_event(
    'visita_cancelada_por_administrador', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', previous_status, 'estado_nuevo', visit_row.estado,
      'reason', btrim(action_reason), 'estado_solicitud', request_state),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', visit_row.taller_movil_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

-- Base: 20261005160000 (cancelación por el Cliente). Mismo cambio que la del Administrador.
create or replace function public.api_cancel_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio;
  request_row public.solicitudes_servicio;
  previous_status public.estado_visita;
  request_state public.estado_solicitud;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  select * into request_row from public.solicitudes_servicio where id = visit_row.solicitud_id for update;
  if not exists (
    select 1 from public.cuentas where id = auth.uid() and rol = 'cliente'
  ) or request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can cancel this visit';
  end if;
  if visit_row.estado not in ('programada', 'aceptada')
    or (visit_row.starts_at at time zone 'America/Argentina/Buenos_Aires')::date
       <= (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = 'check_violation', message = 'A visit can only be cancelled before its execution day and before work starts';
  end if;
  previous_status := visit_row.estado;

  update public.visitas_servicio
  set estado = 'cancelada', cancelled_at = now(), updated_at = now()
  where id = visit_id returning * into visit_row;
  delete from public.visita_equipos where visita_id = visit_id;

  request_state := public.refresh_service_request_state(visit_row.solicitud_id);
  if request_state = 'cancelada' or (
    previous_status = 'aceptada' and not exists (
      select 1 from public.visitas_servicio other
      where other.solicitud_id = visit_row.solicitud_id
        and other.id <> visit_id
        and other.estado in ('aceptada', 'en_curso')
    )
  ) then
    update public.asignaciones_servicio
    set estado = 'finalizada', ended_at = now()
    where solicitud_id = visit_row.solicitud_id and estado = 'activa';
  end if;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_cancelled', 'estado_solicitud', request_state));
  return public.api_visit(visit_id);
end;
$$;

-- Base: 20261103010000. Una visita cancelada vuelve siempre a 'programada' (con o sin taller,
-- como queda tras desasignarla), sin la aceptación anterior: el taller debe volver a aceptarla.
-- Antes, sin taller quedaba en 'solicitada', estado que api_assign_visit no acepta.
create or replace function public.api_admin_reopen_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio;
  owner_id uuid;
  request_state public.estado_solicitud;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can restore a visit';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado <> 'cancelada' then
    raise exception using errcode = 'check_violation', message = 'Only a cancelled visit can be restored';
  end if;

  update public.visitas_servicio
  set estado = 'programada', cancelled_at = null, accepted_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;

  delete from public.visita_equipos where visita_id = visit_id;
  insert into public.visita_equipos(visita_id, equipo_id, ventana)
  select distinct visit_id, v.equipo_id, tstzrange(visit_row.starts_at, visit_row.ends_at, '[)')
  from public.ordenes_trabajo ot join public.valvulas v on v.id = ot.valvula_id
  where ot.visita_id = visit_id;

  request_state := public.refresh_service_request_state(visit_row.solicitud_id);

  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_reopened_by_administrator', 'estado_anterior', 'cancelada',
      'estado_nuevo', visit_row.estado, 'estado_solicitud', request_state));

  perform public.record_audit_event(
    'visita_reabierta_por_administrador', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', 'cancelada', 'estado_nuevo', visit_row.estado,
      'estado_solicitud', request_state),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', visit_row.taller_movil_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );

  return public.api_visit(visit_id);
end;
$$;

-- Como sus pares, los comandos de visitas solo se exponen al gateway de Edge (service_role).
revoke all on function public.api_admin_cancel_visit(uuid, text) from public, anon, authenticated;
grant execute on function public.api_admin_cancel_visit(uuid, text) to service_role;
revoke all on function public.api_admin_reopen_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_admin_reopen_visit(uuid) to service_role;

commit;

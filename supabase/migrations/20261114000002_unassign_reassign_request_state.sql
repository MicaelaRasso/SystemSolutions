begin;

-- P3: desasignar o reasignar una visita aceptada recalcula el estado de la Solicitud de servicio
-- desde sus visitas (refresh_service_request_state, 20261112000003) en lugar de forzarla a
-- 'pendiente'. Antes, desasignar o reasignar una visita de seguimiento aceptada dejaba la solicitud
-- en 'pendiente' aunque otra visita estuviera completada, y eso bloqueaba nuevos seguimientos.
-- Mismo criterio que cancelar o reabrir una visita:
--   * con otra visita aceptada, en curso o completada, la solicitud sigue 'aceptada';
--   * si no, vuelve a 'pendiente' sin aceptación ni taller (como antes).
-- La asignación activa se finaliza, como al cancelar, cuando ninguna otra visita de la solicitud
-- sigue aceptada o en curso.

-- Uso interno de los RPC de visitas (no es un endpoint): se llama después de liberar una visita
-- que estaba aceptada.
create or replace function public.refresh_visit_request_after_release(released public.visitas_servicio)
returns public.estado_solicitud
language plpgsql
set search_path = public
as $$
declare
  request_state public.estado_solicitud;
begin
  request_state := public.refresh_service_request_state(released.solicitud_id);
  if not exists (
    select 1 from public.visitas_servicio other
    where other.solicitud_id = released.solicitud_id
      and other.id <> released.id
      and other.estado in ('aceptada', 'en_curso')
  ) then
    update public.asignaciones_servicio
    set estado = 'finalizada', ended_at = now()
    where solicitud_id = released.solicitud_id and estado = 'activa';
  end if;
  return request_state;
end;
$$;

revoke all on function public.refresh_visit_request_after_release(public.visitas_servicio)
  from public, anon, authenticated, service_role;

-- Base: 20261005160000. Solo cambia el efecto sobre la solicitud y su asignación.
create or replace function public.api_unassign_visit(visit_id uuid, action_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; owner_id uuid; previous_provider uuid;
  previous_status public.estado_visita;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can unassign a visit';
  end if;
  if nullif(btrim(action_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A reason is required to unassign a visit';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado not in ('programada', 'aceptada') or visit_row.taller_movil_id is null then
    raise exception using errcode = 'check_violation', message = 'Only an assigned visit that has not started can be unassigned';
  end if;
  previous_provider := visit_row.taller_movil_id;
  previous_status := visit_row.estado;

  update public.visitas_servicio
  set estado = 'programada', accepted_at = null, taller_movil_id = null, rejected_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;
  if previous_status = 'aceptada' then
    perform public.refresh_visit_request_after_release(visit_row);
  end if;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_unassigned', 'taller_movil_id', previous_provider, 'reason', btrim(action_reason)));
  perform public.record_audit_event(
    'visita_desasignada', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado', visit_row.estado, 'reason', btrim(action_reason), 'taller_movil_anterior', previous_provider,
      'starts_at', visit_row.starts_at, 'ends_at', visit_row.ends_at),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_anterior', previous_provider),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

-- Base: 20261005160000. Solo cambia el efecto sobre la solicitud y su asignación.
create or replace function public.api_reassign_visit(
  visit_id uuid, provider_id uuid, action_reason text,
  visit_starts_at timestamptz, visit_ends_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio; owner_id uuid; previous_provider uuid;
  previous_status public.estado_visita;
  requested_start timestamptz; requested_end timestamptz; schedule_changed boolean;
  previous_start timestamptz; previous_end timestamptz;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can reassign a visit';
  end if;
  if nullif(btrim(action_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A reason is required to reassign a visit';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado not in ('programada', 'aceptada') or visit_row.taller_movil_id is null then
    raise exception using errcode = 'check_violation', message = 'Only an assigned visit that has not started can be reassigned';
  end if;
  previous_provider := visit_row.taller_movil_id;
  previous_status := visit_row.estado;
  previous_start := visit_row.starts_at;
  previous_end := visit_row.ends_at;
  if (visit_starts_at is null) <> (visit_ends_at is null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'A rescheduled visit requires both start and end times';
  end if;
  requested_start := coalesce(visit_starts_at, visit_row.starts_at);
  requested_end := coalesce(visit_ends_at, visit_row.ends_at);
  if requested_end <= requested_start then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;
  schedule_changed := requested_start is distinct from visit_row.starts_at
    or requested_end is distinct from visit_row.ends_at;
  if previous_provider = provider_id and not schedule_changed then
    raise exception using errcode = 'check_violation', message = 'The assignment and schedule are unchanged';
  end if;

  update public.visitas_servicio
  set estado = 'programada', accepted_at = null, taller_movil_id = provider_id,
      starts_at = requested_start, ends_at = requested_end, rejected_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;
  update public.visita_equipos
  set ventana = tstzrange(requested_start, requested_end, '[)')
  where visita_id = visit_id;
  if previous_status = 'aceptada' then
    perform public.refresh_visit_request_after_release(visit_row);
  end if;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', case when previous_provider = provider_id then 'visit_rescheduled' else 'visit_reassigned' end,
      'taller_movil_anterior', previous_provider, 'taller_movil_id', provider_id,
      'starts_at_anterior', previous_start, 'ends_at_anterior', previous_end,
      'reason', btrim(action_reason)));
  perform public.record_audit_event(
    case when previous_provider = provider_id then 'visita_reprogramada' else 'visita_reasignada' end,
    'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado', visit_row.estado, 'reason', btrim(action_reason),
      'taller_movil_anterior', previous_provider, 'taller_movil_nuevo', provider_id,
      'starts_at', visit_row.starts_at, 'ends_at', visit_row.ends_at),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id,
      'taller_movil_anterior', previous_provider, 'taller_movil_nuevo', provider_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_unassign_visit(uuid, text),
  public.api_reassign_visit(uuid, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_unassign_visit(uuid, text),
  public.api_reassign_visit(uuid, uuid, text, timestamptz, timestamptz)
  to service_role;

commit;

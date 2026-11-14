begin;

-- S8b: no existía una reprogramación a nivel visita para una visita sin taller
-- (api_assign_visit exige elegir un taller, api_reassign_visit exige uno ya asignado y
-- api_schedule_visit apunta a la solicitud). Este comando cambia la fecha u horario de una visita
-- que todavía no fue aceptada ni empezó, sin tocar su taller, y mueve la reserva de sus equipos
-- (la exclusión visita_equipos_no_simultaneous_equipment sigue rigiendo).
create or replace function public.api_admin_reschedule_visit(
  visit_id uuid,
  visit_starts_at timestamptz,
  visit_ends_at timestamptz,
  action_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio;
  owner_id uuid;
  previous_start timestamptz;
  previous_end timestamptz;
  previous_status public.estado_visita;
  audit_reason text := coalesce(nullif(btrim(action_reason), ''), 'Reprogramación de fecha u horario');
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can reschedule a visit';
  end if;
  if visit_starts_at is null or visit_ends_at is null or visit_ends_at <= visit_starts_at then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  -- Una visita aceptada se reprograma con api_reassign_visit, que le quita la aceptación.
  if visit_row.estado not in ('programada', 'solicitada') then
    raise exception using errcode = 'check_violation', message = 'Only a visit that has not started can be rescheduled';
  end if;
  if visit_row.starts_at = visit_starts_at and visit_row.ends_at = visit_ends_at
    and visit_row.estado = 'programada' then
    raise exception using errcode = 'check_violation', message = 'The schedule is unchanged';
  end if;
  previous_start := visit_row.starts_at;
  previous_end := visit_row.ends_at;
  previous_status := visit_row.estado;

  -- Una visita 'solicitada' (reabierta sin taller antes de 20261112000003) pasa a 'programada'
  -- sin taller, el mismo estado que deja la desasignación, para poder asignarla después.
  update public.visitas_servicio
  set starts_at = visit_starts_at, ends_at = visit_ends_at, estado = 'programada',
      accepted_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;

  delete from public.visita_equipos where visita_id = visit_id;
  insert into public.visita_equipos(visita_id, equipo_id, ventana)
  select distinct visit_id, v.equipo_id, tstzrange(visit_starts_at, visit_ends_at, '[)')
  from public.ordenes_trabajo ot join public.valvulas v on v.id = ot.valvula_id
  where ot.visita_id = visit_id;

  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_rescheduled', 'taller_movil_id', visit_row.taller_movil_id,
      'starts_at_anterior', previous_start, 'ends_at_anterior', previous_end,
      'starts_at', visit_starts_at, 'ends_at', visit_ends_at, 'reason', audit_reason));
  perform public.record_audit_event(
    'visita_reprogramada', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', previous_status, 'estado', visit_row.estado, 'reason', audit_reason,
      'taller_movil_id', visit_row.taller_movil_id,
      'starts_at_anterior', previous_start, 'ends_at_anterior', previous_end,
      'starts_at', visit_row.starts_at, 'ends_at', visit_row.ends_at),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', visit_row.taller_movil_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_admin_reschedule_visit(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.api_admin_reschedule_visit(uuid, timestamptz, timestamptz, text)
  to service_role;

commit;

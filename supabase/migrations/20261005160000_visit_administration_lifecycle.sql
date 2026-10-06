begin;

-- Visit administration is an application command, so the database is the
-- authority for actor role, state transitions, and reason requirements.
create or replace function public.api_schedule_visit(
  request_id uuid,
  provider_id uuid,
  visit_starts_at timestamptz,
  visit_ends_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_row public.solicitudes_servicio; visit_row public.visitas_servicio;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can schedule a visit';
  end if;
  if visit_starts_at is null or visit_ends_at is null or visit_ends_at <= visit_starts_at then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;

  select * into request_row from public.solicitudes_servicio where id = request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.accepted_at is not null or request_row.estado <> 'pendiente' then
    raise exception using errcode = 'check_violation', message = 'An accepted service request cannot be scheduled';
  end if;
  if exists (select 1 from public.visitas_servicio where solicitud_id = request_id) then
    raise exception using errcode = 'check_violation', message = 'An existing visit must be changed through visit administration';
  end if;

  insert into public.visitas_servicio(
    solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado
  ) values (
    request_id, request_row.yacimiento_id, provider_id,
    visit_starts_at, visit_ends_at, 'programada'
  ) returning * into visit_row;

  perform public.api_refresh_scheduled_visit_scope(request_id);
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_scheduled', 'taller_movil_id', provider_id));
  return public.api_visit(visit_row.id);
end;
$$;

create or replace function public.api_assign_visit(
  visit_id uuid, provider_id uuid, action_reason text,
  visit_starts_at timestamptz, visit_ends_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; owner_id uuid; requested_start timestamptz; requested_end timestamptz;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can assign a visit';
  end if;
  if nullif(btrim(action_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A reason is required to assign a visit';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado <> 'programada' or visit_row.taller_movil_id is not null then
    raise exception using errcode = 'check_violation', message = 'Only an unassigned scheduled visit can be assigned';
  end if;
  if (visit_starts_at is null) <> (visit_ends_at is null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'A rescheduled visit requires both start and end times';
  end if;
  requested_start := coalesce(visit_starts_at, visit_row.starts_at);
  requested_end := coalesce(visit_ends_at, visit_row.ends_at);
  if requested_end <= requested_start then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;

  update public.visitas_servicio
  set taller_movil_id = provider_id, starts_at = requested_start, ends_at = requested_end,
      rejected_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;
  update public.visita_equipos
  set ventana = tstzrange(requested_start, requested_end, '[)')
  where visita_id = visit_id;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_assigned', 'taller_movil_id', provider_id, 'reason', btrim(action_reason)));
  perform public.record_audit_event(
    'visita_asignada', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado', visit_row.estado, 'reason', btrim(action_reason), 'taller_movil_id', provider_id,
      'starts_at', visit_row.starts_at, 'ends_at', visit_row.ends_at),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', provider_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

create or replace function public.api_unassign_visit(visit_id uuid, action_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; owner_id uuid; previous_provider uuid;
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

  if visit_row.estado = 'aceptada' then
    update public.asignaciones_servicio
    set estado = 'finalizada', ended_at = now()
    where solicitud_id = visit_row.solicitud_id and estado = 'activa';
    update public.solicitudes_servicio
    set estado = 'pendiente', accepted_at = null, taller_movil_id = null, updated_at = now()
    where id = visit_row.solicitud_id;
  end if;

  update public.visitas_servicio
  set estado = 'programada', accepted_at = null, taller_movil_id = null, rejected_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;
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

create or replace function public.api_reassign_visit(
  visit_id uuid, provider_id uuid, action_reason text,
  visit_starts_at timestamptz, visit_ends_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio; owner_id uuid; previous_provider uuid;
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

  if visit_row.estado = 'aceptada' then
    update public.asignaciones_servicio
    set estado = 'finalizada', ended_at = now()
    where solicitud_id = visit_row.solicitud_id and estado = 'activa';
    update public.solicitudes_servicio
    set estado = 'pendiente', accepted_at = null, taller_movil_id = null, updated_at = now()
    where id = visit_row.solicitud_id;
  end if;

  update public.visitas_servicio
  set estado = 'programada', accepted_at = null, taller_movil_id = provider_id,
      starts_at = requested_start, ends_at = requested_end, rejected_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;
  update public.visita_equipos
  set ventana = tstzrange(requested_start, requested_end, '[)')
  where visita_id = visit_id;
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

create or replace function public.api_admin_cancel_visit(visit_id uuid, action_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; owner_id uuid; previous_status public.estado_visita;
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
  update public.asignaciones_servicio
  set estado = 'finalizada', ended_at = now()
  where solicitud_id = visit_row.solicitud_id and estado = 'activa';
  update public.solicitudes_servicio
  set estado = 'cancelada', updated_at = now()
  where id = visit_row.solicitud_id;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_cancelled_by_administrator', 'estado_anterior', previous_status,
      'reason', btrim(action_reason)));
  perform public.record_audit_event(
    'visita_cancelada_por_administrador', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', previous_status, 'estado_nuevo', visit_row.estado,
      'reason', btrim(action_reason)),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', visit_row.taller_movil_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );
  return public.api_visit(visit_id);
end;
$$;

-- Keep the existing Cliente cutoff while preventing a future-dated visit that
-- has already started from jumping back to cancelada.
create or replace function public.api_cancel_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; request_row public.solicitudes_servicio;
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

  update public.visitas_servicio
  set estado = 'cancelada', cancelled_at = now(), updated_at = now()
  where id = visit_id returning * into visit_row;
  delete from public.visita_equipos where visita_id = visit_id;
  update public.asignaciones_servicio
  set estado = 'finalizada', ended_at = now()
  where solicitud_id = visit_row.solicitud_id and estado = 'activa';
  update public.solicitudes_servicio
  set estado = 'cancelada', updated_at = now()
  where id = visit_row.solicitud_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_cancelled'));
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz),
  public.api_assign_visit(uuid, uuid, text, timestamptz, timestamptz), public.api_unassign_visit(uuid, text),
  public.api_reassign_visit(uuid, uuid, text, timestamptz, timestamptz), public.api_admin_cancel_visit(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz),
  public.api_assign_visit(uuid, uuid, text, timestamptz, timestamptz), public.api_unassign_visit(uuid, text),
  public.api_reassign_visit(uuid, uuid, text, timestamptz, timestamptz), public.api_admin_cancel_visit(uuid, text)
  to service_role;

commit;

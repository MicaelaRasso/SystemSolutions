begin;

-- A Solicitud is the Cliente-facing service identity; its individual field
-- days remain independent Visitas with their own work orders and signatures.
alter table public.visitas_servicio
  drop constraint if exists visitas_servicio_solicitud_id_key;

alter table public.asignaciones_servicio
  drop constraint if exists asignaciones_servicio_solicitud_id_key;

create index if not exists visitas_servicio_solicitud_starts_idx
  on public.visitas_servicio(solicitud_id, starts_at, id);

create index if not exists asignaciones_servicio_solicitud_idx
  on public.asignaciones_servicio(solicitud_id, started_at desc);

-- Request edits and initial scheduling continue to target the pending
-- scheduled visit if one exists, even after a Solicitud gains later visits.
create or replace function public.api_refresh_scheduled_visit_scope(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio;
begin
  select * into visit_row
  from public.visitas_servicio
  where solicitud_id = request_id and estado = 'programada'
  order by starts_at, id
  limit 1
  for update;

  if visit_row.id is null then
    return;
  end if;

  delete from public.visita_equipos where visita_id = visit_row.id;
  delete from public.ordenes_trabajo where visita_id = visit_row.id;
  insert into public.ordenes_trabajo(visita_id, valvula_id)
  select visit_row.id, sv.valvula_id
  from public.solicitud_valvulas sv
  where sv.solicitud_id = request_id;
  if not exists (select 1 from public.ordenes_trabajo where visita_id = visit_row.id) then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires at least one selected Válvula';
  end if;
  insert into public.visita_equipos(visita_id, equipo_id, ventana)
  select distinct visit_row.id, v.equipo_id, tstzrange(visit_row.starts_at, visit_row.ends_at, '[)')
  from public.ordenes_trabajo ot join public.valvulas v on v.id = ot.valvula_id
  where ot.visita_id = visit_row.id;
end;
$$;

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

  select * into visit_row
  from public.visitas_servicio
  where solicitud_id = request_id and estado = 'programada'
  order by starts_at, id
  limit 1
  for update;

  if visit_row.id is null then
    if exists (select 1 from public.visitas_servicio where solicitud_id = request_id) then
      raise exception using errcode = 'check_violation', message = 'An existing visit must be changed through visit administration';
    end if;
    insert into public.visitas_servicio(
      solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado
    ) values (
      request_id, request_row.yacimiento_id, provider_id,
      visit_starts_at, visit_ends_at, 'programada'
    ) returning * into visit_row;
  else
    update public.visitas_servicio
    set taller_movil_id = provider_id,
        starts_at = visit_starts_at,
        ends_at = visit_ends_at,
        updated_at = now()
    where id = visit_row.id
    returning * into visit_row;
  end if;

  perform public.api_refresh_scheduled_visit_scope(request_id);
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_scheduled', 'taller_movil_id', provider_id));
  return public.api_visit(visit_row.id);
end;
$$;

create or replace function public.api_create_followup_visit(
  request_id uuid,
  source_visit_id uuid,
  valve_ids uuid[],
  provider_id uuid,
  visit_starts_at timestamptz,
  visit_ends_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  request_row public.solicitudes_servicio;
  source_visit public.visitas_servicio;
  visit_row public.visitas_servicio;
  owner_id uuid;
  eligible_count integer;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can create a follow-up visit';
  end if;
  if valve_ids is null or cardinality(valve_ids) = 0
    or array_position(valve_ids, null) is not null
    or cardinality(valve_ids) <> (select count(distinct selected.valve_id) from unnest(valve_ids) as selected(valve_id)) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Select one or more distinct Válvulas for the follow-up visit';
  end if;
  if visit_starts_at is null or visit_ends_at is null or visit_ends_at <= visit_starts_at then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;

  select * into source_visit
  from public.visitas_servicio
  where id = source_visit_id and solicitud_id = request_id
  for update;
  if source_visit.id is null then
    raise exception using errcode = 'no_data_found', message = 'Source visit not found in this Solicitud';
  end if;
  if source_visit.estado <> 'completada' then
    raise exception using errcode = 'check_violation', message = 'Only a completed visit can generate a follow-up visit';
  end if;

  select * into request_row from public.solicitudes_servicio where id = request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.estado <> 'aceptada' then
    raise exception using errcode = 'check_violation', message = 'Only an accepted service request can have a follow-up visit';
  end if;

  select count(*) into eligible_count
  from public.ordenes_trabajo source_order
  where source_order.visita_id = source_visit_id
    and source_order.estado = 'no_evaluada'
    and source_order.valvula_id = any(valve_ids);
  if eligible_count <> cardinality(valve_ids) then
    raise exception using errcode = 'check_violation', message = 'Every selected Válvula must have a no_evaluada Orden de trabajo in the source visit';
  end if;

  if exists (
    select 1
    from public.visitas_servicio active_visit
    join public.ordenes_trabajo active_order on active_order.visita_id = active_visit.id
    where active_visit.solicitud_id = request_id
      and active_visit.id <> source_visit_id
      and active_visit.estado in ('solicitada', 'programada', 'aceptada', 'en_curso')
      and active_order.valvula_id = any(valve_ids)
  ) then
    raise exception using errcode = 'check_violation', message = 'A Válvula is already assigned to another active visit in this Solicitud';
  end if;

  insert into public.visitas_servicio(
    solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado
  ) values (
    request_id, request_row.yacimiento_id, provider_id,
    visit_starts_at, visit_ends_at, 'programada'
  ) returning * into visit_row;

  insert into public.ordenes_trabajo(visita_id, valvula_id)
  select visit_row.id, source_order.valvula_id
  from public.ordenes_trabajo source_order
  where source_order.visita_id = source_visit_id
    and source_order.estado = 'no_evaluada'
    and source_order.valvula_id = any(valve_ids);

  insert into public.visita_equipos(visita_id, equipo_id, ventana)
  select distinct visit_row.id, valve.equipo_id, tstzrange(visit_starts_at, visit_ends_at, '[)')
  from unnest(valve_ids) selected(valve_id)
  join public.valvulas valve on valve.id = selected.valve_id;

  select cliente_cuenta_id into owner_id
  from public.yacimientos where id = request_row.yacimiento_id;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'follow_up_visit_scheduled', 'solicitud_id', request_id,
      'source_visit_id', source_visit_id, 'valve_ids', to_jsonb(valve_ids),
      'taller_movil_id', provider_id, 'starts_at', visit_starts_at, 'ends_at', visit_ends_at));

  perform public.record_audit_event(
    'visita_seguimiento_programada', 'visita_servicio', visit_row.id, 'exitoso',
    jsonb_build_object('solicitud_id', request_id, 'source_visit_id', source_visit_id,
      'valve_ids', to_jsonb(valve_ids), 'taller_movil_id', provider_id,
      'starts_at', visit_starts_at, 'ends_at', visit_ends_at),
    jsonb_build_object('solicitud_id', request_id, 'source_visit_id', source_visit_id),
    null, null, owner_id, request_row.yacimiento_id, visit_row.id, null
  );

  return public.api_visit(visit_row.id);
end;
$$;

revoke all on function public.api_create_followup_visit(uuid, uuid, uuid[], uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_create_followup_visit(uuid, uuid, uuid[], uuid, timestamptz, timestamptz)
  to service_role;

commit;

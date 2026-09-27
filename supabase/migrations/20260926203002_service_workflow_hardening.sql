begin;

-- A request remains editable until the assigned Taller Móvil accepts its
-- Visita.  Keep the cutoff tied to the request's accepted state as well as its
-- timestamp so a malformed historical row cannot reopen an accepted request.
create or replace function public.api_update_service_request(request_id uuid, selections jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_row public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into request_row
  from public.solicitudes_servicio
  where id = request_id
  for update;

  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can edit a service request';
  end if;
  if request_row.accepted_at is not null or request_row.estado <> 'pendiente' then
    raise exception using errcode = 'check_violation', message = 'Accepted service requests cannot be edited';
  end if;

  perform public.api_replace_service_selection(request_id, request_row.yacimiento_id, selections);
  perform public.api_refresh_scheduled_visit_scope(request_id);
  update public.solicitudes_servicio
  set updated_at = now()
  where id = request_id;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', request_row.yacimiento_id, request_id, auth.uid(),
    jsonb_build_object('event', 'request_selection_updated')
  );
  return public.api_service_request(request_id);
end;
$$;

-- Reassignment is the only way out of a provider rejection.  Reset the
-- rejection marker when an Administrador assigns the visit again.
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
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can schedule a visit';
  end if;
  if visit_starts_at is null or visit_ends_at is null or visit_ends_at <= visit_starts_at then
    raise exception using errcode = 'invalid_parameter_value', message = 'A visit requires a valid date and time window';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;

  select * into request_row
  from public.solicitudes_servicio
  where id = request_id
  for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.accepted_at is not null or request_row.estado <> 'pendiente' then
    raise exception using errcode = 'check_violation', message = 'An accepted service request cannot be rescheduled';
  end if;

  select * into visit_row
  from public.visitas_servicio
  where solicitud_id = request_id
  for update;
  if visit_row.id is null then
    insert into public.visitas_servicio(
      solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado
    )
    values (
      request_id, request_row.yacimiento_id, provider_id,
      visit_starts_at, visit_ends_at, 'programada'
    )
    returning * into visit_row;
  elsif visit_row.estado = 'programada' then
    update public.visitas_servicio
    set taller_movil_id = provider_id,
        starts_at = visit_starts_at,
        ends_at = visit_ends_at,
        rejected_at = null,
        updated_at = now()
    where id = visit_row.id
    returning * into visit_row;
  else
    raise exception using errcode = 'check_violation', message = 'Only a scheduled visit can be reassigned';
  end if;

  perform public.api_refresh_scheduled_visit_scope(request_id);
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', request_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_scheduled', 'taller_movil_id', provider_id)
  );
  return public.api_visit(visit_row.id);
end;
$$;

-- A rejected visit is returned to programada for reassignment.  Keep the
-- canonical {visit, work_orders} response used by every visit route.
create or replace function public.api_reject_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; provider_id uuid;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row
  from public.visitas_servicio
  where id = visit_id
  for update;
  select taller_movil_id into provider_id
  from public.taller_cuentas
  where cuenta_id = auth.uid();

  if visit_row.id is null
    or visit_row.estado <> 'programada'
    or provider_id is null
    or provider_id <> visit_row.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can reject this visit';
  end if;

  update public.visitas_servicio
  set taller_movil_id = null,
      rejected_at = now(),
      updated_at = now()
  where id = visit_id
  returning * into visit_row;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_rejected')
  );
  return jsonb_build_object(
    'visit', to_jsonb(visit_row),
    'work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', ot.id, 'valvula_id', ot.valvula_id) order by ot.created_at)
      from public.ordenes_trabajo ot
      where ot.visita_id = visit_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Cancelling a Visita releases only its scheduled equipment claim.  It must
-- not end the active Yacimiento/Taller relationship; access is a service
-- relationship and is independent from an individual appointment.
create or replace function public.api_cancel_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; request_row public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row
  from public.visitas_servicio
  where id = visit_id
  for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;

  select * into request_row
  from public.solicitudes_servicio
  where id = visit_row.solicitud_id
  for update;
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol = 'cliente'
  ) or request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can cancel this visit';
  end if;
  if visit_row.estado in ('cancelada', 'completada')
    or (visit_row.starts_at at time zone 'America/Argentina/Buenos_Aires')::date
       <= (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = 'check_violation', message = 'A visit can only be cancelled before its execution day';
  end if;

  update public.visitas_servicio
  set estado = 'cancelada', cancelled_at = now(), updated_at = now()
  where id = visit_id
  returning * into visit_row;
  delete from public.visita_equipos where visita_id = visit_id;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(),
    jsonb_build_object('event', 'visit_cancelled')
  );
  return public.api_visit(visit_id);
end;
$$;

-- Technician-added valves participate in the same exclusion constraint as the
-- original request scope.  The insert and exclusion check are in one RPC
-- transaction, so overlapping visits cannot both claim the equipment.
create or replace function public.api_add_work_order(visit_id uuid, target_valvula uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.visitas_servicio;
  target_yacimiento uuid;
  target_equipo uuid;
  owner_id uuid;
  provider uuid;
  o public.ordenes_trabajo;
begin
  select * into v from public.api_assigned_visit(visit_id);
  if v.estado <> 'en_curso' then
    raise exception using errcode = 'check_violation', message = 'Válvulas can be added only while the visit is in progress';
  end if;

  select p.yacimiento_id, x.equipo_id
  into target_yacimiento, target_equipo
  from public.valvulas x
  join public.equipos_unidades e on e.id = x.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where x.id = target_valvula;
  if target_yacimiento is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;

  select cliente_cuenta_id into owner_id
  from public.yacimientos
  where id = v.yacimiento_id;
  if not exists (
    select 1 from public.yacimientos
    where id = target_yacimiento and cliente_cuenta_id = owner_id
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'An added Válvula must belong to the same Cliente';
  end if;

  select taller_movil_id into provider
  from public.asignaciones_servicio
  where yacimiento_id = target_yacimiento and estado = 'activa';
  if provider is null or provider <> v.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'The Taller Móvil requires active Yacimiento access';
  end if;

  insert into public.ordenes_trabajo(visita_id, valvula_id)
  values (visit_id, target_valvula)
  on conflict (visita_id, valvula_id) do update set valvula_id = excluded.valvula_id
  returning * into o;

  insert into public.visita_equipos(visita_id, equipo_id, ventana)
  values (visit_id, target_equipo, tstzrange(v.starts_at, v.ends_at, '[)'))
  on conflict (visita_id, equipo_id) do nothing;

  return jsonb_build_object('work_order', to_jsonb(o));
end;
$$;

revoke all on function public.api_update_service_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.api_reject_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_cancel_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_add_work_order(uuid, uuid) from public, anon, authenticated;

grant execute on function public.api_update_service_request(uuid, jsonb) to service_role;
grant execute on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.api_reject_visit(uuid) to service_role;
grant execute on function public.api_cancel_visit(uuid) to service_role;
grant execute on function public.api_add_work_order(uuid, uuid) to service_role;

commit;

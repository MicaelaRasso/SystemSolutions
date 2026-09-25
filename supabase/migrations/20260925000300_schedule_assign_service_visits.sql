begin;

create extension if not exists btree_gist;

create type public.estado_visita as enum (
  'solicitada', 'programada', 'aceptada', 'en_curso', 'completada', 'cancelada'
);

create table public.visitas_servicio (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null unique references public.solicitudes_servicio(id),
  yacimiento_id uuid not null references public.yacimientos(id),
  taller_movil_id uuid references public.talleres_moviles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  estado public.estado_visita not null default 'solicitada',
  accepted_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (
    (estado = 'programada' and accepted_at is null)
    or (estado = 'aceptada' and taller_movil_id is not null and accepted_at is not null)
    or (estado in ('en_curso', 'completada') and taller_movil_id is not null and accepted_at is not null)
    or (estado = 'cancelada')
    or (estado = 'solicitada' and taller_movil_id is null)
  )
);

create table public.ordenes_trabajo (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references public.visitas_servicio(id) on delete cascade,
  valvula_id uuid not null references public.valvulas(id),
  created_at timestamptz not null default now(),
  unique (visita_id, valvula_id)
);

create table public.visita_equipos (
  visita_id uuid not null references public.visitas_servicio(id) on delete cascade,
  equipo_id uuid not null references public.equipos_unidades(id),
  ventana tstzrange not null,
  activa boolean not null default true,
  primary key (visita_id, equipo_id),
  check (not isempty(ventana))
);

alter table public.visitas_servicio enable row level security;
alter table public.ordenes_trabajo enable row level security;
alter table public.visita_equipos enable row level security;

alter table public.visita_equipos
  add constraint visita_equipos_no_simultaneous_equipment
  exclude using gist (equipo_id with =, ventana with &&) where (activa);

create index visitas_servicio_yacimiento_idx on public.visitas_servicio(yacimiento_id, starts_at);
create index ordenes_trabajo_valvula_idx on public.ordenes_trabajo(valvula_id);

create or replace function public.api_refresh_scheduled_visit_scope(request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio;
begin
  select * into visit_row from public.visitas_servicio where solicitud_id = request_id for update;
  if visit_row.id is null or visit_row.estado <> 'programada' then
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

create or replace function public.api_update_service_request(request_id uuid, selections jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_row public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into request_row from public.solicitudes_servicio where id = request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can edit a service request';
  end if;
  if request_row.accepted_at is not null then
    raise exception using errcode = 'check_violation', message = 'Accepted service requests cannot be edited';
  end if;
  perform public.api_replace_service_selection(request_id, request_row.yacimiento_id, selections);
  perform public.api_refresh_scheduled_visit_scope(request_id);
  update public.solicitudes_servicio set updated_at = now() where id = request_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, request_id, auth.uid(), jsonb_build_object('event', 'request_selection_updated'));
  return public.api_service_request(request_id);
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
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can schedule a visit';
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
  if request_row.accepted_at is not null then
    raise exception using errcode = 'check_violation', message = 'An accepted service request cannot be rescheduled';
  end if;
  select * into visit_row from public.visitas_servicio where solicitud_id = request_id for update;
  if visit_row.id is null then
    insert into public.visitas_servicio(solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado)
    values (request_id, request_row.yacimiento_id, provider_id, visit_starts_at, visit_ends_at, 'programada')
    returning * into visit_row;
  elsif visit_row.estado = 'programada' then
    update public.visitas_servicio
    set taller_movil_id = provider_id,
        starts_at = visit_starts_at,
        ends_at = visit_ends_at,
        updated_at = now()
    where id = visit_row.id
    returning * into visit_row;
  else
    raise exception using errcode = 'check_violation', message = 'Only a scheduled visit can be reassigned';
  end if;
  perform public.api_refresh_scheduled_visit_scope(request_id);
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, visit_row.id, auth.uid(), jsonb_build_object('event', 'visit_scheduled', 'taller_movil_id', provider_id));
  return public.api_visit(visit_row.id);
end;
$$;

create or replace function public.api_accept_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; request_row public.solicitudes_servicio; provider_id uuid;
declare old_assignment public.asignaciones_servicio; new_assignment public.asignaciones_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null or visit_row.estado <> 'programada' then
    raise exception using errcode = 'check_violation', message = 'Only a scheduled visit can be accepted';
  end if;
  select taller_movil_id into provider_id from public.taller_cuentas where cuenta_id = auth.uid();
  if provider_id is null or provider_id <> visit_row.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can accept this visit';
  end if;
  select * into request_row from public.solicitudes_servicio where id = visit_row.solicitud_id for update;
  update public.visitas_servicio set estado = 'aceptada', accepted_at = now(), updated_at = now() where id = visit_id returning * into visit_row;
  update public.solicitudes_servicio set accepted_at = now(), taller_movil_id = provider_id, estado = 'aceptada', updated_at = now() where id = request_row.id;
  select * into old_assignment from public.asignaciones_servicio
  where yacimiento_id = visit_row.yacimiento_id and estado = 'activa' for update;
  if old_assignment.id is not null then
    update public.asignaciones_servicio set estado = 'finalizada', ended_at = now() where id = old_assignment.id;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
    values ('servicio', visit_row.yacimiento_id, old_assignment.id, auth.uid(), jsonb_build_object('event', 'replaced', 'taller_movil_id', old_assignment.taller_movil_id));
  end if;
  insert into public.asignaciones_servicio(yacimiento_id, taller_movil_id, solicitud_id)
  values (visit_row.yacimiento_id, provider_id, request_row.id) returning * into new_assignment;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(), jsonb_build_object('event', 'visit_accepted', 'assignment_id', new_assignment.id));
  return public.api_visit(visit_id);
end;
$$;

create or replace function public.api_reject_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare visit_row public.visitas_servicio; provider_id uuid;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  select taller_movil_id into provider_id from public.taller_cuentas where cuenta_id = auth.uid();
  if visit_row.id is null or visit_row.estado <> 'programada' or provider_id is null or provider_id <> visit_row.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can reject this visit';
  end if;
  update public.visitas_servicio
  set taller_movil_id = null, rejected_at = now(), updated_at = now()
  where id = visit_id returning * into visit_row;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(), jsonb_build_object('event', 'visit_rejected'));
  return jsonb_build_object('visit', to_jsonb(visit_row));
end;
$$;

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
  if request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can cancel this visit';
  end if;
  if visit_row.estado in ('cancelada', 'completada')
    or (visit_row.starts_at at time zone 'America/Argentina/Buenos_Aires')::date <= (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = 'check_violation', message = 'A visit can only be cancelled before its execution day';
  end if;
  update public.visitas_servicio set estado = 'cancelada', cancelled_at = now(), updated_at = now() where id = visit_id returning * into visit_row;
  delete from public.visita_equipos where visita_id = visit_id;
  update public.asignaciones_servicio set estado = 'finalizada', ended_at = now()
  where solicitud_id = visit_row.solicitud_id and estado = 'activa';
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_row.id, auth.uid(), jsonb_build_object('event', 'visit_cancelled'));
  return jsonb_build_object('visit', to_jsonb(visit_row));
end;
$$;

create or replace function public.api_visit(visit_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare visit_row public.visitas_servicio; account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id;
  select rol into account_role from public.cuentas where id = auth.uid();
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if account_role not in ('administrador_regular', 'super_administrador')
    and not exists (select 1 from public.yacimientos where id = visit_row.yacimiento_id and cliente_cuenta_id = auth.uid())
    and not exists (select 1 from public.taller_cuentas where cuenta_id = auth.uid() and taller_movil_id = visit_row.taller_movil_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
  return jsonb_build_object(
    'visit', to_jsonb(visit_row),
    'work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', ot.id, 'valvula_id', ot.valvula_id) order by ot.created_at)
      from public.ordenes_trabajo ot where ot.visita_id = visit_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_visits()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select rol into account_role from public.cuentas where id = auth.uid();
  if account_role in ('administrador_regular', 'super_administrador') then
    return query select public.api_visit(v.id) from public.visitas_servicio v order by v.starts_at;
  elsif account_role = 'cliente' then
    return query select public.api_visit(v.id) from public.visitas_servicio v
      join public.yacimientos y on y.id = v.yacimiento_id where y.cliente_cuenta_id = auth.uid() order by v.starts_at;
  elsif account_role = 'taller_movil' then
    return query select public.api_visit(v.id) from public.visitas_servicio v
      join public.taller_cuentas tc on tc.taller_movil_id = v.taller_movil_id
      where tc.cuenta_id = auth.uid() order by v.starts_at;
  end if;
end;
$$;

revoke all on function public.api_refresh_scheduled_visit_scope(uuid) from public, anon, authenticated;
revoke all on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.api_accept_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_reject_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_cancel_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_visits() from public, anon, authenticated;

grant execute on function public.api_schedule_visit(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.api_accept_visit(uuid) to authenticated;
grant execute on function public.api_reject_visit(uuid) to authenticated;
grant execute on function public.api_cancel_visit(uuid) to authenticated;
grant execute on function public.api_visit(uuid) to authenticated;
grant execute on function public.api_visits() to authenticated;

commit;

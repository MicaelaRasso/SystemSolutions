begin;

-- E1 (#94), decisión (e) corregida por la usuaria (2026-11-17): la visita tiene inicio y **fin
-- estimado**.
--
-- * `ends_at` sigue siendo obligatorio (NOT NULL y `ends_at > starts_at`, como en 20260925000300):
--   es el fin estimado que el Administrador carga al programar (el formulario propone inicio + 1 h).
--   La reserva del equipo (ADR 0008, `visita_equipos_no_simultaneous_equipment`) sigue siendo
--   `[starts_at, ends_at)`: el mismo equipo puede tener varias visitas el mismo día si sus horarios
--   no se superponen. Las funciones de programación (programar, asignar, reasignar, reprogramar,
--   reabrir, seguimiento) conservan sus definiciones anteriores, con la ventana completa.
-- * El fin estimado **no cierra** la visita: solo el técnico la completa, y puede pasarse de ese
--   horario. La red de seguridad es el cierre automático de las 23:59 AR (#95, 20261116121000).
-- * `started_at` registra el inicio real (hora del dispositivo si llegó sin conexión). Iniciar no
--   cambia la reserva: queda la ventana programada.
-- * Un Taller Móvil es una sola cuadrilla: **una sola visita `en_curso` a la vez**. Iniciar otra
--   (en línea o por el lote offline) falla con «The Taller Móvil already has a visit in progress;
--   complete it before starting another» (23514 → 409). En el lote offline la operación
--   `start_visit` queda en conflicto para el Administrador, como cualquier operación inválida.
-- * El estado `requiere_finalizacion` (20261116120000) entra en la restricción de estado y cuenta
--   como visita viva de la solicitud. Lo asigna el cierre automático (#95).
--
-- Funciones redefinidas (base = última definición):
--   refresh_service_request_state (20261112000003); refresh_visit_request_after_release
--   (20261114000002); api_create_followup_visit (20261019134509); api_start_visit_with_catalog,
--   api_start_visit (20261006122725); api_operations (20260926185351).

-- ---------------------------------------------------------------------------------------------
-- Modelo
-- ---------------------------------------------------------------------------------------------

alter table public.visitas_servicio
  add column if not exists started_at timestamptz;

comment on column public.visitas_servicio.ends_at is
  'Fin estimado de la visita. Define la reserva del equipo [starts_at, ends_at); no cierra la visita.';
comment on column public.visitas_servicio.started_at is
  'Momento en que el técnico inició la visita (hora del dispositivo si llegó sin conexión).';

-- La restricción CHECK de estado original (20260925000300) no tiene nombre propio: se busca por su
-- definición para reemplazarla por una versión con nombre que admite 'requiere_finalizacion'. La
-- de `ends_at > starts_at` no se toca.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.visitas_servicio'::regclass and contype = 'c'
  loop
    if constraint_row.definition like '%en_curso%' then
      execute format('alter table public.visitas_servicio drop constraint %I', constraint_row.conname);
    end if;
  end loop;
end;
$$;

alter table public.visitas_servicio
  add constraint visitas_servicio_estado_coherente check (
    (estado = 'programada' and accepted_at is null)
    or (estado = 'aceptada' and taller_movil_id is not null and accepted_at is not null)
    or (estado in ('en_curso', 'requiere_finalizacion', 'completada')
      and taller_movil_id is not null and accepted_at is not null)
    or (estado = 'cancelada')
    or (estado = 'solicitada' and taller_movil_id is null)
  );

-- Cierre automático (#95): visitas en curso por día de inicio.
create index if not exists visitas_servicio_en_curso_started_idx
  on public.visitas_servicio(started_at)
  where estado = 'en_curso';

-- Una visita en curso por Taller Móvil: búsqueda al iniciar.
create index if not exists visitas_servicio_en_curso_taller_idx
  on public.visitas_servicio(taller_movil_id)
  where estado = 'en_curso';

-- ---------------------------------------------------------------------------------------------
-- Estado de la solicitud: «Requiere finalización» es una visita viva (ya aceptada e iniciada).
-- ---------------------------------------------------------------------------------------------

-- Base: 20261112000003. Solo suma 'requiere_finalizacion' a las visitas que mantienen la solicitud
-- 'aceptada'.
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
    and v.estado in ('aceptada', 'en_curso', 'requiere_finalizacion', 'completada')
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

-- Base: 20261114000002. La asignación sigue activa mientras otra visita esté aceptada, en curso o
-- requiera finalización.
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
      and other.estado in ('aceptada', 'en_curso', 'requiere_finalizacion')
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

-- ---------------------------------------------------------------------------------------------
-- Visita de seguimiento
-- ---------------------------------------------------------------------------------------------

-- Base: 20261019134509. Igual que antes (inicio y fin estimado obligatorios, reserva
-- [inicio, fin)); una válvula en una visita que requiere finalización también cuenta como asignada
-- a otra visita activa.
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
      and active_visit.estado in ('solicitada', 'programada', 'aceptada', 'en_curso', 'requiere_finalizacion')
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

-- ---------------------------------------------------------------------------------------------
-- Inicio de la visita
-- ---------------------------------------------------------------------------------------------

-- Un Taller Móvil es una sola cuadrilla: no puede iniciar una visita mientras tiene otra en curso.
-- Bloquea la fila del taller (FOR NO KEY UPDATE, no traba las FK que lo referencian) para que dos
-- inicios simultáneos del mismo taller se serialicen. Una visita en «Requiere finalización» no
-- cuenta: el cierre de las 23:59 ya liberó al taller.
create or replace function public.require_taller_without_visit_in_progress(
  target_taller uuid,
  starting_visit uuid
)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.talleres_moviles where id = target_taller for no key update;
  if exists (
    select 1 from public.visitas_servicio other
    where other.taller_movil_id = target_taller
      and other.id <> starting_visit
      and other.estado = 'en_curso'
  ) then
    raise exception using errcode = 'check_violation',
      message = 'The Taller Móvil already has a visit in progress; complete it before starting another';
  end if;
end;
$$;

revoke all on function public.require_taller_without_visit_in_progress(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Base: 20261006122725. Registra `started_at` y exige que el taller no tenga otra visita en curso.
-- La reserva del equipo no cambia: sigue siendo la ventana programada [starts_at, ends_at).
-- Una visita iniciada sin conexión toma la hora del dispositivo de la operación `start_visit` que
-- el lote (`api_sync_visit_batch`) registró en esta misma transacción, acotada a
-- [aceptación, ahora]; en línea, la hora del servidor.
create or replace function public.api_start_visit_with_catalog(
  visit_id uuid,
  replacement_catalog_version_id uuid,
  target_device uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  claimed_device uuid;
  downloaded_version uuid;
  device_started_at timestamptz;
  visit_started_at timestamptz;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  select device_id into claimed_device from public.dispositivos_visita where visita_id = visit_id for update;
  if claimed_device is distinct from target_device then
    raise exception using errcode = '42501', message = 'The visit is not claimed by this device';
  end if;
  if visit_row.estado = 'en_curso' then
    if visit_row.replacement_catalog_version_id = replacement_catalog_version_id then
      return public.api_visit(visit_id);
    end if;
    raise exception using errcode = '23514', message = 'The visit is already bound to a different replacement catalog version';
  end if;
  if visit_row.estado <> 'aceptada' then
    raise exception using errcode = '23514', message = 'Only an accepted visit can begin';
  end if;
  select d.replacement_catalog_version_id into downloaded_version
  from public.visit_catalog_downloads d
  where d.visit_id = api_start_visit_with_catalog.visit_id and d.device_id = target_device;
  if downloaded_version is distinct from replacement_catalog_version_id then
    raise exception using errcode = '23514', message = 'The replacement catalog version was not the last version downloaded for this visit and device';
  end if;
  if not exists (select 1 from public.replacement_catalog_versions where id = replacement_catalog_version_id) then
    raise exception using errcode = '23503', message = 'The replacement catalog version does not exist';
  end if;
  perform public.require_taller_without_visit_in_progress(
    visit_row.taller_movil_id, api_start_visit_with_catalog.visit_id
  );

  select os.device_timestamp into device_started_at
  from public.operaciones_sync os
  where os.visita_id = api_start_visit_with_catalog.visit_id
    and os.kind = 'start_visit'
    and os.estado = 'pendiente'
    and os.server_received_at = now()
    and os.device_timestamp is not null
  order by os.created_at desc
  limit 1;
  visit_started_at := least(
    now(),
    greatest(coalesce(device_started_at, now()), coalesce(visit_row.accepted_at, '-infinity'::timestamptz))
  );

  update public.visitas_servicio
  set estado = 'en_curso',
      replacement_catalog_version_id = api_start_visit_with_catalog.replacement_catalog_version_id,
      started_at = visit_started_at,
      updated_at = now()
  where id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_start_visit_with_catalog(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_start_visit_with_catalog(uuid, uuid, uuid) to service_role;

-- Base: 20261006122725 (compatibilidad, sin dispositivo). Mismo registro de inicio y misma regla de
-- una visita en curso por taller.
create or replace function public.api_start_visit(visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  current_version uuid;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  if visit_row.estado <> 'aceptada' then
    raise exception using errcode = '23514', message = 'Only an accepted visit can begin';
  end if;
  perform public.require_taller_without_visit_in_progress(visit_row.taller_movil_id, api_start_visit.visit_id);
  select current_version_id into current_version from public.replacement_catalog_state where singleton;
  update public.visitas_servicio
  set estado = 'en_curso', replacement_catalog_version_id = current_version,
      started_at = now(), updated_at = now()
  where id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_start_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_start_visit(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Lecturas por rango
-- ---------------------------------------------------------------------------------------------

-- Base: 20260926185351. Solo suma 'requiere_finalizacion' al filtro de estado.
create or replace function public.api_operations(
  from_date date default null,
  to_date date default null,
  status_filter text default null,
  workshop_filter uuid default null,
  client_filter uuid default null,
  search_text text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role public.rol;
  effective_limit integer;
  effective_offset integer;
  result jsonb;
  search_value text := nullif(btrim(search_text), '');
begin
  perform public.require_authenticated_cuenta();
  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid();

  if from_date is not null and to_date is not null and from_date > to_date then
    raise exception using errcode = '22023', message = 'from_date must not be after to_date';
  end if;
  if limit_count is not null and limit_count < 0 then
    raise exception using errcode = '22023', message = 'limit must not be negative';
  end if;
  if offset_count is not null and offset_count < 0 then
    raise exception using errcode = '22023', message = 'offset must not be negative';
  end if;
  if status_filter is not null and btrim(status_filter) <> '' and exists (
    select 1
    from unnest(string_to_array(lower(status_filter), ',')) requested(value)
    where btrim(requested.value) not in (
      'solicitada', 'programada', 'aceptada', 'en_curso', 'requiere_finalizacion', 'completada', 'cancelada'
    )
  ) then
    raise exception using errcode = '22023', message = 'status_filter must contain only canonical Visita statuses';
  end if;

  effective_limit := least(coalesce(limit_count, 100), 100);
  effective_offset := coalesce(offset_count, 0);

  with filtered as materialized (
    select v.id, v.starts_at
    from public.visitas_servicio v
    join public.solicitudes_servicio s on s.id = v.solicitud_id
    join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
    join public.yacimientos y on y.id = v.yacimiento_id
    left join public.talleres_moviles t on t.id = v.taller_movil_id
    where public.can_access_yacimiento(v.yacimiento_id)
      and (
        actor_role in ('administrador_regular', 'super_administrador')
        or (actor_role = 'cliente' and s.cliente_cuenta_id = auth.uid())
        or (
          actor_role = 'taller_movil'
          and exists (
            select 1
            from public.taller_cuentas tc
            where tc.cuenta_id = auth.uid()
              and tc.taller_movil_id = v.taller_movil_id
          )
        )
      )
      and tstzrange(v.starts_at, v.ends_at, '[)') && tstzrange(
        coalesce(from_date::timestamp at time zone 'America/Argentina/Buenos_Aires', '-infinity'::timestamptz),
        coalesce(((to_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'), 'infinity'::timestamptz),
        '[)'
      )
      and (workshop_filter is null or v.taller_movil_id = workshop_filter)
      and (client_filter is null or s.cliente_cuenta_id = client_filter)
      and (
        status_filter is null
        or btrim(status_filter) = ''
        or v.estado::text = any(
            ARRAY(
            select btrim(value)
            from unnest(string_to_array(lower(status_filter), ',')) requested(value)
          )
        )
      )
      and (
        search_value is null
        or s.numero_solicitud::text ilike '%' || search_value || '%'
        or coalesce(nullif(c.razon_social, ''), c.nombre) ilike '%' || search_value || '%'
        or y.nombre ilike '%' || search_value || '%'
        or t.nombre ilike '%' || search_value || '%'
        or exists (
          select 1
          from public.ordenes_trabajo ot
          join public.valvulas va on va.id = ot.valvula_id
          where ot.visita_id = v.id
            and va.nombre ilike '%' || search_value || '%'
        )
      )
  ), page as (
    select id, starts_at
    from filtered
    order by starts_at, id
    limit effective_limit
    offset effective_offset
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.operation_summary(page.id) order by page.starts_at, page.id)
      from page
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'limit', effective_limit,
    'offset', effective_offset,
    'has_more', (select count(*) from filtered) > effective_offset + effective_limit
  )
  into result;

  return result;
end;
$$;

revoke all on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer)
  to service_role;

commit;

begin;

-- The operation read model is visit-shaped.  Keep the indexes close to the
-- projection because the administrative RPCs are a separate write surface.
create extension if not exists pg_trgm;

create index if not exists visitas_servicio_starts_at_id_idx
  on public.visitas_servicio(starts_at, id);

create index if not exists visitas_servicio_taller_starts_at_id_idx
  on public.visitas_servicio(taller_movil_id, starts_at, id);

create index if not exists solicitudes_servicio_cliente_id_idx
  on public.solicitudes_servicio(cliente_cuenta_id, id);

create index if not exists ordenes_trabajo_visita_created_at_id_idx
  on public.ordenes_trabajo(visita_id, created_at, id);

create index if not exists clientes_operation_search_idx
  on public.clientes using gin (coalesce(nullif(razon_social, ''), nombre) gin_trgm_ops);

create index if not exists yacimientos_operation_search_idx
  on public.yacimientos using gin (nombre gin_trgm_ops);

create index if not exists talleres_operation_search_idx
  on public.talleres_moviles using gin (nombre gin_trgm_ops);

create index if not exists valvulas_operation_tag_search_idx
  on public.valvulas using gin (nombre gin_trgm_ops);

-- OperationSummary is deliberately frozen around the canonical visit id.  The
-- helper is private to the two service_role read RPCs below.
create or replace function public.operation_summary(target_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id,
    'nro_solicitud', s.numero_solicitud,
    'empresa_id', s.cliente_cuenta_id,
    'yacimiento_id', v.yacimiento_id,
    'planta_id', location.planta_id,
    'equipo_id', location.equipo_id,
    'taller_id', v.taller_movil_id,
    'contacto', coalesce(s.metadata->>'contacto', ''),
    'telefono', coalesce(s.metadata->>'telefono', ''),
    'fecha_solicitud', s.created_at::date,
    'fecha_ejecucion', (v.starts_at at time zone 'America/Argentina/Buenos_Aires')::date,
    'horario', to_char(v.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI'),
    'tipo', coalesce(s.metadata->>'tipo', 'Certificación'),
    'detalle', coalesce(s.metadata->>'detalle', ''),
    'pd_rto', s.metadata->>'pd_rto',
    'orden_trabajo', s.metadata->>'orden_trabajo',
    'condiciones', coalesce(s.metadata->'condiciones', '[]'::jsonb),
    'adjuntos', coalesce(s.metadata->'adjuntos', '[]'::jsonb),
    'estado', case v.estado
      when 'solicitada' then 'pendiente'
      when 'programada' then 'asignada'
      when 'aceptada' then 'asignada'
      when 'en_curso' then 'en_curso'
      when 'completada' then 'completada'
      when 'cancelada' then 'cancelada'
    end,
    'estado_visita', v.estado,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'empresa_nombre', coalesce(nullif(c.razon_social, ''), c.nombre),
    'yacimiento_nombre', y.nombre,
    'planta_nombre', location.planta_nombre,
    'equipo_nombre', location.equipo_nombre,
    'taller_nombre', t.nombre,
    'taller_color', t.color,
    'valvula_tags', coalesce(tags.tags, '[]'::jsonb),
    'tags', coalesce(tags.tags, '[]'::jsonb)
  )
  from public.visitas_servicio v
  join public.solicitudes_servicio s on s.id = v.solicitud_id
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = v.yacimiento_id
  left join public.talleres_moviles t on t.id = v.taller_movil_id
  left join lateral (
    select p.id as planta_id,
           p.nombre as planta_nombre,
           e.id as equipo_id,
           e.nombre as equipo_nombre
    from public.ordenes_trabajo ot
    join public.valvulas va on va.id = ot.valvula_id
    join public.equipos_unidades e on e.id = va.equipo_id
    join public.plantas_locaciones p on p.id = e.planta_id
    where ot.visita_id = v.id
    order by ot.created_at, ot.id
    limit 1
  ) location on true
  left join lateral (
    select jsonb_agg(tag order by tag) as tags
    from (
      select distinct va.nombre as tag
      from public.ordenes_trabajo ot
      join public.valvulas va on va.id = ot.valvula_id
      where ot.visita_id = v.id
    ) visit_tags
  ) tags on true
  where v.id = target_visit;
$$;

drop function if exists public.api_operations(date, date, text, uuid, uuid, text);

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
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role public.rol;
  effective_limit integer;
  effective_offset integer;
  search_value text := nullif(btrim(search_text), '');
begin
  perform public.require_authenticated_cuenta();
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid();

  if limit_count is not null and limit_count < 0 then
    raise exception using errcode = '22023', message = 'limit must not be negative';
  end if;
  if offset_count is not null and offset_count < 0 then
    raise exception using errcode = '22023', message = 'offset must not be negative';
  end if;

  effective_limit := least(coalesce(limit_count, 100), 100);
  effective_offset := coalesce(offset_count, 0);

  return query
  select public.operation_summary(v.id)
  from public.visitas_servicio v
  join public.solicitudes_servicio s on s.id = v.solicitud_id
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = v.yacimiento_id
  left join public.talleres_moviles t on t.id = v.taller_movil_id
  where public.can_access_yacimiento(v.yacimiento_id)
    and (
      actor_role in ('administrador_regular', 'super_administrador')
      or (
        actor_role = 'cliente'
        and s.cliente_cuenta_id = auth.uid()
      )
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
    and (
      from_date is null
      or v.ends_at > (from_date::timestamp at time zone 'America/Argentina/Buenos_Aires')
    )
    and (
      to_date is null
      or v.starts_at < ((to_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    )
    and (workshop_filter is null or v.taller_movil_id = workshop_filter)
    and (client_filter is null or s.cliente_cuenta_id = client_filter)
    and (
      status_filter is null
      or btrim(status_filter) = ''
      or exists (
        select 1
        from unnest(string_to_array(lower(status_filter), ',')) requested(value)
        where btrim(requested.value) in (
          lower(v.estado::text),
          lower(case v.estado
            when 'solicitada' then 'pendiente'
            when 'programada' then 'asignada'
            when 'aceptada' then 'asignada'
            else v.estado::text
          end)
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
  order by v.starts_at asc, v.id asc
  limit effective_limit
  offset effective_offset;
end;
$$;

create or replace function public.api_operation(target_visit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  request_row public.solicitudes_servicio;
  actor_role public.rol;
  summary jsonb;
  visit_dto jsonb;
  request_dto jsonb;
  work_order_details jsonb;
begin
  perform public.require_authenticated_cuenta();

  select v.* into visit_row
  from public.visitas_servicio v
  where v.id = target_visit;

  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Operation visit not found';
  end if;

  if not public.can_access_yacimiento(visit_row.yacimiento_id) then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;

  select c.rol into actor_role from public.cuentas c where c.id = auth.uid();
  if actor_role not in ('administrador_regular', 'super_administrador')
    and not (
      actor_role = 'cliente'
      and exists (
        select 1
        from public.solicitudes_servicio s
        where s.id = visit_row.solicitud_id
          and s.cliente_cuenta_id = auth.uid()
      )
    )
    and not (
      actor_role = 'taller_movil'
      and exists (
        select 1
        from public.taller_cuentas tc
        where tc.cuenta_id = auth.uid()
          and tc.taller_movil_id = visit_row.taller_movil_id
      )
    ) then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;

  select s.* into request_row
  from public.solicitudes_servicio s
  where s.id = visit_row.solicitud_id;

  summary := public.operation_summary(target_visit);

  visit_dto := jsonb_build_object(
    'visit', to_jsonb(visit_row),
    'work_orders', coalesce((
      select jsonb_agg(to_jsonb(ot) order by ot.created_at, ot.id)
      from public.ordenes_trabajo ot
      where ot.visita_id = target_visit
    ), '[]'::jsonb)
  );

  request_dto := jsonb_build_object(
    'request', to_jsonb(request_row),
    'selected_valves', coalesce((
      select jsonb_agg(jsonb_build_object('id', va.id, 'name', va.nombre) order by va.nombre, va.id)
      from public.solicitud_valvulas sv
      join public.valvulas va on va.id = sv.valvula_id
      where sv.solicitud_id = request_row.id
    ), '[]'::jsonb)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'work_order', to_jsonb(ot),
    'valve', to_jsonb(va),
    'context', jsonb_build_object(
      'yacimiento', to_jsonb(y),
      'planta', to_jsonb(p),
      'equipo', to_jsonb(e)
    )
  ) order by ot.created_at, ot.id), '[]'::jsonb)
  into work_order_details
  from public.ordenes_trabajo ot
  join public.valvulas va on va.id = ot.valvula_id
  join public.equipos_unidades e on e.id = va.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  join public.yacimientos y on y.id = p.yacimiento_id
  where ot.visita_id = target_visit;

  return summary || jsonb_build_object(
    'operation', summary,
    'visit', visit_dto,
    'service_request', request_dto,
    'work_orders', work_order_details
  );
end;
$$;

-- Existing administrative writes still use this name.  A scheduled request is
-- now delegated to the visit-shaped detail; the unscheduled fallback remains
-- only so those writes retain their historical response contract.  It is not
-- reachable through api_operations or api_operation.
create or replace function public.api_operation_row(target_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visit_id uuid;
  result jsonb;
begin
  perform public.require_authenticated_cuenta();

  select v.id into visit_id
  from public.visitas_servicio v
  where v.id = target_request or v.solicitud_id = target_request
  limit 1;

  if visit_id is not null then
    return public.api_operation(visit_id);
  end if;

  if not exists (
    select 1
    from public.cuentas c
    where c.id = auth.uid()
      and c.rol in ('administrador_regular', 'super_administrador')
  ) then
    raise exception using errcode = '42501', message = 'Only an Administrador can read an unscheduled operation';
  end if;

  select jsonb_build_object(
    'id', s.id,
    'nro_solicitud', s.numero_solicitud,
    'empresa_id', s.cliente_cuenta_id,
    'yacimiento_id', s.yacimiento_id,
    'planta_id', location.planta_id,
    'equipo_id', location.equipo_id,
    'taller_id', null,
    'contacto', coalesce(s.metadata->>'contacto', ''),
    'telefono', coalesce(s.metadata->>'telefono', ''),
    'fecha_solicitud', s.created_at::date,
    'fecha_ejecucion', nullif(s.metadata->>'fecha_ejecucion', '')::date,
    'horario', s.metadata->>'horario',
    'tipo', coalesce(s.metadata->>'tipo', 'Certificación'),
    'detalle', coalesce(s.metadata->>'detalle', ''),
    'pd_rto', s.metadata->>'pd_rto',
    'orden_trabajo', s.metadata->>'orden_trabajo',
    'condiciones', coalesce(s.metadata->'condiciones', '[]'::jsonb),
    'adjuntos', coalesce(s.metadata->'adjuntos', '[]'::jsonb),
    'estado', 'pendiente',
    'empresa_nombre', coalesce(nullif(c.razon_social, ''), c.nombre),
    'yacimiento_nombre', y.nombre,
    'planta_nombre', coalesce(location.planta_nombre, '—'),
    'equipo_nombre', coalesce(location.equipo_nombre, '—'),
    'taller_nombre', null,
    'taller_color', null
  )
  into result
  from public.solicitudes_servicio s
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = s.yacimiento_id
  left join lateral (
    select p.id as planta_id,
           p.nombre as planta_nombre,
           e.id as equipo_id,
           e.nombre as equipo_nombre
    from public.solicitud_valvulas sv
    join public.valvulas va on va.id = sv.valvula_id
    join public.equipos_unidades e on e.id = va.equipo_id
    join public.plantas_locaciones p on p.id = e.planta_id
    where sv.solicitud_id = s.id
    order by sv.selected_at, sv.valvula_id
    limit 1
  ) location on true
  where s.id = target_request;

  if result is null then
    raise exception using errcode = 'P0002', message = 'Operation not found';
  end if;
  return result;
end;
$$;

revoke all on function public.operation_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.api_operation(uuid), public.api_operation_row(uuid) from public, anon, authenticated;

grant execute on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer), public.api_operation(uuid), public.api_operation_row(uuid) to service_role;

commit;

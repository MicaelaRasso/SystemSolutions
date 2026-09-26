begin;

-- The previous read-model migration exposed a row set and a legacy Tarea-shaped
-- projection. Replace that return signature with the canonical envelope.
drop function public.api_operations(date, date, text, uuid, uuid, text, integer, integer);

create or replace function public.operation_summary(target_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id,
    'solicitud_id', v.solicitud_id,
    'numero_solicitud', s.numero_solicitud,
    'estado', v.estado::text,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'cliente', jsonb_build_object(
      'id', s.cliente_cuenta_id,
      'nombre', coalesce(nullif(c.razon_social, ''), c.nombre)
    ),
    'yacimiento', jsonb_build_object(
      'id', v.yacimiento_id,
      'nombre', y.nombre
    ),
    'taller_movil', case
      when t.id is null then null
      else jsonb_build_object('id', t.id, 'nombre', t.nombre)
    end,
    'ordenes', (
      select jsonb_build_object(
        'total', count(*),
        'pendientes', count(*) filter (where ot.estado = 'pendiente'),
        'evaluadas', count(*) filter (where ot.estado = 'evaluada'),
        'no_evaluadas', count(*) filter (where ot.estado = 'no_evaluada')
      )
      from public.ordenes_trabajo ot
      where ot.visita_id = v.id
    )
  )
  from public.visitas_servicio v
  join public.solicitudes_servicio s on s.id = v.solicitud_id
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = v.yacimiento_id
  left join public.talleres_moviles t on t.id = v.taller_movil_id
  where v.id = target_visit;
$$;

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
      'solicitada', 'programada', 'aceptada', 'en_curso', 'completada', 'cancelada'
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
          join public.equipos_unidades e on e.id = va.equipo_id
          join public.plantas_locaciones p on p.id = e.planta_id
          where ot.visita_id = v.id
            and (
              va.nombre ilike '%' || search_value || '%'
              or e.nombre ilike '%' || search_value || '%'
              or p.nombre ilike '%' || search_value || '%'
            )
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

  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid();
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

  return jsonb_build_object(
    'operation', summary,
    'visit', visit_dto,
    'request', request_dto,
    'work_orders', work_order_details
  );
end;
$$;

revoke all on function public.operation_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.api_operation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.api_operations(date, date, text, uuid, uuid, text, integer, integer) to service_role;
grant execute on function public.api_operation(uuid) to service_role;

commit;

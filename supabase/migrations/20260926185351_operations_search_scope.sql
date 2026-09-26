begin;

-- The endpoint searches only the canonical operation fields and Válvula tags.
drop index if exists public.plantas_operation_search_idx;
drop index if exists public.equipos_operation_search_idx;

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

commit;

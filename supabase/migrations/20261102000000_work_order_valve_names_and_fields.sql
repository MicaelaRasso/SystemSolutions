begin;

alter table public.valvulas
  add column if not exists precinto text,
  add column if not exists servicio text,
  add column if not exists pv text,
  add column if not exists presion_operacion numeric,
  add column if not exists temperatura_operacion numeric,
  add column if not exists notas text;

-- Insert missing catalog seed options for diamEntrada, diamSalida, rosca, and tipo
-- so field capture catalogs and admin catalog endpoints share the complete seed set.
insert into public.catalogo_opciones(lista, valor, orden)
select seed.lista, seed.valor, seed.orden
from (values
  ('rosca', 'NPT', 0),
  ('rosca', 'N/A', 1),
  ('tipo', 'PILOTADA', 0),
  ('tipo', 'CONVENCIONAL', 1)
) as seed(lista, valor, orden)
where not exists (
  select 1 from public.catalogo_opciones current
  where current.lista = seed.lista and current.valor = seed.valor
);

drop function if exists public.api_update_valvula(
  uuid, text, text, text, text, text, text, text, text, text, text, text
);

create or replace function public.api_update_valvula(
  target uuid,
  asset_name text,
  asset_marca text default null,
  asset_numero_serie text default null,
  asset_modelo text default null,
  asset_tipo text default null,
  asset_diametro_entrada text default null,
  asset_clase_entrada text default null,
  asset_diametro_salida text default null,
  asset_clase_salida text default null,
  asset_rosca text default null,
  asset_razon_disponibilidad text default null,
  asset_precinto text default null,
  asset_servicio text default null,
  asset_pv text default null,
  asset_presion_operacion numeric default null,
  asset_temperatura_operacion numeric default null,
  asset_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  valve_row public.valvulas;
  old_snapshot jsonb;
  new_snapshot jsonb;
  yid uuid;
begin
  select v.*
    into valve_row
  from public.valvulas v
  join public.equipos_unidades e on e.id = v.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where v.id = target
  for update of v;

  select p.yacimiento_id
    into yid
  from public.valvulas v
  join public.equipos_unidades e on e.id = v.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where v.id = target;

  if valve_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Valve not found';
  end if;

  perform public.require_yacimiento_access(yid);

  if asset_razon_disponibilidad is not null
    and asset_razon_disponibilidad not in ('not_applicable', 'not_found') then
    raise exception using errcode = 'check_violation', message = 'Invalid availability reason';
  end if;

  old_snapshot := to_jsonb(valve_row);
  update public.valvulas
  set nombre = public.require_asset_name(asset_name),
      marca = asset_marca,
      numero_serie = asset_numero_serie,
      modelo = asset_modelo,
      tipo = asset_tipo,
      diametro_entrada = asset_diametro_entrada,
      clase_entrada = asset_clase_entrada,
      diametro_salida = asset_diametro_salida,
      clase_salida = asset_clase_salida,
      rosca = asset_rosca,
      razon_disponibilidad = asset_razon_disponibilidad,
      precinto = coalesce(asset_precinto, precinto),
      servicio = coalesce(asset_servicio, servicio),
      pv = coalesce(asset_pv, pv),
      presion_operacion = coalesce(asset_presion_operacion, presion_operacion),
      temperatura_operacion = coalesce(asset_temperatura_operacion, temperatura_operacion),
      notas = coalesce(asset_notas, notas)
  where id = target
  returning * into valve_row;

  new_snapshot := to_jsonb(valve_row);
  if old_snapshot is distinct from new_snapshot then
    insert into public.valvula_revisiones(valvula_id, datos)
    values (valve_row.id, new_snapshot);
  end if;

  return public.api_valvula(target);
end;
$$;

revoke all on function public.api_update_valvula(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.api_update_valvula(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, text
) to service_role;

-- Enrich api_visit work_orders with valve TAG, equipment name, and full valve row
-- so Taller Móvil never displays raw UUIDs and can prefill known valve data.
create or replace function public.api_visit(visit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id;
  select rol into account_role from public.cuentas where id = auth.uid();
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if account_role not in ('administrador_regular', 'super_administrador')
    and not public.can_access_yacimiento(visit_row.yacimiento_id)
    and not exists (
      select 1 from public.taller_cuentas
      where cuenta_id = auth.uid() and taller_movil_id = visit_row.taller_movil_id
    ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
  return jsonb_build_object(
    'visit', to_jsonb(visit_row) || jsonb_build_object(
      'signatures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'parte', signature.parte,
          'nombre_firmante', signature.nombre_firmante,
          'captured_at', signature.captured_at,
          'capture_method', signature.capture_method
        ) order by signature.captured_at, signature.parte)
        from public.firmas_visita signature
        where signature.visita_id = visit_id
      ), '[]'::jsonb)
    ),
    'work_orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', work_order.id,
          'valvula_id', work_order.valvula_id,
          'visita_id', work_order.visita_id,
          'estado', work_order.estado,
          'no_evaluada_razon', work_order.no_evaluada_razon,
          'valvula_nombre', val.nombre,
          'equipo_nombre', eq.nombre,
          'valvula', to_jsonb(val)
        )
        order by work_order.created_at
      )
      from public.ordenes_trabajo work_order
      left join public.valvulas val on val.id = work_order.valvula_id
      left join public.equipos_unidades eq on eq.id = val.equipo_id
      where work_order.visita_id = visit_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_certificate_capture_catalogs_for_version(target_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  version_row public.replacement_catalog_versions;
begin
  perform public.require_authenticated_cuenta();
  select * into version_row from public.replacement_catalog_versions where id = target_version;
  if version_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Replacement catalog version not found';
  end if;
  return jsonb_build_object(
    'template', (select to_jsonb(p) from public.plantillas_certificado p where p.estado = 'activa'),
    'maintenance', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'alcance' and o.activo), '[]'::jsonb),
    'replacement_catalog_version', version_row.id,
    'replacement_parts', version_row.options,
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'unidad' and o.activo), '[]'::jsonb),
    'standards', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.nombre || ' · ' || p.nro_serie, 'nro_serie', p.nro_serie, 'vencimiento', p.vencimiento) order by p.nombre, p.nro_serie)
      from public.patrones_ensayo p where p.activo), '[]'::jsonb),
    'diam_entrada', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'diamEntrada' and o.activo), '[]'::jsonb),
    'diam_salida', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'diamSalida' and o.activo), '[]'::jsonb),
    'rosca', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'rosca' and o.activo), '[]'::jsonb),
    'tipo', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'tipo' and o.activo), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_offline_working_set_for_device(target_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  provider uuid;
  latest_version uuid;
  visit_row public.visitas_servicio;
  visit_version uuid;
begin
  perform public.require_authenticated_cuenta();
  if target_device is null then
    raise exception using errcode = '22023', message = 'A device id is required';
  end if;
  select taller_movil_id into provider
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = '42501', message = 'Only a Taller Móvil can use the offline working set';
  end if;
  select current_version_id into latest_version from public.replacement_catalog_state where singleton;

  for visit_row in
    select v.*
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= now() and v.starts_at < now() + interval '2 days'))
  loop
    visit_version := coalesce(visit_row.replacement_catalog_version_id, latest_version);
    insert into public.visit_catalog_downloads(visit_id, device_id, replacement_catalog_version_id, downloaded_at)
    values (visit_row.id, target_device, visit_version, clock_timestamp())
    on conflict (visit_id, device_id) do update
      set replacement_catalog_version_id = excluded.replacement_catalog_version_id,
          downloaded_at = excluded.downloaded_at;
  end loop;

  return jsonb_build_object(
    'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(latest_version),
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'visit', to_jsonb(v) || jsonb_build_object('sync_version', v.sync_version),
          'work_orders', coalesce((
            select jsonb_agg(to_jsonb(ot) || jsonb_build_object(
              'sync_version', ot.sync_version,
              'certificate_id', c.id,
              'certificate', to_jsonb(c),
              'valvula_nombre', val.nombre,
              'equipo_nombre', eq.nombre,
              'valvula', to_jsonb(val)
            ) order by ot.created_at, ot.id)
            from public.ordenes_trabajo ot
            left join public.certificados c on c.orden_trabajo_id = ot.id
            left join public.valvulas val on val.id = ot.valvula_id
            left join public.equipos_unidades eq on eq.id = val.equipo_id
            where ot.visita_id = v.id
          ), '[]'::jsonb),
          'context', public.api_yacimiento_tree(v.yacimiento_id),
          'assigned_technicians', coalesce((
            select jsonb_agg(to_jsonb(person) order by person.nombre, person.apellido)
            from public.personas person
            where person.id = any(coalesce((
              select staffing.persona_ids
              from public.nominas_jornada staffing
              where staffing.taller_movil_id = v.taller_movil_id
                and staffing.fecha = v.starts_at::date
              limit 1
            ), '{}'::uuid[]))
          ), '[]'::jsonb),
          'claim', (
            select jsonb_build_object('device_id', claim.device_id, 'claimed_at', claim.claimed_at, 'last_seen_at', claim.last_seen_at)
            from public.dispositivos_visita claim where claim.visita_id = v.id
          ),
          'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(
            coalesce(v.replacement_catalog_version_id, latest_version)
          )
        ) order by v.starts_at, v.id
      )
      from public.visitas_servicio v
      where v.taller_movil_id = provider
        and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= now() and v.starts_at < now() + interval '2 days'))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.api_offline_working_set_for_device(uuid) from public, anon, authenticated;
grant execute on function public.api_offline_working_set_for_device(uuid) to service_role;

commit;


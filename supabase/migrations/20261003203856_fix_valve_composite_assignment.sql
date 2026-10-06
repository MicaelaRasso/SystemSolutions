begin;

-- Assign the individual columns of public.valvulas to the composite variable.
-- Selecting `v` as one composite expression makes PostgreSQL try to parse the
-- whole row representation as the first UUID field of valve_row.
create or replace function public.api_valvula(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  valve_row public.valvulas;
  yid uuid;
begin
  select v.*
    into valve_row
  from public.valvulas v
  join public.equipos_unidades e on e.id = v.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where v.id = target;

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

  return jsonb_build_object(
    'valve', to_jsonb(valve_row),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'datos', r.datos,
        'created_at', r.created_at
      ) order by r.created_at desc, r.id desc)
      from public.valvula_revisiones r
      where r.valvula_id = valve_row.id
    ), '[]'::jsonb)
  );
end;
$$;

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
  asset_razon_disponibilidad text default null
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
      razon_disponibilidad = asset_razon_disponibilidad
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

commit;

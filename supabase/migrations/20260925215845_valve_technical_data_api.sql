begin;

alter table public.valvulas
  add column marca text,
  add column numero_serie text,
  add column modelo text,
  add column tipo text,
  add column diametro_entrada text,
  add column clase_entrada text,
  add column diametro_salida text,
  add column clase_salida text,
  add column rosca text,
  add column razon_disponibilidad text;

alter table public.valvulas
  add constraint valvulas_razon_disponibilidad_check
  check (razon_disponibilidad is null or razon_disponibilidad in ('not_applicable', 'not_found'));

-- Revisions are referenced by certificate snapshots and are append-only by
-- contract, including when a privileged RPC is the writer.
create or replace function public.prevent_valvula_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = 'check_violation', message = 'Valve revisions are immutable';
end;
$$;

create trigger valvula_revisiones_append_only
before update or delete on public.valvula_revisiones
for each row execute function public.prevent_valvula_revision_mutation();

create index valvula_revisiones_valvula_created_idx
  on public.valvula_revisiones(valvula_id, created_at desc, id desc);

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
  select v
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
  select v
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

-- Preserve the existing hierarchy-edit policy. A Válvula tag rename through
-- this older RPC must also be represented in the immutable technical history.
create or replace function public.api_update_descendant(kind text, target uuid, asset_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  yid uuid;
  result jsonb;
  normalized_name text;
  old_snapshot jsonb;
  new_snapshot jsonb;
begin
  perform public.require_authenticated_cuenta();
  if kind not in ('planta', 'equipo', 'valvula') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type';
  end if;
  normalized_name := public.require_asset_name(asset_name);

  if kind = 'planta' then
    select yacimiento_id into yid from public.plantas_locaciones where id = target;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    update public.plantas_locaciones set nombre = normalized_name where id = target returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where e.id = target;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    update public.equipos_unidades set nombre = normalized_name where id = target returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid from public.valvulas v join public.equipos_unidades e on e.id = v.equipo_id join public.plantas_locaciones p on p.id = e.planta_id where v.id = target;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    select to_jsonb(v) into old_snapshot from public.valvulas v where v.id = target for update;
    update public.valvulas set nombre = normalized_name where id = target returning to_jsonb(valvulas.*) into result;
    if old_snapshot is not null and old_snapshot->>'nombre' is distinct from result->>'nombre' then
      new_snapshot := result;
      insert into public.valvula_revisiones(valvula_id, datos)
      values (target, new_snapshot);
    end if;
  end if;

  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Descendant not found';
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', kind));
  return result;
end;
$$;

revoke all on function public.api_valvula(uuid), public.api_update_valvula(uuid, text, text, text, text, text, text, text, text, text, text, text), public.api_update_descendant(text, uuid, text) from public, anon, authenticated;
grant execute on function public.api_valvula(uuid), public.api_update_valvula(uuid, text, text, text, text, text, text, text, text, text, text, text), public.api_update_descendant(text, uuid, text) to service_role;

commit;

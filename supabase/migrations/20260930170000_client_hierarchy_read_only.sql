begin;

-- Cliente hierarchy access is read-only. Administradores retain the complete
-- asset registration and correction capability through these actor RPCs.
create or replace function public.api_require_hierarchy_administrator()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_authenticated_cuenta();
  if not public.api_actor_is_admin() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only an Administrador can change hierarchy';
  end if;
end;
$$;

create or replace function public.api_create_yacimiento_for_actor(
  target_client uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.yacimientos;
begin
  perform public.api_require_hierarchy_administrator();
  if target_client is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A Cliente is required to create a Yacimiento';
  end if;
  if not exists (
    select 1 from public.cuentas c
    join public.clientes client on client.cuenta_id = c.id
    where c.id = target_client and c.rol = 'cliente' and c.activo
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'The target account is not an active Cliente';
  end if;

  insert into public.yacimientos(cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (
    target_client,
    public.require_asset_name(asset_name),
    public.require_nonblank(asset_provincia, 'Provincia'),
    public.require_nonblank(asset_operadora, 'Operadora'),
    public.require_nonblank(asset_contratista, 'Contratista')
  )
  returning * into result;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'jerarquia', result.id, result.id, auth.uid(),
    jsonb_build_object('event', 'created', 'kind', 'yacimiento', 'cliente_cuenta_id', target_client)
  );
  return result;
end;
$$;

create or replace function public.api_update_yacimiento_for_actor(
  target uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.yacimientos;
begin
  perform public.api_require_hierarchy_administrator();
  update public.yacimientos
  set nombre = public.require_asset_name(asset_name),
      provincia = public.require_nonblank(asset_provincia, 'Provincia'),
      operadora = public.require_nonblank(asset_operadora, 'Operadora'),
      contratista = public.require_nonblank(asset_contratista, 'Contratista')
  where id = target
  returning * into result;
  if result.id is null then
    raise exception using errcode = 'no_data_found', message = 'Yacimiento not found';
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', target, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', 'yacimiento'));
  return result;
end;
$$;

create or replace function public.api_create_descendant_for_actor(kind text, parent_id uuid, asset_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  yid uuid;
  result jsonb;
  normalized_name text;
begin
  perform public.api_require_hierarchy_administrator();
  if kind not in ('planta', 'equipo', 'valvula') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type';
  end if;
  normalized_name := public.require_asset_name(asset_name);

  if kind = 'planta' then
    select id into yid from public.yacimientos where id = parent_id;
    perform public.require_yacimiento_access(yid);
    insert into public.plantas_locaciones(yacimiento_id, nombre)
    values (yid, normalized_name) returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select yacimiento_id into yid from public.plantas_locaciones where id = parent_id;
    perform public.require_yacimiento_access(yid);
    insert into public.equipos_unidades(planta_id, nombre)
    values (parent_id, normalized_name) returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid
    from public.equipos_unidades e
    join public.plantas_locaciones p on p.id = e.planta_id
    where e.id = parent_id;
    perform public.require_yacimiento_access(yid);
    insert into public.valvulas(equipo_id, nombre)
    values (parent_id, normalized_name) returning to_jsonb(valvulas.*) into result;
  end if;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  return result;
end;
$$;

create or replace function public.api_update_descendant_for_actor(kind text, target uuid, asset_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  yid uuid;
  result jsonb;
  normalized_name text;
begin
  perform public.api_require_hierarchy_administrator();
  if kind not in ('planta', 'equipo', 'valvula') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type';
  end if;
  normalized_name := public.require_asset_name(asset_name);

  if kind = 'planta' then
    select yacimiento_id into yid from public.plantas_locaciones where id = target;
    perform public.require_yacimiento_access(yid);
    update public.plantas_locaciones set nombre = normalized_name where id = target
    returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid
    from public.equipos_unidades e
    join public.plantas_locaciones p on p.id = e.planta_id
    where e.id = target;
    perform public.require_yacimiento_access(yid);
    update public.equipos_unidades set nombre = normalized_name where id = target
    returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid
    from public.valvulas v
    join public.equipos_unidades e on e.id = v.equipo_id
    join public.plantas_locaciones p on p.id = e.planta_id
    where v.id = target;
    perform public.require_yacimiento_access(yid);
    update public.valvulas set nombre = normalized_name where id = target
    returning to_jsonb(valvulas.*) into result;
  end if;

  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Descendant not found';
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', kind));
  return result;
end;
$$;

revoke all on function public.api_require_hierarchy_administrator() from public, anon, authenticated;
grant execute on function public.api_require_hierarchy_administrator() to service_role;

commit;

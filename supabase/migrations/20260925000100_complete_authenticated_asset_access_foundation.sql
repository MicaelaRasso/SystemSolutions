begin;

alter table public.yacimientos
  add column provincia text not null,
  add column operadora text not null,
  add column contratista text not null;

alter table public.yacimientos
  add constraint yacimientos_required_text_check check (
    btrim(nombre) <> ''
    and btrim(provincia) <> ''
    and btrim(operadora) <> ''
    and btrim(contratista) <> ''
  ),
  add constraint yacimientos_nombre_alphanumeric_check check (
    btrim(nombre) ~ '^[[:alnum:]][[:alnum:] ._/-]*$'
  );

alter table public.plantas_locaciones
  add constraint plantas_locaciones_nombre_alphanumeric_check check (
    btrim(nombre) ~ '^[[:alnum:]][[:alnum:] ._/-]*$'
  );

alter table public.equipos_unidades
  add constraint equipos_unidades_nombre_alphanumeric_check check (
    btrim(nombre) ~ '^[[:alnum:]][[:alnum:] ._/-]*$'
  );

alter table public.valvulas
  add constraint valvulas_nombre_alphanumeric_check check (
    btrim(nombre) ~ '^[[:alnum:]][[:alnum:] ._/-]*$'
  );

create or replace function public.require_authenticated_cuenta()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
    or not exists (select 1 from public.cuentas where id = auth.uid()) then
    raise exception using errcode = 'insufficient_privilege', message = 'Authentication required';
  end if;
end;
$$;

create or replace function public.require_asset_name(asset_name text)
returns text language plpgsql security definer set search_path = public as $$
declare normalized text := btrim(asset_name);
begin
  if normalized is null or normalized = '' or normalized !~ '^[[:alnum:]][[:alnum:] ._/-]*$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Asset name or tag must be alphanumeric';
  end if;
  return normalized;
end;
$$;

create or replace function public.require_nonblank(value text, field_name text)
returns text language plpgsql security definer set search_path = public as $$
declare normalized text := btrim(value);
begin
  if normalized is null or normalized = '' then
    raise exception using errcode = 'invalid_parameter_value', message = field_name || ' is required';
  end if;
  return normalized;
end;
$$;

create or replace function public.api_context()
returns table (cuenta_id uuid, rol public.rol, taller_movil_id uuid, cliente boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_authenticated_cuenta();
  return query
    select c.id, c.rol, tc.taller_movil_id, (c.rol = 'cliente')
    from public.cuentas c
    left join public.taller_cuentas tc on tc.cuenta_id = c.id
    where c.id = auth.uid();
end;
$$;

create or replace function public.api_yacimientos()
returns setof public.yacimientos language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_authenticated_cuenta();
  return query
    select y from public.yacimientos y
    where public.can_access_yacimiento(y.id);
end;
$$;

drop function public.api_create_yacimiento(text);

create function public.api_create_yacimiento(
  asset_name text,
  asset_provincia text,
  asset_operadora text,
  asset_contratista text
)
returns public.yacimientos language plpgsql security definer set search_path = public as $$
declare result public.yacimientos;
begin
  perform public.require_authenticated_cuenta();
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol = 'cliente') then
    raise exception using errcode = 'insufficient_privilege', message = 'Only a Cliente can create a Yacimiento';
  end if;
  insert into public.yacimientos(cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (
    auth.uid(),
    public.require_asset_name(asset_name),
    public.require_nonblank(asset_provincia, 'Provincia'),
    public.require_nonblank(asset_operadora, 'Operadora'),
    public.require_nonblank(asset_contratista, 'Contratista')
  )
  returning * into result;
  return result;
end;
$$;

create or replace function public.api_update_yacimiento(
  target uuid,
  asset_name text,
  asset_provincia text,
  asset_operadora text,
  asset_contratista text
)
returns public.yacimientos language plpgsql security definer set search_path = public as $$
declare result public.yacimientos;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.yacimientos
    where id = target and cliente_cuenta_id = auth.uid()
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change a Yacimiento';
  end if;
  update public.yacimientos
  set nombre = public.require_asset_name(asset_name),
      provincia = public.require_nonblank(asset_provincia, 'Provincia'),
      operadora = public.require_nonblank(asset_operadora, 'Operadora'),
      contratista = public.require_nonblank(asset_contratista, 'Contratista')
  where id = target
  returning * into result;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', target, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', 'yacimiento'));
  return result;
end;
$$;

create or replace function public.api_create_descendant(kind text, parent_id uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare yid uuid; result jsonb; normalized_name text;
begin
  perform public.require_authenticated_cuenta();
  if kind not in ('planta', 'equipo', 'valvula') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type';
  end if;
  normalized_name := public.require_asset_name(asset_name);
  if kind = 'planta' then
    select yacimiento_id into yid from public.yacimientos where id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.plantas_locaciones(yacimiento_id, nombre) values (yid, normalized_name) returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid from public.plantas_locaciones p where p.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.equipos_unidades(planta_id, nombre) values (parent_id, normalized_name) returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where e.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.valvulas(equipo_id, nombre) values (parent_id, normalized_name) returning to_jsonb(valvulas.*) into result;
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  return result;
end;
$$;

create or replace function public.api_update_descendant(kind text, target uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare yid uuid; result jsonb; normalized_name text;
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
    update public.valvulas set nombre = normalized_name where id = target returning to_jsonb(valvulas.*) into result;
  end if;
  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Descendant not found';
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', kind));
  return result;
end;
$$;

create or replace function public.api_request_certificate(target uuid, provider uuid)
returns public.solicitudes_certificado language plpgsql security definer set search_path = public as $$
declare result public.solicitudes_certificado;
begin
  perform public.require_authenticated_cuenta();
  if not exists (select 1 from public.yacimientos where id = target and cliente_cuenta_id = auth.uid()) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can request service';
  end if;
  if not exists (select 1 from public.talleres_moviles where id = provider) then
    raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found';
  end if;
  insert into public.solicitudes_certificado(yacimiento_id, taller_movil_id, solicitante_cuenta_id)
  values (target, provider, auth.uid()) returning * into result;
  return result;
end;
$$;

create or replace function public.api_accept_request(request_id uuid)
returns public.asignaciones_servicio language plpgsql security definer set search_path = public as $$
declare request public.solicitudes_certificado; provider uuid; old_assignment public.asignaciones_servicio; result public.asignaciones_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into request from public.solicitudes_certificado where id = request_id for update;
  select taller_movil_id into provider from public.taller_cuentas where cuenta_id = auth.uid();
  if request.id is null or provider is null or request.taller_movil_id <> provider or request.estado <> 'pendiente' then
    raise exception using errcode = 'insufficient_privilege', message = 'Cannot accept this request';
  end if;
  select * into old_assignment from public.asignaciones_servicio where yacimiento_id = request.yacimiento_id and estado = 'activa' for update;
  if old_assignment.id is not null then
    update public.asignaciones_servicio set estado = 'finalizada', ended_at = now() where id = old_assignment.id;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
    values ('servicio', request.yacimiento_id, old_assignment.id, auth.uid(), jsonb_build_object('event', 'replaced', 'taller_movil_id', old_assignment.taller_movil_id));
  end if;
  update public.solicitudes_certificado set estado = 'aceptada', decided_at = now() where id = request.id;
  insert into public.asignaciones_servicio(yacimiento_id, taller_movil_id, solicitud_id)
  values (request.yacimiento_id, provider, request.id) returning * into result;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request.yacimiento_id, result.id, auth.uid(), jsonb_build_object('event', 'accepted', 'taller_movil_id', provider));
  return result;
end;
$$;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.api_context() to authenticated;
grant execute on function public.api_yacimientos() to authenticated;
grant execute on function public.api_yacimiento_tree(uuid) to authenticated;
grant execute on function public.api_assignment(uuid) to authenticated;
grant execute on function public.api_create_yacimiento(text, text, text, text) to authenticated;
grant execute on function public.api_update_yacimiento(uuid, text, text, text, text) to authenticated;
grant execute on function public.api_create_descendant(text, uuid, text) to authenticated;
grant execute on function public.api_update_descendant(text, uuid, text) to authenticated;
grant execute on function public.api_request_certificate(uuid, uuid) to authenticated;
grant execute on function public.api_accept_request(uuid) to authenticated;

commit;

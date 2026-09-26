begin;

create or replace function public.require_authenticated_cuenta()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null
    or not exists (select 1 from public.cuentas where id = auth.uid()) then
    raise exception using errcode = 'insufficient_privilege', message = 'Authentication required';
  end if;
end;
$$;

create or replace function public.require_yacimiento_access(target uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access_yacimiento(target) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
end;
$$;

create or replace function public.api_yacimientos()
returns setof public.yacimientos language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_authenticated_cuenta();
  return query
    select y.* from public.yacimientos y
    where public.can_access_yacimiento(y.id);
end;
$$;

create or replace function public.api_create_descendant(kind text, parent_id uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yid uuid;
  result jsonb;
  normalized_name text;
begin
  perform public.require_authenticated_cuenta();
  if kind not in ('planta', 'equipo', 'valvula') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type';
  end if;
  normalized_name := public.require_asset_name(asset_name);

  if kind = 'planta' then
    select id into yid from public.yacimientos where id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.plantas_locaciones(yacimiento_id, nombre)
    values (yid, normalized_name)
    returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid from public.plantas_locaciones p where p.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.equipos_unidades(planta_id, nombre)
    values (parent_id, normalized_name)
    returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid
    from public.equipos_unidades e
    join public.plantas_locaciones p on p.id = e.planta_id
    where e.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then
      raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy';
    end if;
    insert into public.valvulas(equipo_id, nombre)
    values (parent_id, normalized_name)
    returning to_jsonb(valvulas.*) into result;
  end if;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  return result;
end;
$$;

grant execute on function public.api_yacimientos() to authenticated;
grant execute on function public.api_create_descendant(text, uuid, text) to authenticated;

create or replace function public.api_relationship_history(target_yacimiento uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select rol into account_role from public.cuentas where id = auth.uid();
  if account_role not in ('administrador_regular', 'super_administrador') then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can inspect relationship history';
  end if;
  return jsonb_build_object('history', coalesce((
    select jsonb_agg(to_jsonb(h) order by h.created_at)
    from public.historial_relaciones h
    where h.yacimiento_id = target_yacimiento
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.api_relationship_history(uuid) from public, anon, authenticated;
grant execute on function public.api_relationship_history(uuid) to authenticated;

create or replace function public.api_offline_working_set()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select taller_movil_id into provider from public.taller_cuentas where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = 'insufficient_privilege', message = 'Only a Taller Móvil can use the offline working set';
  end if;
  return jsonb_build_object('visits', coalesce((
    select jsonb_agg(jsonb_build_object(
      'visit', public.api_visit(v.id)->'visit',
      'work_orders', public.api_visit(v.id)->'work_orders',
      'context', public.api_yacimiento_tree(v.yacimiento_id)
    ) order by v.starts_at)
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and v.estado in ('aceptada', 'en_curso')
      and v.starts_at < now() + interval '2 days'
      and v.ends_at > now() - interval '1 day'
  ), '[]'::jsonb));
end;
$$;

grant execute on function public.api_offline_working_set() to authenticated;
alter function public.api_yacimiento_tree(uuid) stable;

create table public.dispositivos_visita (
  visita_id uuid primary key references public.visitas_servicio(id) on delete cascade,
  device_id uuid not null,
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.dispositivos_visita enable row level security;

create or replace function public.api_claim_visit_device(target_visit uuid, target_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  current_claim public.dispositivos_visita;
begin
  perform public.api_assigned_visit(target_visit);
  if target_device is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A device id is required';
  end if;
  select * into current_claim from public.dispositivos_visita where visita_id = target_visit for update;
  if current_claim.visita_id is not null and current_claim.device_id <> target_device and current_claim.last_seen_at > now() - interval '1 day' then
    raise exception using errcode = 'check_violation', message = 'Another device is already working on this visit';
  end if;
  insert into public.dispositivos_visita(visita_id, device_id, claimed_at, last_seen_at)
  values (target_visit, target_device, now(), now())
  on conflict (visita_id) do update
    set device_id = excluded.device_id, last_seen_at = excluded.last_seen_at;
  return jsonb_build_object('visit_id', target_visit, 'device_id', target_device, 'claimed_at', now());
end;
$$;

create or replace function public.api_sync_visit_batch(target_visit uuid, operations jsonb, target_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.api_claim_visit_device(target_visit, target_device);
  return public.api_sync_visit_batch(target_visit, operations);
end;
$$;

revoke all on function public.api_claim_visit_device(uuid, uuid), public.api_sync_visit_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_claim_visit_device(uuid, uuid), public.api_sync_visit_batch(uuid, jsonb, uuid) to authenticated;

commit;

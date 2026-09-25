begin;

drop function public.api_accept_request(uuid);
drop function public.api_request_certificate(uuid, uuid);

alter table public.solicitudes_certificado rename to solicitudes_servicio;
alter table public.solicitudes_servicio rename column solicitante_cuenta_id to cliente_cuenta_id;
alter table public.solicitudes_servicio alter column taller_movil_id drop not null;
alter table public.solicitudes_servicio add column updated_at timestamptz not null default now();
alter table public.solicitudes_servicio add column accepted_at timestamptz;

create table public.solicitud_valvulas (
  solicitud_id uuid not null references public.solicitudes_servicio(id) on delete cascade,
  valvula_id uuid not null references public.valvulas(id),
  selected_at timestamptz not null default now(),
  primary key (solicitud_id, valvula_id)
);

create index solicitud_valvulas_valvula_idx on public.solicitud_valvulas(valvula_id);
alter table public.solicitud_valvulas enable row level security;

create or replace function public.api_expand_service_selection(target_yacimiento uuid, selections jsonb)
returns table (valvula_id uuid)
language plpgsql security definer set search_path = public as $$
declare selection jsonb; selection_kind text; selection_id uuid; selection_yacimiento uuid;
begin
  if jsonb_typeof(selections) <> 'array' or jsonb_array_length(selections) = 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'At least one service selection is required';
  end if;
  for selection in select value from jsonb_array_elements(selections) loop
    selection_kind := selection->>'kind';
    begin
      selection_id := (selection->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'invalid_parameter_value', message = 'Service selection id must be a UUID';
    end;
    if selection_kind = 'yacimiento' then
      if selection_id <> target_yacimiento then
        raise exception using errcode = 'invalid_parameter_value', message = 'Service selection is outside the Yacimiento';
      end if;
      return query
        select v.id from public.valvulas v
        join public.equipos_unidades e on e.id = v.equipo_id
        join public.plantas_locaciones p on p.id = e.planta_id
        where p.yacimiento_id = target_yacimiento;
    elsif selection_kind = 'planta' then
      select p.yacimiento_id into selection_yacimiento from public.plantas_locaciones p where p.id = selection_id;
      if selection_yacimiento is null or selection_yacimiento <> target_yacimiento then
        raise exception using errcode = 'invalid_parameter_value', message = 'Service selection is outside the Yacimiento';
      end if;
      return query
        select v.id from public.valvulas v
        join public.equipos_unidades e on e.id = v.equipo_id
        where e.planta_id = selection_id;
    elsif selection_kind = 'equipo' then
      select p.yacimiento_id into selection_yacimiento
      from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id
      where e.id = selection_id;
      if selection_yacimiento is null or selection_yacimiento <> target_yacimiento then
        raise exception using errcode = 'invalid_parameter_value', message = 'Service selection is outside the Yacimiento';
      end if;
      return query select id from public.valvulas where equipo_id = selection_id;
    elsif selection_kind = 'valvula' then
      select p.yacimiento_id into selection_yacimiento
      from public.valvulas v
      join public.equipos_unidades e on e.id = v.equipo_id
      join public.plantas_locaciones p on p.id = e.planta_id
      where v.id = selection_id;
      if selection_yacimiento is null or selection_yacimiento <> target_yacimiento then
        raise exception using errcode = 'invalid_parameter_value', message = 'Service selection is outside the Yacimiento';
      end if;
      return query select selection_id;
    else
      raise exception using errcode = 'invalid_parameter_value', message = 'Unknown service selection type';
    end if;
  end loop;
end;
$$;

create or replace function public.api_replace_service_selection(request_id uuid, target_yacimiento uuid, selections jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.solicitud_valvulas where solicitud_id = request_id;
  insert into public.solicitud_valvulas(solicitud_id, valvula_id)
  select request_id, valvula_id
  from public.api_expand_service_selection(target_yacimiento, selections)
  on conflict do nothing;
  if not exists (select 1 from public.solicitud_valvulas where solicitud_id = request_id) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Service selection contains no Válvulas';
  end if;
end;
$$;

create or replace function public.api_create_service_request(target_yacimiento uuid, selections jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol = 'cliente')
    or not exists (select 1 from public.yacimientos where id = target_yacimiento and cliente_cuenta_id = auth.uid()) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can create a service request';
  end if;
  insert into public.solicitudes_servicio(yacimiento_id, cliente_cuenta_id)
  values (target_yacimiento, auth.uid()) returning * into result;
  perform public.api_replace_service_selection(result.id, target_yacimiento, selections);
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', target_yacimiento, result.id, auth.uid(), jsonb_build_object('event', 'request_created'));
  return public.api_service_request(result.id);
end;
$$;

create or replace function public.api_update_service_request(request_id uuid, selections jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_row public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  select * into request_row from public.solicitudes_servicio where id = request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can edit a service request';
  end if;
  if request_row.accepted_at is not null then
    raise exception using errcode = 'check_violation', message = 'Accepted service requests cannot be edited';
  end if;
  perform public.api_replace_service_selection(request_id, request_row.yacimiento_id, selections);
  update public.solicitudes_servicio set updated_at = now() where id = request_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', request_row.yacimiento_id, request_id, auth.uid(), jsonb_build_object('event', 'request_selection_updated'));
  return public.api_service_request(request_id);
end;
$$;

create or replace function public.api_service_request(request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare request_row public.solicitudes_servicio; account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into request_row from public.solicitudes_servicio where id = request_id;
  select rol into account_role from public.cuentas where id = auth.uid();
  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;
  if account_role not in ('administrador_regular', 'super_administrador') and request_row.cliente_cuenta_id <> auth.uid() then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
  return jsonb_build_object(
    'request', to_jsonb(request_row),
    'selected_valves', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.nombre) order by v.nombre)
      from public.solicitud_valvulas sv join public.valvulas v on v.id = sv.valvula_id
      where sv.solicitud_id = request_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_service_requests()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select rol into account_role from public.cuentas where id = auth.uid();
  if account_role in ('administrador_regular', 'super_administrador') then
    return query select public.api_service_request(s.id) from public.solicitudes_servicio s order by s.created_at;
  elsif account_role = 'cliente' then
    return query select public.api_service_request(s.id) from public.solicitudes_servicio s where s.cliente_cuenta_id = auth.uid() order by s.created_at;
  end if;
end;
$$;

revoke all on function public.api_expand_service_selection(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.api_replace_service_selection(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.api_create_service_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.api_update_service_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.api_service_request(uuid) from public, anon, authenticated;
revoke all on function public.api_service_requests() from public, anon, authenticated;

grant execute on function public.api_create_service_request(uuid, jsonb) to authenticated;
grant execute on function public.api_update_service_request(uuid, jsonb) to authenticated;
grant execute on function public.api_service_request(uuid) to authenticated;
grant execute on function public.api_service_requests() to authenticated;

commit;

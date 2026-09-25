begin;

create type public.estado_orden_trabajo as enum ('pendiente', 'evaluada', 'no_evaluada');
alter table public.ordenes_trabajo
  add column estado public.estado_orden_trabajo not null default 'pendiente',
  add column no_evaluada_razon text,
  add constraint orden_no_evaluada_razon check ((estado = 'no_evaluada' and btrim(no_evaluada_razon) <> '') or (estado <> 'no_evaluada' and no_evaluada_razon is null));

create or replace function public.api_assigned_visit(target uuid)
returns public.visitas_servicio language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio; provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select * into v from public.visitas_servicio where id = target for update;
  select taller_movil_id into provider from public.taller_cuentas where cuenta_id = auth.uid();
  if v.id is null or provider is null or provider <> v.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can execute this visit';
  end if;
  return v;
end;
$$;

create or replace function public.api_start_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio;
begin
  select * into v from public.api_assigned_visit(visit_id);
  if v.estado <> 'aceptada' then raise exception using errcode = 'check_violation', message = 'Only an accepted visit can begin'; end if;
  update public.visitas_servicio set estado = 'en_curso', updated_at = now() where id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

create or replace function public.api_update_work_order(work_order_id uuid, outcome public.estado_orden_trabajo, not_evaluated_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.ordenes_trabajo; v public.visitas_servicio;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null then raise exception using errcode = 'no_data_found', message = 'Work order not found'; end if;
  select * into v from public.api_assigned_visit(o.visita_id);
  if v.estado <> 'en_curso' then raise exception using errcode = 'check_violation', message = 'Work orders can be updated only while the visit is in progress'; end if;
  if outcome not in ('evaluada', 'no_evaluada') then raise exception using errcode = 'invalid_parameter_value', message = 'A work order outcome must be evaluada or no_evaluada'; end if;
  if outcome = 'no_evaluada' and (not_evaluated_reason is null or btrim(not_evaluated_reason) = '') then raise exception using errcode = 'invalid_parameter_value', message = 'A no evaluada work order requires a reason'; end if;
  update public.ordenes_trabajo set estado = outcome, no_evaluada_razon = case when outcome = 'no_evaluada' then btrim(not_evaluated_reason) else null end where id = work_order_id returning * into o;
  return jsonb_build_object('work_order', to_jsonb(o));
end;
$$;

create or replace function public.api_add_work_order(visit_id uuid, target_valvula uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio; target_yacimiento uuid; owner_id uuid; provider uuid; o public.ordenes_trabajo;
begin
  select * into v from public.api_assigned_visit(visit_id);
  if v.estado <> 'en_curso' then raise exception using errcode = 'check_violation', message = 'Válvulas can be added only while the visit is in progress'; end if;
  select p.yacimiento_id into target_yacimiento from public.valvulas x join public.equipos_unidades e on e.id = x.equipo_id join public.plantas_locaciones p on p.id = e.planta_id where x.id = target_valvula;
  if target_yacimiento is null then raise exception using errcode = 'no_data_found', message = 'Válvula not found'; end if;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = v.yacimiento_id;
  if not exists (select 1 from public.yacimientos where id = target_yacimiento and cliente_cuenta_id = owner_id) then raise exception using errcode = 'insufficient_privilege', message = 'An added Válvula must belong to the same Cliente'; end if;
  select taller_movil_id into provider from public.asignaciones_servicio where yacimiento_id = target_yacimiento and estado = 'activa';
  if provider is null or provider <> v.taller_movil_id then raise exception using errcode = 'insufficient_privilege', message = 'The Taller Móvil requires active Yacimiento access'; end if;
  insert into public.ordenes_trabajo(visita_id, valvula_id) values (visit_id, target_valvula) on conflict (visita_id, valvula_id) do update set valvula_id = excluded.valvula_id returning * into o;
  return jsonb_build_object('work_order', to_jsonb(o));
end;
$$;

create or replace function public.api_complete_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio;
begin
  select * into v from public.api_assigned_visit(visit_id);
  if v.estado <> 'en_curso' then raise exception using errcode = 'check_violation', message = 'Only an in-progress visit can be completed'; end if;
  update public.visitas_servicio set estado = 'completada', updated_at = now() where id = visit_id;
  delete from public.visita_equipos where visita_id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_assigned_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_start_visit(uuid) from public, anon, authenticated;
revoke all on function public.api_update_work_order(uuid, public.estado_orden_trabajo, text) from public, anon, authenticated;
revoke all on function public.api_add_work_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_complete_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_start_visit(uuid), public.api_update_work_order(uuid, public.estado_orden_trabajo, text), public.api_add_work_order(uuid, uuid), public.api_complete_visit(uuid) to authenticated;

commit;

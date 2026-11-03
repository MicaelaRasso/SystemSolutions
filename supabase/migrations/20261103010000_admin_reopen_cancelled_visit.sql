create or replace function public.api_admin_reopen_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  visit_row public.visitas_servicio;
  owner_id uuid;
  target_status public.estado_visita;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can restore a visit';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if visit_row.estado <> 'cancelada' then
    raise exception using errcode = 'check_violation', message = 'Only a cancelled visit can be restored';
  end if;

  if visit_row.taller_movil_id is not null and visit_row.starts_at is not null and visit_row.ends_at is not null then
    target_status := 'programada';
  else
    target_status := 'solicitada';
  end if;

  update public.visitas_servicio
  set estado = target_status, cancelled_at = null, updated_at = now()
  where id = visit_id returning * into visit_row;

  if target_status = 'programada' then
    delete from public.visita_equipos where visita_id = visit_id;
    insert into public.visita_equipos(visita_id, equipo_id, ventana)
    select distinct visit_id, v.equipo_id, tstzrange(visit_row.starts_at, visit_row.ends_at, '[)')
    from public.ordenes_trabajo ot join public.valvulas v on v.id = ot.valvula_id
    where ot.visita_id = visit_id;
  end if;

  update public.solicitudes_servicio
  set estado = 'pendiente', updated_at = now()
  where id = visit_row.solicitud_id;

  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_reopened_by_administrator', 'estado_anterior', 'cancelada', 'estado_nuevo', target_status));

  perform public.record_audit_event(
    'visita_reabierta_por_administrador', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', 'cancelada', 'estado_nuevo', visit_row.estado),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id, 'taller_movil_id', visit_row.taller_movil_id),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );

  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_admin_reopen_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_admin_reopen_visit(uuid) to authenticated;


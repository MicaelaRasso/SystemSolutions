-- 20261005154315 hizo que el evento `visita_completada` guarde la hora del dispositivo
-- (`evento_dispositivo_en`) tomada de la operación offline `complete_visit`, para que una
-- visita cerrada sin conexión conserve la hora real del Técnico. 20261006130839 reescribió
-- `audit_visit_transition` (rechazos, reasignaciones y reprogramaciones) y perdió esa
-- búsqueda: desde entonces el evento queda con la hora del dispositivo en null
-- (test: service_workflow, «completion audit preserves the Técnico, server receipt time,
-- offline device event time, and correlation identity»).
--
-- Misma función que 20261006130839 con la hora del dispositivo restaurada. La hora de
-- recepción del servidor sigue siendo la que ordena la auditoría.
create or replace function public.audit_visit_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  action_name text;
  device_event_at timestamptz;
begin
  select cliente_cuenta_id into owner_id from public.yacimientos where id = new.yacimiento_id;
  if tg_op = 'INSERT' then
    action_name := 'visita_programada';
  elsif old.rejected_at is distinct from new.rejected_at and new.rejected_at is not null then
    action_name := 'visita_rechazada';
  elsif old.estado is distinct from new.estado then
    action_name := case new.estado when 'aceptada' then 'visita_aceptada' when 'en_curso' then 'visita_iniciada' when 'completada' then 'visita_completada' when 'cancelada' then 'visita_cancelada' when 'programada' then 'visita_reprogramada' else 'visita_estado_actualizado' end;
    if new.estado = 'completada' then
      select os.device_timestamp
        into device_event_at
      from public.operaciones_sync os
      where os.visita_id = new.id
        and os.kind = 'complete_visit'
        and os.device_timestamp is not null
      order by os.server_received_at desc nulls last, os.created_at desc
      limit 1;
    end if;
  elsif old.taller_movil_id is distinct from new.taller_movil_id then
    action_name := case when old.taller_movil_id is null then 'visita_asignada' when new.taller_movil_id is null then 'visita_desasignada' else 'visita_reasignada' end;
  elsif old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    action_name := 'visita_reprogramada';
  else
    return new;
  end if;
  perform public.record_audit_event(action_name, 'visita_servicio', new.id, 'exitoso',
    jsonb_build_object('estado_anterior', case when tg_op = 'UPDATE' then old.estado else null end,
      'estado_nuevo', new.estado, 'inicio_anterior', case when tg_op = 'UPDATE' then old.starts_at else null end,
      'inicio_nuevo', new.starts_at, 'fin_anterior', case when tg_op = 'UPDATE' then old.ends_at else null end,
      'fin_nuevo', new.ends_at),
    jsonb_build_object('taller_movil_anterior', case when tg_op = 'UPDATE' then old.taller_movil_id else null end,
      'taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id),
    device_event_at, null, owner_id, new.yacimiento_id, new.id, null);
  return new;
end;
$$;

revoke all on function public.audit_visit_transition() from public, anon, authenticated;
grant execute on function public.audit_visit_transition() to service_role;

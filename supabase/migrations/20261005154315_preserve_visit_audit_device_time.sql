begin;

-- Visit completion can be synchronized later than the Técnico's local action.
-- Keep the server receipt time as the audit ordering authority while retaining
-- the event time already captured by the durable offline operation.
create or replace function public.audit_visit_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  device_event_at timestamptz;
begin
  select cliente_cuenta_id
    into owner_id
  from public.yacimientos
  where id = new.yacimiento_id;

  if tg_op = 'INSERT' and new.estado = 'programada' then
    perform public.record_audit_event(
      'visita_programada', 'visita_servicio', new.id, 'exitoso',
      jsonb_build_object('estado_nuevo', new.estado, 'starts_at', new.starts_at, 'ends_at', new.ends_at),
      jsonb_build_object('taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id),
      null, null, owner_id, new.yacimiento_id, new.id, null
    );
  elsif tg_op = 'UPDATE' and old.estado is distinct from new.estado then
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

    perform public.record_audit_event(
      case new.estado
        when 'aceptada' then 'visita_aceptada'
        when 'en_curso' then 'visita_iniciada'
        when 'completada' then 'visita_completada'
        when 'cancelada' then 'visita_cancelada'
        when 'programada' then 'visita_reprogramada'
        else 'visita_estado_actualizado'
      end,
      'visita_servicio', new.id, 'exitoso',
      jsonb_build_object('estado_anterior', old.estado, 'estado_nuevo', new.estado),
      jsonb_build_object('taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id),
      device_event_at, null, owner_id, new.yacimiento_id, new.id, null
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_visit_transition() from public, anon, authenticated;
grant execute on function public.audit_visit_transition() to service_role;

commit;

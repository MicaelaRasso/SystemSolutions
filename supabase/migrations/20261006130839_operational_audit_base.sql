begin;

-- Give the existing audit stream stable operational action names and include
-- mutations that were previously outside the generic row trigger set.
create or replace function public.audit_business_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  row_data jsonb;
  target uuid;
  action_name text;
  client_id uuid;
  yid uuid;
  visit_id uuid;
  cert_id uuid;
  related jsonb := '{}'::jsonb;
begin
  row_data := case when tg_op = 'DELETE' then old_row else new_row end;
  target := coalesce(nullif(row_data->>'id', '')::uuid,
    nullif(row_data->>'visita_id', '')::uuid,
    nullif(row_data->>'solicitud_id', '')::uuid,
    nullif(row_data->>'cuenta_id', '')::uuid,
    nullif(row_data->>'cliente_cuenta_id', '')::uuid,
    nullif(row_data->>'taller_movil_id', '')::uuid);

  action_name := case tg_table_name
    when 'solicitudes_servicio' then case tg_op when 'INSERT' then 'solicitud_servicio_creada' when 'UPDATE' then 'solicitud_servicio_editada' else 'solicitud_servicio_eliminada' end
    when 'solicitud_valvulas' then 'solicitud_servicio_alcance_actualizado'
    when 'ordenes_trabajo' then case when tg_op = 'INSERT' then 'orden_trabajo_agregada' when old_row->>'estado' is distinct from new_row->>'estado' then 'orden_trabajo_resultado_registrado' else 'orden_trabajo_actualizada' end
    when 'certificados' then case when tg_op = 'INSERT' then 'certificado_borrador_creado' when old_row->>'estado' is distinct from new_row->>'estado' and new_row->>'estado' = 'finalizado' then 'certificado_finalizado' else 'certificado_actualizado' end
    when 'firmas_visita' then 'firma_visita_registrada'
    when 'registros_generacion_backup' then 'backup_manual_generado'
    when 'conflictos_sync' then case when tg_op = 'INSERT' then 'conflicto_sync_detectado' when old_row->>'resolved_at' is distinct from new_row->>'resolved_at' then 'conflicto_sync_resuelto' else 'conflicto_sync_actualizado' end
    when 'cuentas' then case when tg_op = 'INSERT' then 'cuenta_creada' when old_row->>'activo' is distinct from new_row->>'activo' then 'cuenta_acceso_actualizado' else 'cuenta_actualizada' end
    when 'cliente_cuentas' then case tg_op when 'INSERT' then 'cliente_cuenta_vinculada' when 'DELETE' then 'cliente_cuenta_desvinculada' else 'cliente_cuenta_actualizada' end
    when 'nominas_jornada' then 'taller_jornada_actualizada'
    when 'taller_cuentas' then 'taller_movil_acceso_actualizado'
    when 'cliente_accesos' then 'cliente_acceso_actualizado'
    when 'talleres_moviles' then 'taller_movil_actualizado'
    when 'personas' then 'tecnico_actualizado'
    when 'catalogo_opciones' then 'catalogo_actualizado'
    when 'replacement_catalog_versions' then 'catalogo_repuestos_publicado'
    when 'patrones_ensayo' then 'configuracion_patron_ensayo_actualizada'
    else lower(tg_table_name) || '_' || lower(tg_op)
  end;

  if tg_table_name in ('solicitudes_servicio', 'solicitud_valvulas') then
    if tg_table_name = 'solicitud_valvulas' then
      select s.cliente_cuenta_id, s.yacimiento_id into client_id, yid
      from public.solicitudes_servicio s where s.id = nullif(row_data->>'solicitud_id', '')::uuid;
      related := jsonb_build_object('solicitud_id', nullif(row_data->>'solicitud_id', '')::uuid,
        'valvula_id', nullif(row_data->>'valvula_id', '')::uuid);
    else
      client_id := nullif(row_data->>'cliente_cuenta_id', '')::uuid;
      yid := nullif(row_data->>'yacimiento_id', '')::uuid;
      related := jsonb_build_object('cliente_cuenta_id', client_id, 'yacimiento_id', yid);
    end if;
  elsif tg_table_name = 'visitas_servicio' then
    visit_id := target;
    yid := nullif(row_data->>'yacimiento_id', '')::uuid;
  elsif tg_table_name in ('ordenes_trabajo', 'firmas_visita', 'conflictos_sync') then
    visit_id := nullif(row_data->>'visita_id', '')::uuid;
    if visit_id is not null then
      select v.yacimiento_id into yid from public.visitas_servicio v where v.id = visit_id;
    end if;
    related := jsonb_build_object('visita_id', visit_id);
    if tg_table_name = 'ordenes_trabajo' then related := related || jsonb_build_object('orden_trabajo_id', target, 'valvula_id', nullif(row_data->>'valvula_id', '')::uuid); end if;
    if tg_table_name = 'firmas_visita' then related := related || jsonb_build_object('parte', row_data->>'parte', 'firmante', row_data->>'nombre_firmante'); end if;
    if tg_table_name = 'conflictos_sync' then
      related := related || jsonb_build_object(
        'conflicto_id', target,
        'operation_id', nullif(row_data->>'operation_id', '')::uuid,
        'decision', row_data->>'resolution_action',
        'motivo', row_data->>'resolution_reason'
      );
    end if;
  elsif tg_table_name = 'certificados' then
    cert_id := target;
    visit_id := nullif(row_data->>'visita_id', '')::uuid;
    yid := nullif(row_data->>'yacimiento_id', '')::uuid;
    related := jsonb_build_object('certificado_id', cert_id, 'visita_id', visit_id, 'orden_trabajo_id', nullif(row_data->>'orden_trabajo_id', '')::uuid);
  elsif tg_table_name = 'registros_generacion_backup' then
    related := jsonb_build_object('backup_id', target, 'scope', row_data->>'scope');
  elsif tg_table_name in ('taller_cuentas', 'cliente_accesos') then
    related := row_data - 'created_at';
  elsif tg_table_name = 'cliente_cuentas' then
    related := row_data - 'created_at';
  elsif tg_table_name = 'nominas_jornada' then
    related := jsonb_build_object('taller_movil_id', row_data->>'taller_movil_id',
      'fecha', row_data->>'fecha', 'persona_ids', coalesce(row_data->'persona_ids', '[]'::jsonb));
  else
    related := jsonb_build_object('id', target);
  end if;

  if yid is not null and client_id is null then
    select cliente_cuenta_id into client_id from public.yacimientos where id = yid;
  end if;
  perform public.record_audit_event(
    action_name,
    case when tg_table_name = 'registros_generacion_backup' then 'backup_manual'
      when tg_table_name in ('replacement_catalog_versions','catalogo_opciones','patrones_ensayo') then 'configuracion'
      when tg_table_name in ('cuentas','cliente_cuentas','taller_cuentas','cliente_accesos','talleres_moviles','personas','nominas_jornada') then 'administracion'
      when tg_table_name = 'conflictos_sync' then 'conflicto_sincronizacion'
      when tg_table_name in ('solicitudes_servicio','solicitud_valvulas') then 'solicitud_servicio'
      when tg_table_name = 'ordenes_trabajo' then 'orden_trabajo'
      when tg_table_name = 'certificados' then 'certificado'
      when tg_table_name = 'firmas_visita' then 'visita_servicio'
      else replace(tg_table_name, '_', '_') end,
    target,
    'exitoso',
    jsonb_build_object('operacion', tg_op, 'tabla', tg_table_name,
      'estado_anterior', old_row->>'estado', 'estado_nuevo', new_row->>'estado',
      'decision', case when tg_table_name = 'conflictos_sync' then new_row->>'resolution_action' else null end,
      'motivo', case when tg_table_name = 'conflictos_sync' then new_row->>'resolution_reason' else null end,
      'rol_asignado', case when tg_table_name = 'cuentas' and tg_op = 'INSERT' then new_row->>'rol' else null end),
    related,
    null, null, client_id, yid, visit_id, cert_id
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- The visit trigger also captures reassignment and scheduling edits where the
-- lifecycle state itself stays the same.
create or replace function public.audit_visit_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  action_name text;
begin
  select cliente_cuenta_id into owner_id from public.yacimientos where id = new.yacimiento_id;
  if tg_op = 'INSERT' then
    action_name := 'visita_programada';
  elsif old.rejected_at is distinct from new.rejected_at and new.rejected_at is not null then
    action_name := 'visita_rechazada';
  elsif old.estado is distinct from new.estado then
    action_name := case new.estado when 'aceptada' then 'visita_aceptada' when 'en_curso' then 'visita_iniciada' when 'completada' then 'visita_completada' when 'cancelada' then 'visita_cancelada' when 'programada' then 'visita_reprogramada' else 'visita_estado_actualizado' end;
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
    null, null, owner_id, new.yacimiento_id, new.id, null);
  return new;
end;
$$;

drop trigger if exists visitas_servicio_audit_transition on public.visitas_servicio;
create trigger visitas_servicio_audit_transition after insert or update of estado, taller_movil_id, starts_at, ends_at on public.visitas_servicio
for each row execute function public.audit_visit_transition();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'solicitudes_servicio','solicitud_valvulas','ordenes_trabajo','certificados','cuentas',
    'talleres_moviles','cliente_cuentas','taller_cuentas','cliente_accesos',
    'nominas_jornada','personas',
    'catalogo_opciones','patrones_ensayo','firmas_visita',
    'registros_generacion_backup','conflictos_sync','replacement_catalog_versions'
  ] loop
    execute format('drop trigger if exists %I_audit_change on public.%I', table_name, table_name);
    execute format('create trigger %I_audit_change after insert or update or delete on public.%I for each row execute function public.audit_business_change()', table_name, table_name);
  end loop;
end;
$$;

-- Keep historical generic target names visible to regular Administradores;
-- all new events below use the canonical singular names.
create or replace function public.api_audit_events(
  from_date date default null, to_date date default null, actor_filter uuid default null,
  action_filter text default null, target_type_filter text default null, outcome_filter text default null,
  client_filter uuid default null, yacimiento_filter uuid default null, visit_filter uuid default null,
  certificate_filter uuid default null, limit_count integer default 100, offset_count integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare actor_role public.rol; result jsonb;
begin
  actor_role := public.api_audit_require_admin();
  if limit_count < 1 or limit_count > 100 or offset_count < 0 then raise exception using errcode = 'invalid_parameter_value', message = 'Invalid pagination'; end if;
  if outcome_filter is not null and outcome_filter not in ('exitoso', 'fallido') then raise exception using errcode = 'invalid_parameter_value', message = 'Invalid outcome filter'; end if;
  if from_date is not null and to_date is not null and from_date > to_date then raise exception using errcode = 'invalid_parameter_value', message = 'Invalid date range'; end if;
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(x) order by x.recibida_en desc, x.id desc), '[]'::jsonb),
    'total', coalesce(max(x.total_count), 0), 'limit', limit_count, 'offset', offset_count,
    'has_more', coalesce(max(x.total_count), 0) > offset_count + limit_count
  ) into result
  from (
    select a.*, c.rol as actor_rol, coalesce(u.email, '') as actor_email,
      y.nombre as yacimiento_nombre, count(*) over () as total_count
    from public.registros_auditoria a
    left join public.cuentas c on c.id = a.actor_cuenta_id
    left join auth.users u on u.id = a.actor_cuenta_id
    left join public.yacimientos y on y.id = a.yacimiento_id
    where (actor_role = 'super_administrador' or a.tipo_objetivo in (
        'solicitud_servicio','solicitudes_servicio','visita_servicio','orden_trabajo',
        'ordenes_trabajo','certificado','certificados','firmas_visita',
        'conflicto_sincronizacion','conflictos_sync'))
      and (from_date is null or a.recibida_en >= from_date::timestamptz)
      and (to_date is null or a.recibida_en < (to_date + 1)::timestamptz)
      and (actor_filter is null or a.actor_cuenta_id = actor_filter)
      and (action_filter is null or a.accion = action_filter)
      and (target_type_filter is null or a.tipo_objetivo = target_type_filter)
      and (outcome_filter is null or a.resultado = outcome_filter)
      and (client_filter is null or a.cliente_cuenta_id = client_filter)
      and (yacimiento_filter is null or a.yacimiento_id = yacimiento_filter)
      and (visit_filter is null or a.visita_id = visit_filter)
      and (certificate_filter is null or a.certificado_id = certificate_filter)
    order by a.recibida_en desc, a.id desc limit limit_count offset offset_count
  ) x;
  return coalesce(result, jsonb_build_object('items','[]'::jsonb,'total',0,'limit',limit_count,'offset',offset_count,'has_more',false));
end;
$$;

create or replace function public.api_audit_event(event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare actor_role public.rol; target_type text;
begin
  actor_role := public.api_audit_require_admin();
  select tipo_objetivo into target_type from public.registros_auditoria where id = event_id;
  if actor_role <> 'super_administrador' and target_type not in (
    'solicitud_servicio','solicitudes_servicio','visita_servicio','orden_trabajo',
    'ordenes_trabajo','certificado','certificados','firmas_visita',
    'conflicto_sincronizacion','conflictos_sync') then
    raise exception using errcode = 'insufficient_privilege', message = 'Audit event is outside the operational scope';
  end if;
  return (select to_jsonb(a) from public.registros_auditoria a where a.id = event_id);
end;
$$;

-- These exports append their own export event before returning the requested
-- rows, so they must run with VOLATILE semantics.
alter function public.api_audit_export(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer) volatile;
alter function public.api_admin_certificate_export(uuid) volatile;

-- Edge handlers use this only after a sensitive RPC has failed. Validation
-- errors remain unaudited; callers must classify the denial before recording.
create or replace function public.record_sensitive_rejection(
  action_name text,
  target_type text,
  target_id uuid default null,
  change_summary jsonb default '{}'::jsonb,
  related_ids jsonb default '{}'::jsonb,
  client_id uuid default null,
  yacimiento_id uuid default null,
  visit_id uuid default null,
  certificate_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'An authenticated actor is required';
  end if;
  if action_name not in ('access_denied', 'sensitive_export_denied', 'account_admin_denied', 'conflict_resolution_denied') then
    raise exception using errcode = '22023', message = 'Unsupported rejected sensitive action';
  end if;
  return public.record_audit_event(action_name, target_type, target_id, 'fallido',
    coalesce(change_summary, '{}'::jsonb), coalesce(related_ids, '{}'::jsonb), null, null,
    client_id, yacimiento_id, visit_id, certificate_id);
end;
$$;

revoke all on function public.record_sensitive_rejection(text,text,uuid,jsonb,jsonb,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_sensitive_rejection(text,text,uuid,jsonb,jsonb,uuid,uuid,uuid,uuid) to service_role;

commit;

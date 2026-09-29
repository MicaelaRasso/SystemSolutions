begin;

-- Immutable operational audit records.  The table is deliberately separate
-- from historial_relaciones: this is the administrative observability stream,
-- ordered by the server receipt timestamp.
create table if not exists public.registros_auditoria (
  id uuid primary key default gen_random_uuid(),
  actor_cuenta_id uuid references public.cuentas(id),
  accion text not null,
  tipo_objetivo text not null,
  objetivo_id uuid,
  resultado text not null check (resultado in ('exitoso', 'fallido')),
  recibida_en timestamptz not null default now(),
  evento_dispositivo_en timestamptz,
  identidad_correlacion text,
  resumen_cambio jsonb not null default '{}'::jsonb,
  identificadores_relacionados jsonb not null default '{}'::jsonb,
  cliente_cuenta_id uuid references public.cuentas(id),
  yacimiento_id uuid references public.yacimientos(id),
  visita_id uuid references public.visitas_servicio(id),
  certificado_id uuid references public.certificados(id)
);

create index if not exists registros_auditoria_recibida_idx on public.registros_auditoria(recibida_en desc, id desc);
create index if not exists registros_auditoria_actor_idx on public.registros_auditoria(actor_cuenta_id, recibida_en desc);
create index if not exists registros_auditoria_target_idx on public.registros_auditoria(tipo_objetivo, objetivo_id);
create index if not exists registros_auditoria_scope_idx on public.registros_auditoria(cliente_cuenta_id, yacimiento_id, recibida_en desc);
alter table public.registros_auditoria enable row level security;

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception using errcode = 'insufficient_privilege', message = 'Registro de auditoría is append-only';
end;
$$;

drop trigger if exists registros_auditoria_no_update on public.registros_auditoria;
drop trigger if exists registros_auditoria_no_delete on public.registros_auditoria;
create trigger registros_auditoria_no_update before update on public.registros_auditoria for each row execute function public.prevent_audit_mutation();
create trigger registros_auditoria_no_delete before delete on public.registros_auditoria for each row execute function public.prevent_audit_mutation();

create or replace function public.record_audit_event(
  event_action text,
  target_type text,
  target_id uuid,
  event_outcome text default 'exitoso',
  change_summary jsonb default '{}'::jsonb,
  related_ids jsonb default '{}'::jsonb,
  device_event_at timestamptz default null,
  correlation_identity text default null,
  client_id uuid default null,
  deposit_id uuid default null,
  visit_id uuid default null,
  certificate_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare event_id uuid;
begin
  insert into public.registros_auditoria(
    actor_cuenta_id, accion, tipo_objetivo, objetivo_id, resultado,
    evento_dispositivo_en, identidad_correlacion, resumen_cambio,
    identificadores_relacionados, cliente_cuenta_id, yacimiento_id,
    visita_id, certificado_id
  ) values (
    auth.uid(), event_action, target_type, target_id, event_outcome,
    device_event_at, coalesce(correlation_identity, nullif((current_setting('request.headers', true)::jsonb ->> 'x-systemsolutions-correlation-id'), '')),
    coalesce(change_summary, '{}'::jsonb), coalesce(related_ids, '{}'::jsonb),
    client_id, deposit_id, visit_id, certificate_id
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function public.audit_visit_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  select cliente_cuenta_id into owner_id from public.yacimientos where id = new.yacimiento_id;
  if tg_op = 'INSERT' and new.estado = 'programada' then
    perform public.record_audit_event('visita_programada', 'visita_servicio', new.id, 'exitoso',
      jsonb_build_object('estado_nuevo', new.estado, 'starts_at', new.starts_at, 'ends_at', new.ends_at),
      jsonb_build_object('taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id), null, null, owner_id, new.yacimiento_id, new.id, null);
  elsif tg_op = 'UPDATE' and old.estado is distinct from new.estado then
    perform public.record_audit_event(case new.estado when 'aceptada' then 'visita_aceptada' when 'en_curso' then 'visita_iniciada' when 'completada' then 'visita_completada' when 'cancelada' then 'visita_cancelada' when 'programada' then 'visita_reprogramada' else 'visita_estado_actualizado' end, 'visita_servicio', new.id, 'exitoso',
      jsonb_build_object('estado_anterior', old.estado, 'estado_nuevo', new.estado),
      jsonb_build_object('taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id), null, null, owner_id, new.yacimiento_id, new.id, null);
  end if;
  return new;
end;
$$;

drop trigger if exists visitas_servicio_audit_transition on public.visitas_servicio;
create trigger visitas_servicio_audit_transition after insert or update of estado on public.visitas_servicio
for each row execute function public.audit_visit_transition();

-- The remaining state-changing capabilities share the same append-only seam.
-- This intentionally records successful writes only: a failed transaction rolls
-- the trigger insert back with the business mutation.
create or replace function public.audit_business_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid; action_name text; client_id uuid; yid uuid; visit_id uuid; cert_id uuid;
begin
  target := coalesce(new.id, old.id);
  action_name := lower(tg_table_name) || '_' || lower(tg_op);
  if tg_table_name = 'solicitudes_servicio' then
    client_id := coalesce(new.cliente_cuenta_id, old.cliente_cuenta_id); yid := coalesce(new.yacimiento_id, old.yacimiento_id);
  elsif tg_table_name = 'visitas_servicio' then
    visit_id := target; yid := coalesce(new.yacimiento_id, old.yacimiento_id);
  elsif tg_table_name = 'ordenes_trabajo' then
    visit_id := coalesce(new.visita_id, old.visita_id);
  elsif tg_table_name = 'certificados' then
    cert_id := target; visit_id := coalesce(new.visita_id, old.visita_id); yid := coalesce(new.yacimiento_id, old.yacimiento_id);
  end if;
  if yid is not null and client_id is null then select cliente_cuenta_id into client_id from public.yacimientos where id=yid; end if;
  perform public.record_audit_event(action_name, replace(tg_table_name, '_', '_'), target, 'exitoso',
    jsonb_build_object('operacion', tg_op, 'tabla', tg_table_name), '{}'::jsonb, null, null, client_id, yid, visit_id, cert_id);
  return coalesce(new, old);
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['solicitudes_servicio','ordenes_trabajo','certificados','cuentas','talleres_moviles','personas','catalogo_opciones','patrones_ensayo'] loop
    execute format('drop trigger if exists %I_audit_change on public.%I', table_name, table_name);
    execute format('create trigger %I_audit_change after insert or update or delete on public.%I for each row execute function public.audit_business_change()', table_name, table_name);
  end loop;
end;
$$;

create or replace function public.api_audit_require_admin()
returns public.rol language plpgsql stable security definer set search_path = public as $$
declare actor_role public.rol;
begin
  select rol into actor_role from public.cuentas where id = auth.uid() and activo;
  if actor_role not in ('administrador_regular', 'super_administrador') then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can read audit data';
  end if;
  return actor_role;
end;
$$;

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
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(x) order by x.recibida_en desc, x.id desc), '[]'::jsonb),
    'total', coalesce(max(x.total_count), 0), 'limit', limit_count, 'offset', offset_count,
    'has_more', coalesce(max(x.total_count), 0) > offset_count + limit_count
  ) into result
  from (
    select a.*, c.rol as actor_rol,
      coalesce(u.email, '') as actor_email,
      y.nombre as yacimiento_nombre,
      count(*) over () as total_count
    from public.registros_auditoria a
    left join public.cuentas c on c.id = a.actor_cuenta_id
    left join auth.users u on u.id = a.actor_cuenta_id
    left join public.yacimientos y on y.id = a.yacimiento_id
    where (actor_role = 'super_administrador' or a.tipo_objetivo in ('solicitud_servicio','visita_servicio','orden_trabajo','certificado'))
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
  if actor_role <> 'super_administrador' and target_type not in ('solicitud_servicio','visita_servicio','orden_trabajo','certificado') then
    raise exception using errcode = 'insufficient_privilege', message = 'Audit event is outside the operational scope';
  end if;
  return (select to_jsonb(a) from public.registros_auditoria a where a.id = event_id);
end;
$$;

create or replace function public.api_audit_export(
  from_date date default null, to_date date default null, actor_filter uuid default null,
  action_filter text default null, target_type_filter text default null, outcome_filter text default null,
  client_filter uuid default null, yacimiento_filter uuid default null, visit_filter uuid default null,
  certificate_filter uuid default null, limit_count integer default 100, offset_count integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if (select rol from public.cuentas where id=auth.uid() and activo) <> 'super_administrador' then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the Súper Administrador can export audit data';
  end if;
  perform public.record_audit_event('auditoria_exportada', 'registro_auditoria', null, 'exitoso', jsonb_build_object('from', from_date, 'to', to_date), jsonb_build_object('limit', limit_count, 'offset', offset_count));
  return public.api_audit_events(from_date, to_date, actor_filter, action_filter, target_type_filter, outcome_filter, client_filter, yacimiento_filter, visit_filter, certificate_filter, limit_count, offset_count);
end;
$$;

create or replace function public.api_admin_metrics(period_from date, period_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.api_audit_require_admin();
  if period_from is null or period_to is null or period_from > period_to then raise exception using errcode = 'invalid_parameter_value', message = 'Invalid period'; end if;
  select jsonb_build_object(
    'from', period_from, 'to', period_to,
    'finalized_certificates', (select count(*) from public.certificados c where c.estado = 'finalizado' and c.finalized_at >= period_from::timestamptz and c.finalized_at < (period_to + 1)::timestamptz),
    'completed_visits', (select count(*) from public.visitas_servicio v where v.estado = 'completada' and v.updated_at >= period_from::timestamptz and v.updated_at < (period_to + 1)::timestamptz),
    'pending_certificates', (select count(*) from public.certificados c where c.estado = 'pendiente'),
    'expiring_certificates', (select count(*) from public.certificados c where c.estado = 'finalizado' and c.vigencia_hasta >= current_date and c.vigencia_hasta <= current_date + 30),
    'unassigned_visits', (select count(*) from public.visitas_servicio v where v.taller_movil_id is null and v.estado not in ('cancelada','completada') and v.starts_at >= period_from::timestamptz and v.starts_at < (period_to + 1)::timestamptz)
  ) into result;
  return result;
end;
$$;

create or replace function public.api_admin_certificate_history(
  client_filter uuid default null, yacimiento_filter uuid default null, plant_filter uuid default null,
  valve_filter uuid default null, state_filter text default null, valid_until_filter date default null,
  search_text text default null, limit_count integer default 100, offset_count integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.api_audit_require_admin();
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb), 'total', coalesce(max(x.total_count), 0), 'limit', limit_count, 'offset', offset_count) into result
  from (select c.*, y.cliente_cuenta_id, y.nombre as yacimiento_nombre, p.nombre as planta_nombre, v.nombre as valvula_nombre,
    count(*) over () as total_count
    from public.certificados c join public.yacimientos y on y.id=c.yacimiento_id join public.plantas_locaciones p on p.id=c.planta_id join public.valvulas v on v.id=c.valvula_id
    where (client_filter is null or y.cliente_cuenta_id=client_filter) and (yacimiento_filter is null or c.yacimiento_id=yacimiento_filter)
      and (plant_filter is null or c.planta_id=plant_filter) and (valve_filter is null or c.valvula_id=valve_filter)
      and (state_filter is null or c.estado::text=state_filter) and (valid_until_filter is null or c.vigencia_hasta=valid_until_filter)
      and (search_text is null or c.id::text ilike '%' || search_text || '%' or v.nombre ilike '%' || search_text || '%' or y.nombre ilike '%' || search_text || '%')
    order by c.created_at desc, c.id desc limit limit_count offset offset_count) x;
  return coalesce(result, jsonb_build_object('items','[]'::jsonb,'total',0,'limit',limit_count,'offset',offset_count));
end;
$$;

create or replace function public.api_admin_certificate(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; valve_id uuid;
begin
  perform public.api_audit_require_admin();
  select c.valvula_id into valve_id from public.certificados c where c.id=certificate_id;
  if valve_id is null then raise exception using errcode='no_data_found', message='Certificate not found'; end if;
  select jsonb_build_object('certificate', to_jsonb(c), 'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at, h.id) from public.certificados h where h.valvula_id=valve_id),'[]'::jsonb), 'audit_events', coalesce((select jsonb_agg(to_jsonb(a) order by a.recibida_en desc, a.id desc) from public.registros_auditoria a where a.certificado_id=certificate_id),'[]'::jsonb)) into result from public.certificados c where c.id=certificate_id;
  return result;
end;
$$;

create or replace function public.api_admin_certificate_export(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_audit_require_admin();
  perform public.record_audit_event('certificado_descargado', 'certificado', certificate_id, 'exitoso', '{}'::jsonb, '{}'::jsonb, null, null, null, null, null, certificate_id);
  return public.api_admin_certificate(certificate_id);
end;
$$;

revoke all on function public.record_audit_event(text,text,uuid,text,jsonb,jsonb,timestamptz,text,uuid,uuid,uuid,uuid), public.api_audit_events(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer), public.api_audit_event(uuid), public.api_audit_export(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer), public.api_admin_metrics(date,date), public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,date,text,integer,integer), public.api_admin_certificate(uuid), public.api_admin_certificate_export(uuid) from public, anon, authenticated;
grant execute on function public.record_audit_event(text,text,uuid,text,jsonb,jsonb,timestamptz,text,uuid,uuid,uuid,uuid), public.api_audit_events(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer), public.api_audit_event(uuid), public.api_audit_export(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer), public.api_admin_metrics(date,date), public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,date,text,integer,integer), public.api_admin_certificate(uuid), public.api_admin_certificate_export(uuid) to service_role;

commit;

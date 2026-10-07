begin;

select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009901', 'audit-admin@example.test'),
  ('00000000-0000-0000-0000-000000009902', 'audit-super@example.test'),
  ('00000000-0000-0000-0000-000000009903', 'audit-client@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000009901', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000009902', 'super_administrador'),
  ('00000000-0000-0000-0000-000000009903', 'cliente');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000009903', 'Audit Client');
alter table public.solicitudes_servicio disable trigger user;
alter table public.visitas_servicio disable trigger user;
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000009913', '00000000-0000-0000-0000-000000009903', 'Audit Deposit', 'Neuquen', 'Audit Operator', 'Audit Contractor');
insert into public.solicitudes_servicio (id, cliente_cuenta_id, yacimiento_id) values
  ('00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009903', '00000000-0000-0000-0000-000000009913');
insert into public.visitas_servicio (id, solicitud_id, yacimiento_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009913', '2099-01-10 09:00:00Z', '2099-01-10 10:00:00Z');
alter table public.solicitudes_servicio enable trigger user;
alter table public.visitas_servicio enable trigger user;

create function public.test_audit_base_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object(
    'x-systemsolutions-actor-id', target,
    'x-systemsolutions-correlation-id', 'audit-test-correlation'
  )::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_audit_base_set_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_audit_base_set_actor('00000000-0000-0000-0000-000000009902');

select public.record_audit_event(
  'visita_completada', 'visita_servicio', '00000000-0000-0000-0000-000000009911',
  'exitoso', '{"estado_nuevo":"completada"}', '{"solicitud_id":"00000000-0000-0000-0000-000000009912"}',
  '2026-10-06T10:00:00Z', null, '00000000-0000-0000-0000-000000009903',
  '00000000-0000-0000-0000-000000009913', '00000000-0000-0000-0000-000000009911', null
);
select public.record_audit_event(
  'sensitive_export_denied', 'backup_manual', null, 'fallido',
  '{"reason":"insufficient_role"}', '{"scope":"complete"}'
);
select public.record_audit_event(
  'catalogo_actualizado', 'configuracion', '00000000-0000-0000-0000-000000009914', 'exitoso'
);
select public.record_audit_event(
  'conflicto_sync_resuelto', 'conflicto_sincronizacion', '00000000-0000-0000-0000-000000009916', 'exitoso'
);

select is(
  jsonb_array_length(public.api_audit_events(visit_filter => '00000000-0000-0000-0000-000000009911'::uuid)->'items'),
  1,
  'visit filter returns the matching operational event'
);
select is(
  jsonb_array_length(public.api_audit_events(action_filter => 'visita_completada')->'items'),
  1,
  'action filter returns matching events'
);
select is(
  jsonb_array_length(public.api_audit_events(target_type_filter => 'visita_servicio')->'items'),
  1,
  'target-type filter returns matching events'
);
select is(
  jsonb_array_length(public.api_audit_events(target_type_filter => 'conflicto_sincronizacion')->'items'),
  1,
  'regular Administrador can inspect operational synchronization-conflict resolution'
);
select is(
  jsonb_array_length(public.api_audit_events(outcome_filter => 'fallido')->'items'),
  0,
  'regular administrators do not see rejected events outside operational service categories'
);
select is(
  jsonb_array_length(public.api_audit_events(certificate_filter => '00000000-0000-0000-0000-000000009915'::uuid)->'items'),
  0,
  'certificate filter excludes unrelated events'
);
select is(
  jsonb_array_length(public.api_audit_events(actor_filter => '00000000-0000-0000-0000-000000009902'::uuid)->'items'),
  4,
  'actor filter selects the event actor'
);
select is(
  jsonb_array_length(public.api_audit_events(client_filter => '00000000-0000-0000-0000-000000009903'::uuid)->'items'),
  1,
  'Cliente filter selects the service event owner'
);
select is(
  jsonb_array_length(public.api_audit_events(yacimiento_filter => '00000000-0000-0000-0000-000000009913'::uuid)->'items'),
  1,
  'Yacimiento filter selects the service event scope'
);
select is(
  jsonb_array_length(public.api_audit_events(from_date => current_date + 1, to_date => current_date + 1)->'items'),
  0,
  'date range filters by server receipt date'
);
select ok(
  (public.api_audit_event((select id from public.registros_auditoria where accion = 'visita_completada'))->'resumen_cambio') @> '{"estado_nuevo":"completada"}'::jsonb,
  'event detail preserves the structured change summary'
);
select ok(
  (public.api_audit_event((select id from public.registros_auditoria where accion = 'visita_completada'))->'identificadores_relacionados') @> '{"solicitud_id":"00000000-0000-0000-0000-000000009912"}'::jsonb,
  'event detail preserves related identifiers'
);
select ok(
  exists (select 1 from public.registros_auditoria where accion = 'visita_completada' and evento_dispositivo_en = '2026-10-06T10:00:00Z'::timestamptz and recibida_en is not null and identidad_correlacion = 'audit-test-correlation'),
  'event retains device time, authoritative server receipt time, and correlation identity'
);
select throws_ok(
  $$update public.registros_auditoria set resultado = 'fallido' where accion = 'visita_completada'$$,
  '42501', 'Registro de auditoría is append-only', 'audit events cannot be updated'
);
select throws_ok(
  $$delete from public.registros_auditoria where accion = 'visita_completada'$$,
  '42501', 'Registro de auditoría is append-only', 'audit events cannot be deleted'
);

select public.test_audit_base_set_actor('00000000-0000-0000-0000-000000009901');
select is(
  jsonb_array_length(public.api_audit_events()->'items'),
  2,
  'regular Administrador sees operational events but not configuration events'
);
select throws_ok(
  $$select public.api_audit_export()$$,
  '42501', 'Only the Súper Administrador can export audit data',
  'regular Administrador cannot export audit records'
);
select throws_ok(
  $$select public.api_audit_events(limit_count => 101)$$,
  '22023', 'Invalid pagination', 'pagination limits are bounded'
);
select set_config('app.audit_visible_count', jsonb_array_length(public.api_audit_events()->'items')::text, true);
select public.api_audit_events();
select is(
  jsonb_array_length(public.api_audit_events()->'items'),
  current_setting('app.audit_visible_count')::integer,
  'ordinary audit reads do not create additional audit records'
);

select public.test_audit_base_set_actor('00000000-0000-0000-0000-000000009902');
select is(
  jsonb_array_length(public.api_audit_events()->'items'),
  7,
  'Súper Administrador sees all event categories, including rejected attempts'
);
select is(
  public.api_audit_export(action_filter => 'visita_completada')->>'total',
  '1',
  'audit export returns all rows matching the active filters'
);
select is(
  public.api_audit_export(action_filter => 'visita_completada')->'items'->0->>'accion',
  'visita_completada',
  'audit export excludes events that do not match the requested action'
);
select ok(
  (public.api_audit_export(action_filter => 'visita_completada')->'items'->0) ?& array[
    'id', 'recibida_en', 'evento_dispositivo_en', 'actor_cuenta_id', 'actor_rol', 'actor_email',
    'accion', 'tipo_objetivo', 'objetivo_id', 'resultado', 'identidad_correlacion',
    'cliente_cuenta_id', 'yacimiento_id', 'yacimiento_nombre', 'visita_id', 'certificado_id',
    'resumen_cambio', 'identificadores_relacionados'
  ],
  'audit JSON export retains the full event and trace identifiers'
);
select is(
  (public.api_audit_events(outcome_filter => 'fallido')->'items'->0->>'resultado'),
  'fallido',
  'Súper Administrador can filter rejected sensitive attempts'
);
select throws_ok(
  $$select public.record_sensitive_rejection('ordinary_read', 'visita_servicio')$$,
  '22023', 'Unsupported rejected sensitive action', 'ordinary reads cannot be recorded as sensitive rejections'
);
select is(
  has_function_privilege('authenticated', 'public.record_sensitive_rejection(text,text,uuid,jsonb,jsonb,uuid,uuid,uuid,uuid)', 'execute'),
  false,
  'browser roles cannot insert rejected audit events directly'
);
select is(
  has_function_privilege('service_role', 'public.record_sensitive_rejection(text,text,uuid,jsonb,jsonb,uuid,uuid,uuid,uuid)', 'execute'),
  true,
  'Edge service role can record classified rejected sensitive attempts'
);
select public.record_sensitive_rejection('sensitive_export_denied', 'backup_manual', null, '{"denial_code":"42501"}', '{"scope":"complete"}');
select ok(
  exists (select 1 from public.registros_auditoria where accion = 'sensitive_export_denied' and resultado = 'fallido' and resumen_cambio->>'denial_code' = '42501'),
  'classified sensitive rejection is appended with a failed outcome'
);
update public.cuentas set activo = false where id = '00000000-0000-0000-0000-000000009903';
select ok(
  exists (select 1 from public.registros_auditoria where accion = 'cuenta_acceso_actualizado' and resultado = 'exitoso'),
  'account access changes receive a stable audit action'
);

select * from finish();
rollback;

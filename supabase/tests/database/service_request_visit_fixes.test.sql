begin;

select plan(43);

-- Fixtures: Clientes en distintos estados de cuenta, un Administrador y un Taller Móvil.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002101', 'fix-client-active@example.test'),
  ('00000000-0000-0000-0000-000000002102', 'fix-client-pending@example.test'),
  ('00000000-0000-0000-0000-000000002103', 'fix-client-disabled@example.test'),
  ('00000000-0000-0000-0000-000000002104', 'fix-client-inactive@example.test'),
  ('00000000-0000-0000-0000-000000002105', 'fix-admin@example.test'),
  ('00000000-0000-0000-0000-000000002106', 'fix-technician@example.test');

insert into public.cuentas (id, rol, estado) values
  ('00000000-0000-0000-0000-000000002101', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000002102', 'cliente', 'pendiente'),
  ('00000000-0000-0000-0000-000000002103', 'cliente', 'deshabilitada'),
  ('00000000-0000-0000-0000-000000002104', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000002105', 'administrador_regular', 'activa'),
  ('00000000-0000-0000-0000-000000002106', 'taller_movil', 'activa');

insert into public.clientes (cuenta_id, nombre, activo) values
  ('00000000-0000-0000-0000-000000002101', 'Fix Cliente activo', true),
  ('00000000-0000-0000-0000-000000002102', 'Fix Cliente invitado', true),
  ('00000000-0000-0000-0000-000000002103', 'Fix Cliente deshabilitado', true),
  ('00000000-0000-0000-0000-000000002104', 'Fix Cliente inactivo', false);

insert into public.talleres_moviles (id, nombre)
values ('00000000-0000-0000-0000-000000002110', 'Fix Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000002110', '00000000-0000-0000-0000-000000002106');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000002111', '00000000-0000-0000-0000-000000002101', 'Fix Yacimiento 1', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000002112', '00000000-0000-0000-0000-000000002102', 'Fix Yacimiento 2', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000002113', '00000000-0000-0000-0000-000000002103', 'Fix Yacimiento 3', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000002114', '00000000-0000-0000-0000-000000002104', 'Fix Yacimiento 4', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000002121', '00000000-0000-0000-0000-000000002111', 'Fix Planta 1'),
  ('00000000-0000-0000-0000-000000002122', '00000000-0000-0000-0000-000000002112', 'Fix Planta 2'),
  ('00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002113', 'Fix Planta 3'),
  ('00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002114', 'Fix Planta 4');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000002131', '00000000-0000-0000-0000-000000002121', 'Fix Equipo 1'),
  ('00000000-0000-0000-0000-000000002132', '00000000-0000-0000-0000-000000002122', 'Fix Equipo 2'),
  ('00000000-0000-0000-0000-000000002133', '00000000-0000-0000-0000-000000002123', 'Fix Equipo 3'),
  ('00000000-0000-0000-0000-000000002134', '00000000-0000-0000-0000-000000002124', 'Fix Equipo 4');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000002141', '00000000-0000-0000-0000-000000002131', 'V-FIX-1'),
  ('00000000-0000-0000-0000-000000002142', '00000000-0000-0000-0000-000000002131', 'V-FIX-2'),
  ('00000000-0000-0000-0000-000000002143', '00000000-0000-0000-0000-000000002132', 'V-FIX-3'),
  ('00000000-0000-0000-0000-000000002144', '00000000-0000-0000-0000-000000002133', 'V-FIX-4'),
  ('00000000-0000-0000-0000-000000002145', '00000000-0000-0000-0000-000000002134', 'V-FIX-5');

create function public.test_fixes_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_fixes_set_actor(uuid) to service_role;

-- Privilegios: solo el gateway de Edge (service_role) llama a los comandos.
select is(has_function_privilege('authenticated', 'public.api_admin_create_service_request_with_visit(uuid,uuid,jsonb,jsonb,uuid,timestamptz,timestamptz)', 'execute'), false, 'S4: browser roles cannot call the atomic creation directly');
select is(has_function_privilege('service_role', 'public.api_admin_create_service_request_with_visit(uuid,uuid,jsonb,jsonb,uuid,timestamptz,timestamptz)', 'execute'), true, 'S4: the Edge gateway can call the atomic creation');
select is(has_function_privilege('authenticated', 'public.api_admin_reopen_visit(uuid)', 'execute'), false, 'S6: browser roles cannot reopen a visit directly');
select is(has_function_privilege('service_role', 'public.api_admin_reopen_visit(uuid)', 'execute'), true, 'S6: the Edge gateway can reopen a visit');
select is(has_function_privilege('authenticated', 'public.api_admin_reschedule_visit(uuid,timestamptz,timestamptz,text)', 'execute'), false, 'S8b: browser roles cannot reschedule a visit directly');
select is(has_function_privilege('service_role', 'public.api_admin_reschedule_visit(uuid,timestamptz,timestamptz,text)', 'execute'), true, 'S8b: the Edge gateway can reschedule a visit');
select is(has_function_privilege('service_role', 'public.refresh_service_request_state(uuid)', 'execute'), false, 'the request state helper is internal');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002105');

-- S3: Cliente invitado (cuenta pendiente) sí; cuenta deshabilitada o Cliente inactivo no.
select ok((public.api_admin_create_service_request(
  '00000000-0000-0000-0000-000000002102'::uuid, '00000000-0000-0000-0000-000000002112'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002132"}]'::jsonb
)->'request'->>'id') is not null, 'S3: an invited Cliente pending activation can receive a request');
select throws_ok(
  $$select public.api_admin_create_service_request('00000000-0000-0000-0000-000000002103'::uuid, '00000000-0000-0000-0000-000000002113'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002133"}]'::jsonb)$$,
  '23503', 'Cliente not found', 'S3: a disabled Cliente account is still rejected');
select throws_ok(
  $$select public.api_admin_create_service_request('00000000-0000-0000-0000-000000002104'::uuid, '00000000-0000-0000-0000-000000002114'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002134"}]'::jsonb)$$,
  '23503', 'Cliente not found', 'S3: an inactive Cliente is still rejected');

-- S4: un fallo al programar revierte la solicitud y su metadata.
select throws_ok(
  $$select public.api_admin_create_service_request_with_visit('00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{"contacto":"Rollback"}'::jsonb, '00000000-0000-0000-0000-000000002199'::uuid, '2099-05-01 12:00:00+00'::timestamptz, '2099-05-01 13:00:00+00'::timestamptz)$$,
  '23503', 'Taller Móvil not found', 'S4: a scheduling failure raises the scheduling error');
select is((select count(*) from public.solicitudes_servicio where yacimiento_id = '00000000-0000-0000-0000-000000002111'), 0::bigint, 'S4: a scheduling failure leaves no orphan request');
select throws_ok(
  $$select public.api_admin_create_service_request_with_visit('00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{}'::jsonb, null, '2099-05-01 12:00:00+00'::timestamptz, '2099-05-01 13:00:00+00'::timestamptz)$$,
  '22023', 'A visit window requires a Taller Móvil', 'S4: a visit window without a Taller is rejected instead of dropped');
select is((public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{"contacto":"Sin taller"}'::jsonb,
  null, null, null
)->'scheduled_visit'), 'null'::jsonb, 'S4: without a Taller the request is created without a visit');

select set_config('app.fix_r1', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{"contacto":"Ana","horario":"09:00"}'::jsonb,
  '00000000-0000-0000-0000-000000002110'::uuid, '2099-05-02 12:00:00+00'::timestamptz, '2099-05-02 13:00:00+00'::timestamptz
)::text, true);
select set_config('app.fix_r1_id', current_setting('app.fix_r1')::jsonb->'request'->>'id', true);
select set_config('app.fix_v1', current_setting('app.fix_r1')::jsonb->'scheduled_visit'->'visit'->>'id', true);
select is(current_setting('app.fix_r1')::jsonb->'request'->'metadata'->>'contacto', 'Ana', 'S4: the metadata is saved in the same transaction');
select is(current_setting('app.fix_r1')::jsonb->'scheduled_visit'->'visit'->>'estado', 'programada', 'S4: the visit is scheduled in the same transaction');

-- S6 y S7: aceptar, cancelar (única visita) y reabrir.
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002106');
select is(public.api_accept_visit(current_setting('app.fix_v1')::uuid)->'visit'->>'estado', 'aceptada', 'S6 setup: the Taller Móvil accepts the visit');
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002105');
select is(public.api_admin_cancel_visit(current_setting('app.fix_v1')::uuid, 'El Cliente pidió cancelar')->'visit'->>'estado', 'cancelada', 'S6 setup: the Administrador cancels the accepted visit');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.fix_r1_id')::uuid), 'cancelada'::public.estado_solicitud, 'S7: cancelling the only visit still cancels the request');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.fix_r1_id')::uuid and estado = 'activa'), 0::bigint, 'S7: cancelling the only visit ends its assignment');
select is(public.api_admin_reopen_visit(current_setting('app.fix_v1')::uuid)->'visit'->>'estado', 'programada', 'S6: an accepted visit that was cancelled can be reopened');
select ok((select accepted_at is null from public.visitas_servicio where id = current_setting('app.fix_v1')::uuid), 'S6: the reopened visit no longer carries the earlier acceptance');
select ok((select estado = 'pendiente' and accepted_at is null and taller_movil_id is null from public.solicitudes_servicio where id = current_setting('app.fix_r1_id')::uuid), 'S6: the request returns to pendiente without the earlier acceptance');
select is((select count(*) from public.visita_equipos where visita_id = current_setting('app.fix_v1')::uuid), 1::bigint, 'S6: the equipment reservation is restored');
select lives_ok(
  $$select public.api_schedule_visit(current_setting('app.fix_r1_id')::uuid, '00000000-0000-0000-0000-000000002110'::uuid, '2099-05-03 12:00:00+00'::timestamptz, '2099-05-03 13:00:00+00'::timestamptz)$$,
  'S6: the reopened request can be scheduled again');

-- S6 sin taller y S8b: una visita sin taller reabierta queda programada y se puede reprogramar.
select set_config('app.fix_v2', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000002110'::uuid, '2099-05-10 12:00:00+00'::timestamptz, '2099-05-10 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select lives_ok($$select public.api_unassign_visit(current_setting('app.fix_v2')::uuid, 'Sin disponibilidad')$$, 'S8b setup: the visit is unassigned');
select lives_ok($$select public.api_admin_cancel_visit(current_setting('app.fix_v2')::uuid, 'Se suspende')$$, 'S6 setup: the unassigned visit is cancelled');
select is(public.api_admin_reopen_visit(current_setting('app.fix_v2')::uuid)->'visit'->>'estado', 'programada', 'S6: an unassigned visit is reopened as programada so it can be assigned');
select is((select taller_movil_id from public.visitas_servicio where id = current_setting('app.fix_v2')::uuid), null::uuid, 'S6: the reopened unassigned visit keeps no Taller');
select lives_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fix_v2')::uuid, '2099-05-11 12:00:00+00'::timestamptz, '2099-05-11 13:30:00+00'::timestamptz, null)$$,
  'S8b: a visit without a Taller can be rescheduled');
select ok((select starts_at = '2099-05-11 12:00:00+00'::timestamptz and ends_at = '2099-05-11 13:30:00+00'::timestamptz and estado = 'programada' and taller_movil_id is null from public.visitas_servicio where id = current_setting('app.fix_v2')::uuid), 'S8b: the visit keeps its state and (absent) Taller with the new window');
select is((select ventana from public.visita_equipos where visita_id = current_setting('app.fix_v2')::uuid), tstzrange('2099-05-11 12:00:00+00'::timestamptz, '2099-05-11 13:30:00+00'::timestamptz, '[)'), 'S8b: the equipment reservation moves with the visit');
select throws_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fix_v2')::uuid, '2099-05-11 12:00:00+00'::timestamptz, '2099-05-11 13:30:00+00'::timestamptz, null)$$,
  '23514', 'The schedule is unchanged', 'S8b: an unchanged schedule is rejected');
select throws_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fix_v2')::uuid, '2099-05-03 12:30:00+00'::timestamptz, '2099-05-03 13:30:00+00'::timestamptz, 'Choque')$$,
  '23P01', 'conflicting key value violates exclusion constraint "visita_equipos_no_simultaneous_equipment"',
  'S8b: a reschedule cannot overlap another visit of the same Equipo');
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.fix_v2')::uuid and accion = 'visita_reprogramada'
), 'S8b: the reschedule is recorded in the audit log');
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002106');
select throws_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fix_v2')::uuid, '2099-05-12 12:00:00+00'::timestamptz, '2099-05-12 13:00:00+00'::timestamptz, null)$$,
  '42501', 'Only an active Administrador can reschedule a visit', 'S8b: only an Administrador can reschedule');

-- S7: cancelar una visita de seguimiento no cancela la solicitud aceptada.
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002105');
select set_config('app.fix_r3', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000002101'::uuid, '00000000-0000-0000-0000-000000002111'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000002131"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000002110'::uuid, '2099-06-01 12:00:00+00'::timestamptz, '2099-06-01 13:00:00+00'::timestamptz
)::text, true);
select set_config('app.fix_r3_id', current_setting('app.fix_r3')::jsonb->'request'->>'id', true);
select set_config('app.fix_a', current_setting('app.fix_r3')::jsonb->'scheduled_visit'->'visit'->>'id', true);
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002106');
select public.api_accept_visit(current_setting('app.fix_a')::uuid);
select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002105');
update public.visitas_servicio set estado = 'completada' where id = current_setting('app.fix_a')::uuid;
delete from public.visita_equipos where visita_id = current_setting('app.fix_a')::uuid;
update public.ordenes_trabajo set estado = 'no_evaluada', no_evaluada_razon = 'Sin acceso al equipo'
where visita_id = current_setting('app.fix_a')::uuid and valvula_id = '00000000-0000-0000-0000-000000002141';
update public.ordenes_trabajo set estado = 'evaluada'
where visita_id = current_setting('app.fix_a')::uuid and valvula_id = '00000000-0000-0000-0000-000000002142';

select throws_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fix_a')::uuid, '2099-06-02 12:00:00+00'::timestamptz, '2099-06-02 13:00:00+00'::timestamptz, null)$$,
  '23514', 'Only a visit that has not started can be rescheduled', 'S8b: a completed visit cannot be rescheduled');

select set_config('app.fix_b', public.api_create_followup_visit(
  current_setting('app.fix_r3_id')::uuid, current_setting('app.fix_a')::uuid,
  array['00000000-0000-0000-0000-000000002141'::uuid], '00000000-0000-0000-0000-000000002110'::uuid,
  '2099-06-05 12:00:00+00'::timestamptz, '2099-06-05 13:00:00+00'::timestamptz
)->'visit'->>'id', true);
select is(public.api_admin_cancel_visit(current_setting('app.fix_b')::uuid, 'Ya no hace falta')->'visit'->>'estado', 'cancelada', 'S7 setup: the Administrador cancels the follow-up visit');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.fix_r3_id')::uuid), 'aceptada'::public.estado_solicitud, 'S7: cancelling a follow-up keeps the request accepted');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.fix_r3_id')::uuid and estado = 'activa'), 1::bigint, 'S7: cancelling a programada follow-up keeps the completed visit assignment');

select set_config('app.fix_b2', public.api_create_followup_visit(
  current_setting('app.fix_r3_id')::uuid, current_setting('app.fix_a')::uuid,
  array['00000000-0000-0000-0000-000000002141'::uuid], '00000000-0000-0000-0000-000000002110'::uuid,
  '2099-06-06 12:00:00+00'::timestamptz, '2099-06-06 13:00:00+00'::timestamptz
)->'visit'->>'id', true);
select ok(nullif(current_setting('app.fix_b2', true), '') is not null, 'S7: another follow-up can still be scheduled after a cancellation');

select public.test_fixes_set_actor('00000000-0000-0000-0000-000000002101');
select is(public.api_cancel_visit(current_setting('app.fix_b2')::uuid)->'visit'->>'estado', 'cancelada', 'S7 setup: the Cliente cancels the follow-up visit');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.fix_r3_id')::uuid), 'aceptada'::public.estado_solicitud, 'S7: a Cliente cancellation of a follow-up keeps the request accepted');

select * from extensions.finish(true);
rollback;

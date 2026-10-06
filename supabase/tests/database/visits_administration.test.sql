begin;

select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'visit-admin-client@example.test'),
  ('00000000-0000-0000-0000-000000001802', 'visit-admin@example.test'),
  ('00000000-0000-0000-0000-000000001810', 'visit-admin-tech@example.test'),
  ('00000000-0000-0000-0000-000000001809', 'visit-super-admin@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000001801', 'cliente'),
  ('00000000-0000-0000-0000-000000001802', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000001810', 'taller_movil'),
  ('00000000-0000-0000-0000-000000001809', 'super_administrador');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000001801', 'Visit Administration Cliente');
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000001803', 'Visit Administration Taller A'),
  ('00000000-0000-0000-0000-000000001804', 'Visit Administration Taller B');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000001803', '00000000-0000-0000-0000-000000001810');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000001805', '00000000-0000-0000-0000-000000001801', 'Visit Admin Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000001806', '00000000-0000-0000-0000-000000001805', 'Visit Admin Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000001807', '00000000-0000-0000-0000-000000001806', 'Visit Admin Equipo');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000001808', '00000000-0000-0000-0000-000000001807', 'Visit Admin Valvula');

create function public.test_visit_admin_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_visit_admin_set_actor(uuid) to service_role;

select has_function('public', 'api_schedule_visit', array['uuid', 'uuid', 'timestamptz', 'timestamptz']::text[], 'initial scheduling keeps its established RPC contract');
select is(to_regprocedure('public.api_schedule_visit(uuid,uuid,timestamp with time zone,timestamp with time zone,text)')::text, null, 'initial scheduling does not require an action reason');
select has_function('public', 'api_assign_visit', array['uuid', 'uuid', 'text', 'timestamptz', 'timestamptz']::text[], 'administrator assignment RPC exists');
select has_function('public', 'api_unassign_visit', array['uuid', 'text']::text[], 'administrator unassignment RPC exists');
select has_function('public', 'api_reassign_visit', array['uuid', 'uuid', 'text', 'timestamptz', 'timestamptz']::text[], 'administrator reassignment RPC exists');
select has_function('public', 'api_admin_cancel_visit', array['uuid', 'text']::text[], 'administrator cancellation RPC exists');
select is(has_function_privilege('authenticated', 'public.api_schedule_visit(uuid,uuid,timestamptz,timestamptz)', 'execute'), false, 'browser roles cannot call scheduling RPC');
select is(has_function_privilege('service_role', 'public.api_schedule_visit(uuid,uuid,timestamptz,timestamptz)', 'execute'), true, 'Edge service_role can call scheduling RPC');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001802');
select set_config('app.visit_admin_request_id', (public.api_admin_create_service_request(
  '00000000-0000-0000-0000-000000001801'::uuid,
  '00000000-0000-0000-0000-000000001805'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001807"}]'::jsonb
)->'request'->>'id'), true);

select set_config('app.visit_admin_id', (public.api_schedule_visit(
  current_setting('app.visit_admin_request_id')::uuid,
  '00000000-0000-0000-0000-000000001803'::uuid,
  '2099-03-10 09:00:00+00'::timestamptz,
  '2099-03-10 10:00:00+00'::timestamptz
)->'visit'->>'id'), true);
select is((public.api_visit(current_setting('app.visit_admin_id')::uuid)->'visit'->>'estado'), 'programada', 'an administrator schedules a pending request');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.visit_admin_id')::uuid), 1::bigint, 'the scheduled work item is created');
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.visit_admin_id')::uuid
    and accion = 'visita_programada'
), 'initial scheduling is recorded in the audit log without requiring a reason');

select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001810');
select is((public.api_accept_visit(current_setting('app.visit_admin_id')::uuid)->'visit'->>'estado'), 'aceptada', 'the assigned Taller Móvil can accept before execution');
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001802');

select throws_ok(
  $$select public.api_unassign_visit(current_setting('app.visit_admin_id')::uuid, '')$$,
  '22023', 'A reason is required to unassign a visit', 'unassignment rejects a blank reason'
);
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001801');
select throws_ok(
  $$select public.api_unassign_visit(current_setting('app.visit_admin_id')::uuid, 'Not an administrator')$$,
  '42501', 'Only an active Administrador can unassign a visit', 'a Cliente cannot unassign a visit'
);
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001802');
select is((public.api_unassign_visit(current_setting('app.visit_admin_id')::uuid, 'Cambio operativo')->'visit'->>'estado'), 'programada', 'unassignment keeps the visit scheduled');
select is((public.api_visit(current_setting('app.visit_admin_id')::uuid)->'visit'->>'taller_movil_id'), null, 'unassignment clears only the Taller Móvil');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.visit_admin_request_id')::uuid), 'pendiente', 'unassigning an accepted visit reopens its request for assignment');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.visit_admin_request_id')::uuid and estado = 'activa'), 0::bigint, 'unassigning an accepted visit ends its active Yacimiento access');
select is((select starts_at from public.visitas_servicio where id = current_setting('app.visit_admin_id')::uuid), '2099-03-10 09:00:00+00'::timestamptz, 'unassignment retains the scheduled start');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.visit_admin_id')::uuid), 1::bigint, 'unassignment retains the Orden de trabajo');
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.visit_admin_id')::uuid
    and accion = 'visita_desasignada'
    and resumen_cambio->>'reason' = 'Cambio operativo'
), 'unassignment stores its reason in the audit log');

select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001809');
select is((public.api_assign_visit(current_setting('app.visit_admin_id')::uuid, '00000000-0000-0000-0000-000000001804'::uuid, 'Cobertura disponible', null, null)->'visit'->>'taller_movil_id'), '00000000-0000-0000-0000-000000001804', 'a Super administrador assigns an unassigned visit');
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001802');
select is((public.api_reassign_visit(current_setting('app.visit_admin_id')::uuid, '00000000-0000-0000-0000-000000001803'::uuid, 'Cambio de cobertura', '2099-03-11 09:00:00+00'::timestamptz, '2099-03-11 10:00:00+00'::timestamptz)->'visit'->>'taller_movil_id'), '00000000-0000-0000-0000-000000001803', 'an administrator reassigns and reschedules a pre-work visit');
select is((select ends_at from public.visitas_servicio where id = current_setting('app.visit_admin_id')::uuid), '2099-03-11 10:00:00+00'::timestamptz, 'reassignment updates the scheduled window when requested');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.visit_admin_id')::uuid), 1::bigint, 'reassignment retains the Orden de trabajo');
select throws_ok(
  $$select public.api_reassign_visit(current_setting('app.visit_admin_id')::uuid, '00000000-0000-0000-0000-000000001803'::uuid, 'Same provider', null, null)$$,
  '23514', 'The assignment and schedule are unchanged', 'a no-op reassignment is rejected'
);

select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001810');
select is((public.api_accept_visit(current_setting('app.visit_admin_id')::uuid)->'visit'->>'estado'), 'aceptada', 'the reassigned Taller Móvil can accept the visit');
select public.test_visit_admin_set_actor('00000000-0000-0000-0000-000000001802');
select is((public.api_admin_cancel_visit(current_setting('app.visit_admin_id')::uuid, 'Cliente cambió la fecha')->'visit'->>'estado'), 'cancelada', 'an administrator cancels a visit before work starts');
select is((select count(*) from public.visita_equipos where visita_id = current_setting('app.visit_admin_id')::uuid), 0::bigint, 'cancellation releases the equipment claim');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.visit_admin_id')::uuid), 1::bigint, 'cancellation retains the work order history');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.visit_admin_request_id')::uuid), 'cancelada', 'administrator cancellation closes the service request');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.visit_admin_request_id')::uuid and estado = 'activa'), 0::bigint, 'administrator cancellation ends active Yacimiento access');
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.visit_admin_id')::uuid
    and accion = 'visita_cancelada_por_administrador'
    and resumen_cambio->>'reason' = 'Cliente cambió la fecha'
), 'administrator cancellation stores its reason in the audit log');
select throws_ok(
  $$select public.api_admin_cancel_visit(current_setting('app.visit_admin_id')::uuid, 'Repeated')$$,
  '23514', 'Only a visit that has not started can be cancelled by an Administrador', 'terminal cancellation cannot be repeated'
);

select * from extensions.finish(true);
rollback;

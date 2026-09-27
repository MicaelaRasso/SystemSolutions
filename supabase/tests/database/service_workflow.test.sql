begin;

select plan(47);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001101', 'workflow-client-a@example.test'),
  ('00000000-0000-0000-0000-000000001102', 'workflow-client-b@example.test'),
  ('00000000-0000-0000-0000-000000001103', 'workflow-tech-a@example.test'),
  ('00000000-0000-0000-0000-000000001104', 'workflow-tech-b@example.test'),
  ('00000000-0000-0000-0000-000000001105', 'workflow-admin@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000001101', 'cliente'),
  ('00000000-0000-0000-0000-000000001102', 'cliente'),
  ('00000000-0000-0000-0000-000000001103', 'taller_movil'),
  ('00000000-0000-0000-0000-000000001104', 'taller_movil'),
  ('00000000-0000-0000-0000-000000001105', 'administrador_regular');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000001101', 'Workflow Cliente A'),
  ('00000000-0000-0000-0000-000000001102', 'Workflow Cliente B');

insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000001201', 'Workflow Taller A'),
  ('00000000-0000-0000-0000-000000001202', 'Workflow Taller B');

insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000001201', '00000000-0000-0000-0000-000000001103'),
  ('00000000-0000-0000-0000-000000001202', '00000000-0000-0000-0000-000000001104');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000001301', '00000000-0000-0000-0000-000000001101', 'Workflow Yacimiento A1', 'Neuquen', 'Operadora A', 'Contratista A'),
  ('00000000-0000-0000-0000-000000001302', '00000000-0000-0000-0000-000000001101', 'Workflow Yacimiento A2', 'Mendoza', 'Operadora A', 'Contratista A'),
  ('00000000-0000-0000-0000-000000001303', '00000000-0000-0000-0000-000000001102', 'Workflow Yacimiento B', 'Salta', 'Operadora B', 'Contratista B');

insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000001301', 'Workflow Planta A1'),
  ('00000000-0000-0000-0000-000000001402', '00000000-0000-0000-0000-000000001302', 'Workflow Planta A2'),
  ('00000000-0000-0000-0000-000000001403', '00000000-0000-0000-0000-000000001303', 'Workflow Planta B');

insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000001501', '00000000-0000-0000-0000-000000001401', 'Workflow Equipo A1'),
  ('00000000-0000-0000-0000-000000001502', '00000000-0000-0000-0000-000000001401', 'Workflow Equipo A2'),
  ('00000000-0000-0000-0000-000000001503', '00000000-0000-0000-0000-000000001402', 'Workflow Equipo A3'),
  ('00000000-0000-0000-0000-000000001504', '00000000-0000-0000-0000-000000001402', 'Workflow Equipo A4'),
  ('00000000-0000-0000-0000-000000001505', '00000000-0000-0000-0000-000000001402', 'Workflow Equipo A5'),
  ('00000000-0000-0000-0000-000000001506', '00000000-0000-0000-0000-000000001403', 'Workflow Equipo B1');

insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000001601', '00000000-0000-0000-0000-000000001501', 'Workflow V111'),
  ('00000000-0000-0000-0000-000000001602', '00000000-0000-0000-0000-000000001501', 'Workflow V112'),
  ('00000000-0000-0000-0000-000000001603', '00000000-0000-0000-0000-000000001502', 'Workflow V121'),
  ('00000000-0000-0000-0000-000000001604', '00000000-0000-0000-0000-000000001503', 'Workflow V211'),
  ('00000000-0000-0000-0000-000000001605', '00000000-0000-0000-0000-000000001504', 'Workflow V221'),
  ('00000000-0000-0000-0000-000000001606', '00000000-0000-0000-0000-000000001505', 'Workflow V231'),
  ('00000000-0000-0000-0000-000000001607', '00000000-0000-0000-0000-000000001506', 'Workflow VB1');

create function public.test_workflow_set_actor(target uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.headers',
    jsonb_build_object('x-systemsolutions-actor-id', target)::text,
    true
  );
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_workflow_set_actor(uuid) to service_role;

select has_function('public', 'api_update_service_request', array['uuid', 'jsonb']::text[], 'request editing RPC exists');
select has_function('public', 'api_add_work_order', array['uuid', 'uuid']::text[], 'technician-added work-order RPC exists');
select is(has_function_privilege('authenticated', 'public.api_update_service_request(uuid,jsonb)', 'execute'), false, 'browser roles cannot call request mutation RPCs');
select is(has_function_privilege('service_role', 'public.api_update_service_request(uuid,jsonb)', 'execute'), true, 'Edge service_role can call request mutation RPCs');
select is(has_function_privilege('authenticated', 'public.api_add_work_order(uuid,uuid)', 'execute'), false, 'browser roles cannot call work-order mutation RPCs');
select is(has_function_privilege('service_role', 'public.api_add_work_order(uuid,uuid)', 'execute'), true, 'Edge service_role can call work-order mutation RPCs');
select is(has_function_privilege('authenticated', 'public.api_cancel_visit(uuid)', 'execute'), false, 'browser roles cannot call visit cancellation RPCs');
select is(has_function_privilege('service_role', 'public.api_cancel_visit(uuid)', 'execute'), true, 'Edge service_role can call visit cancellation RPCs');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');

select set_config(
  'app.workflow_request_id',
  (public.api_create_service_request(
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'equipo', 'id', '00000000-0000-0000-0000-000000001501'))
  )->'request'->>'id'),
  true
);
select is(
  jsonb_array_length(public.api_service_request(current_setting('app.workflow_request_id')::uuid)->'selected_valves'),
  2,
  'Equipo selection expands to its descendant Válvulas at solicitation time'
);

select set_config(
  'app.workflow_late_valve_id',
  (public.api_create_descendant('valvula', '00000000-0000-0000-0000-000000001501'::uuid, 'Workflow V113')->>'id'),
  true
);
select is(
  jsonb_array_length(public.api_service_request(current_setting('app.workflow_request_id')::uuid)->'selected_valves'),
  2,
  'later descendant Válvulas are not added to a frozen request selection'
);

select is(
  jsonb_array_length((public.api_update_service_request(
    current_setting('app.workflow_request_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('kind', 'valvula', 'id', '00000000-0000-0000-0000-000000001601'),
      jsonb_build_object('kind', 'valvula', 'id', '00000000-0000-0000-0000-000000001602')
    )
  ))->'selected_valves'),
  2,
  'the owning Cliente can edit a request before acceptance'
);
select ok(
  exists (
    select 1 from public.solicitud_valvulas
    where solicitud_id = current_setting('app.workflow_request_id')::uuid
      and valvula_id = '00000000-0000-0000-0000-000000001601'::uuid
  ),
  'edited request selections expose the next scheduling scope'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001102');
select throws_ok(
  $$select public.api_service_request(current_setting('app.workflow_request_id')::uuid)$$,
  '42501', 'Not authorized', 'another Cliente cannot read the request'
);
select throws_ok(
  $$select public.api_update_service_request(current_setting('app.workflow_request_id')::uuid, '[]'::jsonb)$$,
  '42501', 'Only the owning Cliente can edit a service request', 'another Cliente cannot edit the request'
);
select throws_ok(
  $$select public.api_create_service_request('00000000-0000-0000-0000-000000001301'::uuid, '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000001601"}]'::jsonb)$$,
  '42501', 'Only the owning Cliente can create a service request', 'another Cliente cannot create a request for the Yacimiento'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');
select lives_ok(
  $$select public.api_update_service_request(current_setting('app.workflow_request_id')::uuid, '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000001601"},{"kind":"valvula","id":"00000000-0000-0000-0000-000000001602"}]'::jsonb)$$,
  'the Cliente may still edit a scheduled but not accepted request'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select set_config(
  'app.workflow_primary_visit_id',
  (public.api_schedule_visit(
    current_setting('app.workflow_request_id')::uuid,
    '00000000-0000-0000-0000-000000001201'::uuid,
    '2099-01-10 09:00:00+00'::timestamptz,
    '2099-01-10 12:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);
select is(
  jsonb_array_length(public.api_visit(current_setting('app.workflow_primary_visit_id')::uuid)->'work_orders'),
  2,
  'a scheduled visit receives the selected Ordenes de trabajo'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001104');
select throws_ok(
  $$select public.api_accept_visit(current_setting('app.workflow_primary_visit_id')::uuid)$$,
  '42501', 'Only the assigned Taller Móvil can accept this visit', 'an unassigned Taller Móvil cannot accept the visit'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001103');
select is(
  (public.api_accept_visit(current_setting('app.workflow_primary_visit_id')::uuid)->'visit'->>'estado'),
  'aceptada',
  'the assigned Taller Móvil accepts the visit'
);
select throws_ok(
  $$select public.api_update_service_request(current_setting('app.workflow_request_id')::uuid, '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000001603"}]'::jsonb)$$,
  '23514', 'Accepted service requests cannot be edited', 'request editing closes when the Taller Móvil accepts'
);
select ok(
  exists (
    select 1 from public.asignaciones_servicio
    where yacimiento_id = '00000000-0000-0000-0000-000000001301'::uuid
      and taller_movil_id = '00000000-0000-0000-0000-000000001201'::uuid
      and estado = 'activa'
  ),
  'acceptance creates active Yacimiento access'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');
select set_config(
  'app.workflow_access_request_id',
  (public.api_create_service_request(
    '00000000-0000-0000-0000-000000001302'::uuid,
    '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001505"}]'::jsonb
  )->'request'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select set_config(
  'app.workflow_access_visit_id',
  (public.api_schedule_visit(
    current_setting('app.workflow_access_request_id')::uuid,
    '00000000-0000-0000-0000-000000001201'::uuid,
    '2099-01-11 09:00:00+00'::timestamptz,
    '2099-01-11 12:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001103');
select is(
  (public.api_accept_visit(current_setting('app.workflow_access_visit_id')::uuid)->'visit'->>'estado'),
  'aceptada',
  'a second Yacimiento of the same Cliente can receive access'
);

select throws_ok(
  $$select public.api_start_visit(current_setting('app.workflow_primary_visit_id')::uuid)$$,
  '42501', 'Only the assigned Taller Móvil can execute this visit', 'only the assigned Técnico can execute a visit'
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001103');
select is(
  (public.api_start_visit(current_setting('app.workflow_primary_visit_id')::uuid)->'visit'->>'estado'),
  'en_curso',
  'the assigned Taller Móvil starts the accepted visit'
);

select is(
  (public.api_add_work_order(
    current_setting('app.workflow_primary_visit_id')::uuid,
    '00000000-0000-0000-0000-000000001605'::uuid
  )->'work_order'->>'valvula_id'),
  '00000000-0000-0000-0000-000000001605',
  'a Técnico can add a same-Cliente Válvula from an accessible Yacimiento'
);
select is(
  (select count(*) from public.visita_equipos where visita_id = current_setting('app.workflow_primary_visit_id')::uuid),
  2::bigint,
  'a technician-added Válvula claims its Equipo for exclusivity'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');
select set_config(
  'app.workflow_competing_request_id',
  (public.api_create_service_request(
    '00000000-0000-0000-0000-000000001302'::uuid,
    '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000001604"}]'::jsonb
  )->'request'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select set_config(
  'app.workflow_competing_visit_id',
  (public.api_schedule_visit(
    current_setting('app.workflow_competing_request_id')::uuid,
    '00000000-0000-0000-0000-000000001201'::uuid,
    '2099-01-10 10:00:00+00'::timestamptz,
    '2099-01-10 11:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001103');
select throws_ok(
  $$select public.api_add_work_order(current_setting('app.workflow_primary_visit_id')::uuid, '00000000-0000-0000-0000-000000001604'::uuid)$$,
  '23P01', NULL, 'a technician-added Válvula cannot claim equipment held by a simultaneous visit'
);
select throws_ok(
  $$select public.api_add_work_order(current_setting('app.workflow_primary_visit_id')::uuid, '00000000-0000-0000-0000-000000001607'::uuid)$$,
  '42501', 'An added Válvula must belong to the same Cliente', 'a Técnico cannot add a Válvula belonging to another Cliente'
);

select is(
  (public.api_update_work_order(
    (select id from public.ordenes_trabajo where visita_id = current_setting('app.workflow_primary_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001601'::uuid),
    'evaluada'::public.estado_orden_trabajo,
    null
  )->'work_order'->>'estado'),
  'evaluada',
  'one work order can be marked evaluada independently'
);
select is(
  (public.api_update_work_order(
    (select id from public.ordenes_trabajo where visita_id = current_setting('app.workflow_primary_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001602'::uuid),
    'no_evaluada'::public.estado_orden_trabajo,
    'Válvula inaccesible'
  )->'work_order'->>'estado'),
  'no_evaluada',
  'another work order can be marked no evaluada with a reason'
);
select is(
  (select no_evaluada_razon from public.ordenes_trabajo where visita_id = current_setting('app.workflow_primary_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001602'::uuid),
  'Válvula inaccesible',
  'the no evaluada reason is preserved on its work order'
);

select set_config(
  'app.workflow_certificate_id',
  (public.api_start_certificate_draft(
    (select id from public.ordenes_trabajo where visita_id = current_setting('app.workflow_primary_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001601'::uuid)
  )->'certificate'->>'id'),
  true
);
select is(
  (select count(*) from public.certificados where visita_id = current_setting('app.workflow_primary_visit_id')::uuid),
  1::bigint,
  'an unevaluated Válvula creates no certificate'
);
select lives_ok(
  $$select public.api_submit_visit_signature(current_setting('app.workflow_primary_visit_id')::uuid, 'tecnico'::public.parte_firma_visita, 'Tecnico A', 'certificates', 'workflow/primary-tech.png')$$,
  'a Técnico signature authorizes visit completion'
);
select is(
  (public.api_complete_visit(current_setting('app.workflow_primary_visit_id')::uuid)->'visit'->>'estado'),
  'completada',
  'the Taller Móvil can complete the visit'
);
select is(
  (select estado_captura from public.certificados where id = current_setting('app.workflow_certificate_id')::uuid),
  'cerrado'::public.estado_captura_certificado,
  'backend completion closes eligible certificate capture'
);
select throws_ok(
  $$select public.api_update_certificate_draft(current_setting('app.workflow_certificate_id')::uuid, '{"observaciones":"late"}'::jsonb)$$,
  '23514', 'Certificate capture is closed', 'completed visits reject later certificate draft edits'
);
select ok(
  exists (
    select 1 from public.asignaciones_servicio
    where yacimiento_id = '00000000-0000-0000-0000-000000001301'::uuid
      and taller_movil_id = '00000000-0000-0000-0000-000000001201'::uuid
      and estado = 'activa'
  ),
  'completing a visit does not end active Yacimiento/Taller access'
);
select lives_ok(
  $$select public.api_yacimiento_tree('00000000-0000-0000-0000-000000001301'::uuid)$$,
  'the Taller Móvil keeps Yacimiento access after visit completion'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');
select is(
  (public.api_cancel_visit(current_setting('app.workflow_access_visit_id')::uuid)->'visit'->>'estado'),
  'cancelada',
  'the owning Cliente can cancel before the execution day'
);
select ok(
  exists (
    select 1 from public.asignaciones_servicio
    where yacimiento_id = '00000000-0000-0000-0000-000000001302'::uuid
      and taller_movil_id = '00000000-0000-0000-0000-000000001201'::uuid
      and estado = 'activa'
  ),
  'cancelling a visit does not end active Yacimiento/Taller access'
);

select set_config(
  'app.workflow_rejection_request_id',
  (public.api_create_service_request(
    '00000000-0000-0000-0000-000000001301'::uuid,
    '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000001603"}]'::jsonb
  )->'request'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select set_config(
  'app.workflow_rejection_visit_id',
  (public.api_schedule_visit(
    current_setting('app.workflow_rejection_request_id')::uuid,
    '00000000-0000-0000-0000-000000001202'::uuid,
    '2099-01-20 09:00:00+00'::timestamptz,
    '2099-01-20 12:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001104');
select is(
  (public.api_reject_visit(current_setting('app.workflow_rejection_visit_id')::uuid)->'visit'->>'estado'),
  'programada',
  'Taller Móvil rejection returns the visit to programada'
);
select is(
  (select taller_movil_id from public.visitas_servicio where id = current_setting('app.workflow_rejection_visit_id')::uuid),
  null,
  'rejection clears the previous provider for reassignment'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select is(
  (public.api_schedule_visit(
    current_setting('app.workflow_rejection_request_id')::uuid,
    '00000000-0000-0000-0000-000000001201'::uuid,
    '2099-01-21 09:00:00+00'::timestamptz,
    '2099-01-21 12:00:00+00'::timestamptz
  )->'visit'->>'rejected_at'),
  null,
  'administrator reassignment clears the old rejection marker'
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001103');
select is(
  (public.api_accept_visit(current_setting('app.workflow_rejection_visit_id')::uuid)->'visit'->>'estado'),
  'aceptada',
  'the reassigned Taller Móvil can accept the visit'
);

select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001101');
select set_config(
  'app.workflow_parallel_request_a',
  (public.api_create_service_request('00000000-0000-0000-0000-000000001301'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001501"}]'::jsonb)->'request'->>'id'),
  true
);
select set_config(
  'app.workflow_parallel_request_b',
  (public.api_create_service_request('00000000-0000-0000-0000-000000001301'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001502"}]'::jsonb)->'request'->>'id'),
  true
);
select set_config(
  'app.workflow_parallel_request_conflict',
  (public.api_create_service_request('00000000-0000-0000-0000-000000001301'::uuid, '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001501"}]'::jsonb)->'request'->>'id'),
  true
);
select public.test_workflow_set_actor('00000000-0000-0000-0000-000000001105');
select lives_ok(
  $$select public.api_schedule_visit(current_setting('app.workflow_parallel_request_a')::uuid, '00000000-0000-0000-0000-000000001201'::uuid, '2099-02-01 09:00:00+00'::timestamptz, '2099-02-01 10:00:00+00'::timestamptz)$$,
  'simultaneous visits may share a Yacimiento'
);
select lives_ok(
  $$select public.api_schedule_visit(current_setting('app.workflow_parallel_request_b')::uuid, '00000000-0000-0000-0000-000000001202'::uuid, '2099-02-01 09:00:00+00'::timestamptz, '2099-02-01 10:00:00+00'::timestamptz)$$,
  'simultaneous visits may share a Planta when their Equipos differ'
);
select throws_ok(
  $$select public.api_schedule_visit(current_setting('app.workflow_parallel_request_conflict')::uuid, '00000000-0000-0000-0000-000000001202'::uuid, '2099-02-01 09:30:00+00'::timestamptz, '2099-02-01 10:30:00+00'::timestamptz)$$,
  '23P01', NULL, 'the same Equipo cannot belong to overlapping simultaneous visits'
);

select * from extensions.finish(true);

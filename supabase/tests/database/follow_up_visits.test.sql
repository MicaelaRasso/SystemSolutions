begin;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001901', 'follow-up-client@example.test'),
  ('00000000-0000-0000-0000-000000001902', 'follow-up-admin@example.test'),
  ('00000000-0000-0000-0000-000000001903', 'follow-up-technician@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000001901', 'cliente'),
  ('00000000-0000-0000-0000-000000001902', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000001903', 'taller_movil');

insert into public.clientes (cuenta_id, nombre)
values ('00000000-0000-0000-0000-000000001901', 'Follow-up Cliente');
insert into public.talleres_moviles (id, nombre)
values ('00000000-0000-0000-0000-000000001904', 'Follow-up Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000001904', '00000000-0000-0000-0000-000000001903');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
values ('00000000-0000-0000-0000-000000001905', '00000000-0000-0000-0000-000000001901', 'Follow-up Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre)
values ('00000000-0000-0000-0000-000000001906', '00000000-0000-0000-0000-000000001905', 'Follow-up Planta');
insert into public.equipos_unidades (id, planta_id, nombre)
values ('00000000-0000-0000-0000-000000001907', '00000000-0000-0000-0000-000000001906', 'Follow-up Equipo');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000001908', '00000000-0000-0000-0000-000000001907', 'V-FOLLOW-1'),
  ('00000000-0000-0000-0000-000000001909', '00000000-0000-0000-0000-000000001907', 'V-FOLLOW-2');

create function public.test_follow_up_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_follow_up_set_actor(uuid) to service_role;

select is(has_function('public', 'api_create_followup_visit', array['uuid', 'uuid', 'uuid[]', 'uuid', 'timestamptz', 'timestamptz']::text[]), true, 'the follow-up visit command exists');
select is(has_function_privilege('authenticated', 'public.api_create_followup_visit(uuid,uuid,uuid[],uuid,timestamptz,timestamptz)', 'execute'), false, 'browser roles cannot call the command directly');
select is(has_function_privilege('service_role', 'public.api_create_followup_visit(uuid,uuid,uuid[],uuid,timestamptz,timestamptz)', 'execute'), true, 'the Edge gateway can call the command');
select is((select count(*) from pg_constraint where conrelid = 'public.visitas_servicio'::regclass and conname = 'visitas_servicio_solicitud_id_key'), 0::bigint, 'a Solicitud may have multiple Visitas');
select is((select count(*) from pg_constraint where conrelid = 'public.asignaciones_servicio'::regclass and conname = 'asignaciones_servicio_solicitud_id_key'), 0::bigint, 'a Solicitud may retain multiple assignment history rows');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_follow_up_set_actor('00000000-0000-0000-0000-000000001902');

select set_config('app.follow_up_request_id', (public.api_admin_create_service_request(
  '00000000-0000-0000-0000-000000001901'::uuid,
  '00000000-0000-0000-0000-000000001905'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000001907"}]'::jsonb
)->'request'->>'id'), true);
select set_config('app.follow_up_source_visit_id', (public.api_schedule_visit(
  current_setting('app.follow_up_request_id')::uuid,
  '00000000-0000-0000-0000-000000001904'::uuid,
  '2099-03-10 09:00:00+00'::timestamptz,
  '2099-03-10 10:00:00+00'::timestamptz
)->'visit'->>'id'), true);

update public.visitas_servicio set estado = 'aceptada', accepted_at = now()
where id = current_setting('app.follow_up_source_visit_id')::uuid;
insert into public.asignaciones_servicio(yacimiento_id, taller_movil_id, solicitud_id)
values ('00000000-0000-0000-0000-000000001905', '00000000-0000-0000-0000-000000001904', current_setting('app.follow_up_request_id')::uuid);
update public.solicitudes_servicio set estado = 'aceptada', accepted_at = now(), taller_movil_id = '00000000-0000-0000-0000-000000001904'
where id = current_setting('app.follow_up_request_id')::uuid;
update public.visitas_servicio set estado = 'completada'
where id = current_setting('app.follow_up_source_visit_id')::uuid;
delete from public.visita_equipos where visita_id = current_setting('app.follow_up_source_visit_id')::uuid;
update public.ordenes_trabajo set estado = 'no_evaluada', no_evaluada_razon = 'Sin tiempo en la jornada'
where visita_id = current_setting('app.follow_up_source_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001908';
update public.ordenes_trabajo set estado = 'evaluada'
where visita_id = current_setting('app.follow_up_source_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001909';

select set_config('app.follow_up_visit_id', (public.api_create_followup_visit(
  current_setting('app.follow_up_request_id')::uuid,
  current_setting('app.follow_up_source_visit_id')::uuid,
  array['00000000-0000-0000-0000-000000001908'::uuid],
  '00000000-0000-0000-0000-000000001904'::uuid,
  '2099-03-11 09:00:00+00'::timestamptz,
  '2099-03-11 10:00:00+00'::timestamptz
)->'visit'->>'id'), true);

select is((select solicitud_id from public.visitas_servicio where id = current_setting('app.follow_up_visit_id')::uuid), current_setting('app.follow_up_request_id')::uuid, 'the follow-up visit retains the original Solicitud');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.follow_up_visit_id')::uuid), 1::bigint, 'the new visit contains only the selected valve');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.follow_up_source_visit_id')::uuid), 2::bigint, 'the earlier work orders remain with the earlier visit');
select is((select estado from public.ordenes_trabajo where visita_id = current_setting('app.follow_up_source_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000001908'), 'no_evaluada', 'the earlier outcome is preserved');
select throws_ok(
  $$select public.api_create_followup_visit(current_setting('app.follow_up_request_id')::uuid, current_setting('app.follow_up_source_visit_id')::uuid, array['00000000-0000-0000-0000-000000001908'::uuid], '00000000-0000-0000-0000-000000001904'::uuid, '2099-03-12 09:00:00+00'::timestamptz, '2099-03-12 10:00:00+00'::timestamptz)$$,
  '23514', 'A Válvula is already assigned to another active visit in this Solicitud', 'an active follow-up cannot duplicate a valve');

select public.test_follow_up_set_actor('00000000-0000-0000-0000-000000001903');
select throws_ok(
  $$select public.api_create_followup_visit(current_setting('app.follow_up_request_id')::uuid, current_setting('app.follow_up_source_visit_id')::uuid, array['00000000-0000-0000-0000-000000001909'::uuid], '00000000-0000-0000-0000-000000001904'::uuid, '2099-03-12 09:00:00+00'::timestamptz, '2099-03-12 10:00:00+00'::timestamptz)$$,
  '42501', 'Only an active Administrador can create a follow-up visit', 'a Taller Móvil cannot create a follow-up visit');

select public.test_follow_up_set_actor('00000000-0000-0000-0000-000000001903');
select is((public.api_accept_visit(current_setting('app.follow_up_visit_id')::uuid)->'visit'->>'estado'), 'aceptada', 'the Taller Móvil accepts the follow-up visit through the normal workflow');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.follow_up_request_id')::uuid), 2::bigint, 'both visit assignment records remain in the history');
select is((select count(*) from public.asignaciones_servicio where solicitud_id = current_setting('app.follow_up_request_id')::uuid and estado = 'activa'), 1::bigint, 'the Yacimiento still has only one active assignment');
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.follow_up_visit_id')::uuid
    and accion = 'visita_seguimiento_programada'
    and resumen_cambio->>'solicitud_id' = current_setting('app.follow_up_request_id')
), 'follow-up scheduling is recorded in the audit log');

select * from extensions.finish(true);
rollback;

begin;

-- E1 (#94), decisión (e) corregida por la usuaria (2026-11-17): la visita tiene inicio y fin
-- estimado. La reserva del equipo es [inicio, fin estimado): el mismo equipo admite varias visitas
-- el mismo día si no se superponen. El fin estimado no cierra la visita. Un Taller Móvil atiende
-- una sola visita en curso a la vez (en línea y por el lote offline).
select plan(38);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e101', 'estimated-end-client@example.test'),
  ('00000000-0000-0000-0000-00000000e102', 'estimated-end-admin@example.test'),
  ('00000000-0000-0000-0000-00000000e103', 'estimated-end-tech@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-00000000e101', 'cliente'),
  ('00000000-0000-0000-0000-00000000e102', 'administrador_regular'),
  ('00000000-0000-0000-0000-00000000e103', 'taller_movil');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-00000000e101', 'Fin Estimado Cliente');
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-00000000e110', 'Fin Estimado Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-00000000e110', '00000000-0000-0000-0000-00000000e103');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-00000000e120', '00000000-0000-0000-0000-00000000e101', 'Fin Estimado Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-00000000e121', '00000000-0000-0000-0000-00000000e120', 'Fin Estimado Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-00000000e122', '00000000-0000-0000-0000-00000000e121', 'Fin Estimado Equipo'),
  ('00000000-0000-0000-0000-00000000e123', '00000000-0000-0000-0000-00000000e121', 'Fin Estimado Equipo Offline');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-00000000e131', '00000000-0000-0000-0000-00000000e122', 'V-FE-1'),
  ('00000000-0000-0000-0000-00000000e132', '00000000-0000-0000-0000-00000000e122', 'V-FE-2'),
  ('00000000-0000-0000-0000-00000000e133', '00000000-0000-0000-0000-00000000e122', 'V-FE-3'),
  ('00000000-0000-0000-0000-00000000e134', '00000000-0000-0000-0000-00000000e122', 'V-FE-4'),
  ('00000000-0000-0000-0000-00000000e135', '00000000-0000-0000-0000-00000000e123', 'V-FE-OFF-1'),
  ('00000000-0000-0000-0000-00000000e136', '00000000-0000-0000-0000-00000000e123', 'V-FE-OFF-2');

create function public.test_estimated_end_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_estimated_end_set_actor(uuid) to service_role;

create function public.test_estimated_end_request(valve uuid)
returns uuid language sql as $$
  select (public.api_admin_create_service_request(
    '00000000-0000-0000-0000-00000000e101'::uuid, '00000000-0000-0000-0000-00000000e120'::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', valve))
  )->'request'->>'id')::uuid
$$;
grant execute on function public.test_estimated_end_request(uuid) to service_role;

-- Programa la visita de una válvula con inicio y fin estimado; devuelve el id de la visita.
create function public.test_estimated_end_visit(valve uuid, visit_start timestamptz, visit_end timestamptz)
returns uuid language sql as $$
  select (public.api_schedule_visit(
    public.test_estimated_end_request(valve), '00000000-0000-0000-0000-00000000e110'::uuid,
    visit_start, visit_end
  )->'visit'->>'id')::uuid
$$;
grant execute on function public.test_estimated_end_visit(uuid, timestamptz, timestamptz) to service_role;

-- Modelo.
select col_not_null('public', 'visitas_servicio', 'ends_at', 'the estimated end is required');
select has_column('public', 'visitas_servicio', 'started_at', 'visits record when the Técnico started them');
select ok('requiere_finalizacion' = any(enum_range(null::public.estado_visita)::text[]), 'the requiere_finalizacion visit status exists');
select hasnt_function('public', 'visit_window', array['timestamptz']::text[], 'there is no whole-day reservation helper');
select hasnt_function('public', 'visit_schedule_range', array['timestamptz', 'timestamptz']::text[], 'range reads use the stored window');
select is(
  has_function_privilege('service_role', 'public.require_taller_without_visit_in_progress(uuid,uuid)', 'execute'),
  false,
  'the one-visit-in-progress guard is internal'
);
select throws_ok(
  $$insert into public.visitas_servicio(solicitud_id, yacimiento_id, starts_at, ends_at, estado)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000e120', '2099-03-10 12:00:00+00', '2099-03-10 12:00:00+00', 'programada')$$,
  '23514', null, 'the table rejects an estimated end that is not after the start'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_estimated_end_set_actor('00000000-0000-0000-0000-00000000e102');

-- Programar exige inicio y fin estimado posterior.
select set_config('app.fe_r0', public.test_estimated_end_request('00000000-0000-0000-0000-00000000e134')::text, true);
select throws_ok(
  $$select public.api_schedule_visit(current_setting('app.fe_r0')::uuid, '00000000-0000-0000-0000-00000000e110'::uuid, '2099-03-10 12:00:00+00'::timestamptz, null)$$,
  '22023', 'A visit requires a valid date and time window', 'a visit requires its estimated end'
);
select throws_ok(
  $$select public.api_schedule_visit(current_setting('app.fe_r0')::uuid, '00000000-0000-0000-0000-00000000e110'::uuid, '2099-03-10 12:00:00+00'::timestamptz, '2099-03-10 11:00:00+00'::timestamptz)$$,
  '22023', 'A visit requires a valid date and time window', 'the estimated end must be after the start'
);

-- V1: 09:00–10:00 AR del 10/3.
select set_config('app.fe_v1', public.test_estimated_end_visit(
  '00000000-0000-0000-0000-00000000e131', '2099-03-10 12:00:00+00', '2099-03-10 13:00:00+00')::text, true);
select is((select ends_at from public.visitas_servicio where id = current_setting('app.fe_v1')::uuid), '2099-03-10 13:00:00+00'::timestamptz, 'the estimated end is stored');
select is(
  (select ventana from public.visita_equipos where visita_id = current_setting('app.fe_v1')::uuid),
  tstzrange('2099-03-10 12:00:00+00'::timestamptz, '2099-03-10 13:00:00+00'::timestamptz, '[)'),
  'the Equipo is reserved between the start and the estimated end'
);

-- Mismo equipo, mismo día: sin superposición se puede; con superposición, no.
select set_config('app.fe_v2', public.test_estimated_end_visit(
  '00000000-0000-0000-0000-00000000e132', '2099-03-10 15:00:00+00', '2099-03-10 16:00:00+00')::text, true);
select ok(current_setting('app.fe_v2', true) <> '', 'a second visit of the same Equipo later the same day, without overlap, is scheduled');
select set_config('app.fe_r3', public.test_estimated_end_request('00000000-0000-0000-0000-00000000e133')::text, true);
select throws_ok(
  $$select public.api_schedule_visit(current_setting('app.fe_r3')::uuid, '00000000-0000-0000-0000-00000000e110'::uuid, '2099-03-10 12:30:00+00'::timestamptz, '2099-03-10 13:30:00+00'::timestamptz)$$,
  '23P01', 'conflicting key value violates exclusion constraint "visita_equipos_no_simultaneous_equipment"',
  'an overlapping visit of the same Equipo is rejected'
);
select set_config('app.fe_v3', (public.api_schedule_visit(
  current_setting('app.fe_r3')::uuid, '00000000-0000-0000-0000-00000000e110'::uuid,
  '2099-03-10 13:00:00+00'::timestamptz, '2099-03-10 15:00:00+00'::timestamptz
)->'visit'->>'id'), true);
select ok(current_setting('app.fe_v3', true) <> '', 'back-to-back visits of the same Equipo are allowed ([) windows)');

-- Reprogramar, reasignar y reabrir respetan la misma regla y conservan el fin estimado.
select throws_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fe_v2')::uuid, '2099-03-10 12:30:00+00'::timestamptz, '2099-03-10 13:30:00+00'::timestamptz, 'Superpuesta')$$,
  '23P01', 'conflicting key value violates exclusion constraint "visita_equipos_no_simultaneous_equipment"',
  'rescheduling onto an overlapping window of the same Equipo is rejected'
);
select lives_ok(
  $$select public.api_admin_reschedule_visit(current_setting('app.fe_v2')::uuid, '2099-03-10 18:00:00+00'::timestamptz, '2099-03-10 20:30:00+00'::timestamptz, 'Más tarde')$$,
  'rescheduling to a free window of the same day works'
);
select is(
  (select ventana from public.visita_equipos where visita_id = current_setting('app.fe_v2')::uuid),
  tstzrange('2099-03-10 18:00:00+00'::timestamptz, '2099-03-10 20:30:00+00'::timestamptz, '[)'),
  'rescheduling moves the reservation to the new window'
);
select lives_ok(
  $$select public.api_reassign_visit(current_setting('app.fe_v2')::uuid, '00000000-0000-0000-0000-00000000e110'::uuid, 'Cambio de hora', '2099-03-10 19:00:00+00'::timestamptz, '2099-03-10 21:00:00+00'::timestamptz)$$,
  'reassigning with a new window works'
);
select is(
  (select ends_at from public.visitas_servicio where id = current_setting('app.fe_v2')::uuid),
  '2099-03-10 21:00:00+00'::timestamptz,
  'reassigning keeps the new estimated end'
);
select lives_ok($$select public.api_admin_cancel_visit(current_setting('app.fe_v3')::uuid, 'Se suspende')$$, 'reopen setup: the visit is cancelled');
select is(
  (public.api_admin_reopen_visit(current_setting('app.fe_v3')::uuid)->'visit'->>'ends_at')::timestamptz,
  '2099-03-10 15:00:00+00'::timestamptz,
  'a reopened visit keeps its estimated end'
);

-- Iniciar registra started_at y no cambia la reserva. Un taller atiende una visita a la vez.
select public.test_estimated_end_set_actor('00000000-0000-0000-0000-00000000e103');
select public.api_accept_visit(current_setting('app.fe_v1')::uuid);
select public.api_accept_visit(current_setting('app.fe_v2')::uuid);
select public.api_start_visit(current_setting('app.fe_v1')::uuid);
select is((select started_at from public.visitas_servicio where id = current_setting('app.fe_v1')::uuid), now(), 'starting records started_at');
select is(
  (select ventana from public.visita_equipos where visita_id = current_setting('app.fe_v1')::uuid),
  tstzrange('2099-03-10 12:00:00+00'::timestamptz, '2099-03-10 13:00:00+00'::timestamptz, '[)'),
  'starting keeps the scheduled reservation'
);
select throws_ok(
  $$select public.api_start_visit(current_setting('app.fe_v2')::uuid)$$,
  '23514', 'The Taller Móvil already has a visit in progress; complete it before starting another',
  'the Taller cannot start a second visit while another one is in progress'
);
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fe_v2')::uuid), 'aceptada', 'the second visit stays accepted');

-- El fin estimado no cierra la visita: sigue en curso aunque haya pasado. (Fixture: la visita se
-- programó para la última hora y empezó hoy; el cierre automático solo mira el día de inicio.)
reset role;
update public.visitas_servicio set starts_at = now() - interval '61 minutes', ends_at = now() - interval '1 minute'
where id = current_setting('app.fe_v1')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(public.close_expired_visits(now()), 0, 'a visit past its estimated end but within its start day is not closed');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fe_v1')::uuid), 'en_curso', 'the visit stays in progress until the Técnico completes it');

-- Cuando la primera deja de estar en curso (cierre de las 23:59), la segunda puede iniciar.
reset role;
update public.visitas_servicio set started_at = now() - interval '1 day' where id = current_setting('app.fe_v1')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select ok(public.close_expired_visits() >= 1, 'the first visit expires at 23:59 of its start day');
select is(
  (public.api_start_visit(current_setting('app.fe_v2')::uuid)->'visit'->>'estado'),
  'en_curso',
  'a visit in requiere_finalizacion does not block the Taller'
);

-- Lote offline: un inicio que llega con otra visita en curso queda en conflicto para el
-- Administrador, que lo acepta cuando la otra ya no está en curso.
reset role;
update public.visitas_servicio set estado = 'cancelada' where id = current_setting('app.fe_v2')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_estimated_end_set_actor('00000000-0000-0000-0000-00000000e102');
select set_config('app.fe_w1', public.test_estimated_end_visit(
  '00000000-0000-0000-0000-00000000e135', now() + interval '1 hour', now() + interval '2 hours')::text, true);
select set_config('app.fe_w2', public.test_estimated_end_visit(
  '00000000-0000-0000-0000-00000000e136', now() + interval '3 hours', now() + interval '4 hours')::text, true);
select public.test_estimated_end_set_actor('00000000-0000-0000-0000-00000000e103');
select public.api_accept_visit(current_setting('app.fe_w1')::uuid);
select public.api_accept_visit(current_setting('app.fe_w2')::uuid);
select set_config('app.fe_ws', public.api_offline_working_set_for_device('00000000-0000-0000-0000-00000000e190'::uuid)::text, true);
select public.api_claim_visit_device(current_setting('app.fe_w1')::uuid, '00000000-0000-0000-0000-00000000e190'::uuid);
select public.api_claim_visit_device(current_setting('app.fe_w2')::uuid, '00000000-0000-0000-0000-00000000e190'::uuid);
select set_config('app.fe_version', (
  select entry#>>'{certificate_catalogs,replacement_catalog_version}'
  from jsonb_array_elements(current_setting('app.fe_ws')::jsonb->'visits') entry
  where entry#>>'{visit,id}' = current_setting('app.fe_w1')
), true);
select is(
  (public.api_start_visit_with_catalog(
    current_setting('app.fe_w1')::uuid, current_setting('app.fe_version')::uuid,
    '00000000-0000-0000-0000-00000000e190'::uuid
  )->'visit'->>'estado'),
  'en_curso',
  'the first visit starts with its downloaded catalog'
);
select set_config('app.fe_batch', public.api_sync_visit_batch(
  current_setting('app.fe_w2')::uuid,
  jsonb_build_array(jsonb_build_object(
    'operation_id', '00000000-0000-0000-0000-00000000e1a1',
    'kind', 'start_visit',
    'payload', jsonb_build_object(
      'device_id', '00000000-0000-0000-0000-00000000e190',
      'replacement_catalog_version_id', current_setting('app.fe_version')
    ),
    'schema_version', 2,
    'dependencies', '[]'::jsonb,
    'device_timestamp', now()
  )),
  '00000000-0000-0000-0000-00000000e190'::uuid
)::text, true);
select is(current_setting('app.fe_batch')::jsonb#>>'{operations,0,estado}', 'conflicto', 'an offline start while another visit is in progress becomes a conflict');
select is(
  (select reason from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000e1a1'),
  'The Taller Móvil already has a visit in progress; complete it before starting another',
  'the conflict keeps the reason for the Administrador'
);
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fe_w2')::uuid), 'aceptada', 'the conflicted start changes nothing');
select public.test_estimated_end_set_actor('00000000-0000-0000-0000-00000000e102');
select throws_ok(
  $$select public.api_resolve_sync_conflict(
    (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000e1a1'),
    'accept', 'El técnico ya terminó la otra')$$,
  '23514', 'The Taller Móvil already has a visit in progress; complete it before starting another',
  'the Administrador cannot accept the start while the other visit is still in progress'
);
reset role;
update public.visitas_servicio set started_at = now() - interval '1 day' where id = current_setting('app.fe_w1')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.close_expired_visits();
select is(
  (public.api_resolve_sync_conflict(
    (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000e1a1'),
    'accept', 'La otra visita ya se cerró')->>'resolution'),
  'accepted',
  'once the other visit is no longer in progress, the Administrador accepts the start'
);
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fe_w2')::uuid), 'en_curso', 'accepting the conflict starts the visit');

-- Lecturas por rango y el estado nuevo.
select is(
  (public.api_operations('2099-03-10'::date, '2099-03-10'::date, null, null, '00000000-0000-0000-0000-00000000e101'::uuid, null, 10, 0)->>'total')::integer,
  2,
  'visits are listed on the day of their window (V2 and V3; V1 was moved to today)'
);
select is(
  (public.api_operations(null, null, 'requiere_finalizacion', null, '00000000-0000-0000-0000-00000000e101'::uuid, null, 10, 0)->>'total')::integer,
  2,
  'operations can be filtered by requiere_finalizacion'
);

select * from extensions.finish(true);
rollback;

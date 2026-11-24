begin;

-- E2 (#95), decisión (e): el fin estimado no cierra la visita; a las 23:59 AR las visitas en curso
-- cuyo día de inicio terminó pasan a «Requiere finalización», liberan el equipo y dejan auditoría.
-- Las no iniciadas no cambian.
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e201', 'auto-close-client@example.test'),
  ('00000000-0000-0000-0000-00000000e202', 'auto-close-admin@example.test'),
  ('00000000-0000-0000-0000-00000000e203', 'auto-close-tech@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-00000000e201', 'cliente'),
  ('00000000-0000-0000-0000-00000000e202', 'administrador_regular'),
  ('00000000-0000-0000-0000-00000000e203', 'taller_movil');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-00000000e201', 'Cierre Automático Cliente');
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-00000000e210', 'Cierre Automático Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-00000000e210', '00000000-0000-0000-0000-00000000e203');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-00000000e220', '00000000-0000-0000-0000-00000000e201', 'Cierre Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-00000000e221', '00000000-0000-0000-0000-00000000e220', 'Cierre Planta');
-- Un equipo por visita: A (iniciada el 1/5), B (iniciada el 2/5), C (aceptada) y D (completada).
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-00000000e22a', '00000000-0000-0000-0000-00000000e221', 'Equipo A'),
  ('00000000-0000-0000-0000-00000000e22b', '00000000-0000-0000-0000-00000000e221', 'Equipo B'),
  ('00000000-0000-0000-0000-00000000e22c', '00000000-0000-0000-0000-00000000e221', 'Equipo C'),
  ('00000000-0000-0000-0000-00000000e22d', '00000000-0000-0000-0000-00000000e221', 'Equipo D');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-00000000e23a', '00000000-0000-0000-0000-00000000e22a', 'V-A'),
  ('00000000-0000-0000-0000-00000000e24a', '00000000-0000-0000-0000-00000000e22a', 'V-A2'),
  ('00000000-0000-0000-0000-00000000e23b', '00000000-0000-0000-0000-00000000e22b', 'V-B'),
  ('00000000-0000-0000-0000-00000000e23c', '00000000-0000-0000-0000-00000000e22c', 'V-C'),
  ('00000000-0000-0000-0000-00000000e23d', '00000000-0000-0000-0000-00000000e22d', 'V-D');

create function public.test_auto_close_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_auto_close_set_actor(uuid) to service_role;

-- Programa (inicio y fin estimado una hora después) y acepta una visita sobre una válvula.
create function public.test_auto_close_visit(valve uuid, visit_start timestamptz)
returns uuid language plpgsql as $$
declare request_id uuid; visit_id uuid;
begin
  perform public.test_auto_close_set_actor('00000000-0000-0000-0000-00000000e202');
  request_id := (public.api_admin_create_service_request(
    '00000000-0000-0000-0000-00000000e201'::uuid, '00000000-0000-0000-0000-00000000e220'::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', valve))
  )->'request'->>'id')::uuid;
  visit_id := (public.api_schedule_visit(
    request_id, '00000000-0000-0000-0000-00000000e210'::uuid, visit_start, visit_start + interval '1 hour'
  )->'visit'->>'id')::uuid;
  perform public.test_auto_close_set_actor('00000000-0000-0000-0000-00000000e203');
  perform public.api_accept_visit(visit_id);
  return visit_id;
end;
$$;
grant execute on function public.test_auto_close_visit(uuid, timestamptz) to service_role;

-- El job solo se verifica si pg_cron está habilitado (SQL dinámico: sin la extensión no hay `cron`).
create function public.test_auto_close_cron_job_ok()
returns boolean language plpgsql as $$
declare scheduled boolean;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    return true;
  end if;
  execute $q$select exists (
    select 1 from cron.job
    where jobname = 'cerrar-visitas-vencidas'
      and schedule = '59 2 * * *'
      and command = 'select public.close_expired_visits()'
  )$q$ into scheduled;
  return scheduled;
end;
$$;

select has_function('public', 'close_expired_visits', array['timestamptz']::text[], 'the automatic closing function exists');
select is(has_function_privilege('authenticated', 'public.close_expired_visits(timestamptz)', 'execute'), false, 'browser roles cannot close visits');
select is(has_function_privilege('service_role', 'public.schedule_close_expired_visits()', 'execute'), false, 'scheduling the job is not an Edge operation');
select ok(public.test_auto_close_cron_job_ok(), 'when pg_cron is enabled the job runs at 02:59 UTC (23:59 AR)');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('app.ac_a', public.test_auto_close_visit('00000000-0000-0000-0000-00000000e23a', '2099-05-01 12:00:00+00')::text, true);
select set_config('app.ac_b', public.test_auto_close_visit('00000000-0000-0000-0000-00000000e23b', '2099-05-02 12:00:00+00')::text, true);
select set_config('app.ac_c', public.test_auto_close_visit('00000000-0000-0000-0000-00000000e23c', '2099-05-01 12:00:00+00')::text, true);
select set_config('app.ac_d', public.test_auto_close_visit('00000000-0000-0000-0000-00000000e23d', '2099-05-01 12:00:00+00')::text, true);

-- A se inició el 1/5 a las 10:00 AR, B el 2/5 a las 10:00 AR y D ya se completó. (Fixture directo:
-- por la API el taller no podría tener A y B en curso a la vez.) Iniciar no cambia la reserva.
reset role;
update public.visitas_servicio set estado = 'en_curso', started_at = '2099-05-01 13:00:00+00'
where id = current_setting('app.ac_a')::uuid;
update public.visitas_servicio set estado = 'en_curso', started_at = '2099-05-02 13:00:00+00'
where id = current_setting('app.ac_b')::uuid;
-- D pasa de aceptada a completada directamente (el control de firmas solo rige desde en_curso).
update public.visitas_servicio set estado = 'completada', started_at = '2099-05-01 13:00:00+00'
where id = current_setting('app.ac_d')::uuid;
delete from public.visita_equipos where visita_id = current_setting('app.ac_d')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Corrida el 2/5 al mediodía: solo vence A (su día terminó el 2/5 a las 00:00 AR).
select is(public.close_expired_visits('2099-05-02 15:00:00+00'), 1, 'a later run closes the visits of earlier days that are still in progress');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_a')::uuid), 'requiere_finalizacion', 'a visit started on an earlier day moves to requiere_finalizacion');
select is((select count(*) from public.visita_equipos where visita_id = current_setting('app.ac_a')::uuid), 0::bigint, 'the closed visit releases its Equipo reservation');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_b')::uuid), 'en_curso', 'a visit started today stays in progress during the day, even past its estimated end');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_c')::uuid), 'aceptada', 'a visit that never started is not closed');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_d')::uuid), 'completada', 'a completed visit is not touched');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.ac_a')::uuid and estado = 'pendiente'), 1::bigint, 'work orders keep their state');
select is((select count(*) from public.firmas_visita where visita_id = current_setting('app.ac_a')::uuid), 0::bigint, 'missing signatures stay pending (none is created)');
select is(
  (select count(*) from public.registros_auditoria where visita_id = current_setting('app.ac_a')::uuid and accion = 'visita_requiere_finalizacion'),
  1::bigint,
  'the closing leaves one audit event per visit'
);
select ok(exists (
  select 1 from public.historial_relaciones
  where relacion_id = current_setting('app.ac_a')::uuid and datos->>'event' = 'visit_requires_finalization'
), 'the closing is recorded in the relationship history');

-- Corrida a las 23:59 AR del 2/5: vence B, iniciada ese día.
select is(public.close_expired_visits('2099-05-03 02:59:00+00'), 1, 'at 23:59 AR the visits started that day are closed');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_b')::uuid), 'requiere_finalizacion', 'the visit started that day requires finalization');
select is(public.close_expired_visits('2099-05-03 02:59:00+00'), 0, 'running the job twice changes nothing');
select is(
  (select count(*) from public.registros_auditoria where visita_id = current_setting('app.ac_a')::uuid and accion = 'visita_requiere_finalizacion'),
  1::bigint,
  'a repeated run does not duplicate the audit event'
);
select is((select estado::text from public.visitas_servicio where id = current_setting('app.ac_c')::uuid), 'aceptada', 'later runs still leave unstarted visits alone');

-- El equipo queda libre: se puede agendar otra visita en el horario que reservaba A.
select public.test_auto_close_set_actor('00000000-0000-0000-0000-00000000e202');
select lives_ok(
  $$select public.api_schedule_visit(
    (public.api_admin_create_service_request(
      '00000000-0000-0000-0000-00000000e201'::uuid, '00000000-0000-0000-0000-00000000e220'::uuid,
      '[{"kind":"valvula","id":"00000000-0000-0000-0000-00000000e24a"}]'::jsonb
    )->'request'->>'id')::uuid,
    '00000000-0000-0000-0000-00000000e210'::uuid, '2099-05-01 12:30:00+00'::timestamptz,
    '2099-05-01 13:30:00+00'::timestamptz)$$,
  'the released Equipo can be scheduled again in the window it had reserved'
);
select is(
  (select estado::text from public.solicitudes_servicio where id = (select solicitud_id from public.visitas_servicio where id = current_setting('app.ac_a')::uuid)),
  'aceptada',
  'the Solicitud of a visit that requires finalization stays accepted'
);
select is(
  (select count(*) from public.asignaciones_servicio a join public.visitas_servicio v on v.id = current_setting('app.ac_a')::uuid where a.yacimiento_id = v.yacimiento_id and a.taller_movil_id = v.taller_movil_id and a.estado = 'activa'),
  1::bigint,
  'the Taller keeps Yacimiento access to finish signatures'
);

select * from extensions.finish(true);
rollback;

begin;

select plan(25);

-- Fixtures: un Cliente, un Administrador, el Taller Móvil asignado y otro Taller Móvil ajeno.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003101', 'pm-client@example.test'),
  ('00000000-0000-0000-0000-000000003102', 'pm-admin@example.test'),
  ('00000000-0000-0000-0000-000000003103', 'pm-technician@example.test'),
  ('00000000-0000-0000-0000-000000003104', 'pm-other-technician@example.test');

insert into public.cuentas (id, rol, estado) values
  ('00000000-0000-0000-0000-000000003101', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000003102', 'administrador_regular', 'activa'),
  ('00000000-0000-0000-0000-000000003103', 'taller_movil', 'activa'),
  ('00000000-0000-0000-0000-000000003104', 'taller_movil', 'activa');
insert into public.clientes (cuenta_id, nombre, activo)
values ('00000000-0000-0000-0000-000000003101', 'PM Cliente', true);

insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000003110', 'PM Taller'),
  ('00000000-0000-0000-0000-000000003111', 'PM Taller ajeno');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000003110', '00000000-0000-0000-0000-000000003103'),
  ('00000000-0000-0000-0000-000000003111', '00000000-0000-0000-0000-000000003104');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
values ('00000000-0000-0000-0000-000000003120', '00000000-0000-0000-0000-000000003101', 'PM Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre)
values ('00000000-0000-0000-0000-000000003121', '00000000-0000-0000-0000-000000003120', 'PM Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000003122', '00000000-0000-0000-0000-000000003121', 'PM Equipo firmas'),
  ('00000000-0000-0000-0000-000000003123', '00000000-0000-0000-0000-000000003121', 'PM Equipo seguimiento'),
  ('00000000-0000-0000-0000-000000003124', '00000000-0000-0000-0000-000000003121', 'PM Equipo sin seguimiento');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000003130', '00000000-0000-0000-0000-000000003122', 'V-PM-1'),
  ('00000000-0000-0000-0000-000000003131', '00000000-0000-0000-0000-000000003123', 'V-PM-2'),
  ('00000000-0000-0000-0000-000000003132', '00000000-0000-0000-0000-000000003123', 'V-PM-3'),
  ('00000000-0000-0000-0000-000000003133', '00000000-0000-0000-0000-000000003124', 'V-PM-4');

create function public.test_pm_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_pm_set_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- P1: una visita en curso para registrar las firmas.
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select set_config('app.pm_sig_visit', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000003101'::uuid, '00000000-0000-0000-0000-000000003120'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000003122"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000003110'::uuid, '2099-07-01 12:00:00+00'::timestamptz, '2099-07-01 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select public.api_accept_visit(current_setting('app.pm_sig_visit')::uuid);
select is(public.api_start_visit(current_setting('app.pm_sig_visit')::uuid)->'visit'->>'estado', 'en_curso', 'P1 setup: the assigned Taller Móvil starts the visit');

-- La Edge Function sube el archivo antes de registrar la firma; acá se simula la subida.
reset role;
insert into storage.objects (bucket_id, name) values
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003140.png'),
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003141.png'),
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003142.png'),
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003143.png'),
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003144.png'),
  ('certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003145.png');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');

-- P1 en línea: la firma presencial del Cliente y su reintento.
select set_config('app.pm_client_sig', public.api_submit_visit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'cliente', 'Carla Cliente', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003140.png', 'pwa_cliente_presencial'
)->>'signature_id', true);
select set_config('app.pm_client_retry', public.api_submit_visit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'cliente', 'Carla Cliente', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003141.png', 'pwa_cliente_presencial'
)::text, true);
select is(current_setting('app.pm_client_retry')::jsonb->>'signature_id', current_setting('app.pm_client_sig'), 'P1: retrying an online signature returns the registered signature');
select is(current_setting('app.pm_client_retry')::jsonb->'already_registered', 'true'::jsonb, 'P1: the retry result says the signature was already registered');
select is((select count(*) from public.imagenes_certificado where object_path like '%/00000000-0000-0000-0000-000000003141.png'), 0::bigint, 'P1: the retried image is not registered (the stored signature is kept)');

-- P1 sin conexión: firma del Técnico, repetición idéntica y repetición con otra imagen.
select set_config('app.pm_tech_sig', public.api_offline_submit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'tecnico', 'Tomás Técnico', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003142.png',
  '00000000-0000-0000-0000-000000003142'::uuid, '2099-07-01 12:30:00+00'::timestamptz
)->>'signature_id', true);
select ok(nullif(current_setting('app.pm_tech_sig'), '') is not null, 'P1 setup: the Técnico signature is registered offline');
select is(public.api_offline_submit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'tecnico', 'Tomás Técnico', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003142.png',
  '00000000-0000-0000-0000-000000003142'::uuid, '2099-07-01 12:30:00+00'::timestamptz
)->>'signature_id', current_setting('app.pm_tech_sig'), 'P1: an identical offline replay returns the registered signature');
select set_config('app.pm_tech_retry', public.api_offline_submit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'tecnico', 'Otro Nombre', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003143.png',
  '00000000-0000-0000-0000-000000003143'::uuid, '2099-07-01 12:40:00+00'::timestamptz
)::text, true);
select is(current_setting('app.pm_tech_retry')::jsonb->>'image_id', '00000000-0000-0000-0000-000000003142', 'P1: a retry with another image returns the registered image');
select is(current_setting('app.pm_tech_retry')::jsonb->'finalized_certificates', '[]'::jsonb, 'P1: the retry is a no-op (no certificate is finalized by it)');
select ok((select count(*) = 1 and bool_and(nombre_firmante = 'Tomás Técnico' and imagen_id = '00000000-0000-0000-0000-000000003142') from public.firmas_visita where visita_id = current_setting('app.pm_sig_visit')::uuid and parte = 'tecnico'), 'P1: the stored Técnico signature is never overwritten');
select is((select count(*) from public.imagenes_certificado where id = '00000000-0000-0000-0000-000000003143'), 0::bigint, 'P1: the retried offline image is not registered');

-- P1: un reintento encolado ya no crea un conflicto de sincronización.
select set_config('app.pm_batch', public.api_sync_visit_batch(
  current_setting('app.pm_sig_visit')::uuid,
  jsonb_build_array(jsonb_build_object(
    'operation_id', '00000000-0000-0000-0000-000000003150', 'idempotency_key', '00000000-0000-0000-0000-000000003150',
    'kind', 'submit_signature', 'schema_version', 2, 'device_timestamp', '2099-07-01T12:45:00Z',
    'payload', jsonb_build_object(
      'party', 'tecnico', 'signer_name', 'Tomás Técnico', 'bucket', 'certificate-signatures',
      'object_path', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003144.png',
      'image_id', '00000000-0000-0000-0000-000000003144'
    )
  )),
  '00000000-0000-0000-0000-000000003160'::uuid
)::text, true);
select is((select estado::text from public.operaciones_sync where operation_id = '00000000-0000-0000-0000-000000003150'), 'sincronizada', 'P1: a queued signature retry synchronizes instead of conflicting');
select is((select count(*) from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-000000003150'), 0::bigint, 'P1: the signature retry leaves no synchronization conflict');

-- P1: un conflicto de firma (por ejemplo, de antes de este cambio) se resuelve rechazándolo.
select public.api_sync_visit_batch(
  current_setting('app.pm_sig_visit')::uuid,
  jsonb_build_array(jsonb_build_object(
    'operation_id', '00000000-0000-0000-0000-000000003151', 'idempotency_key', '00000000-0000-0000-0000-000000003151',
    'kind', 'submit_signature', 'schema_version', 2, 'device_timestamp', '2099-07-01T12:46:00Z',
    'payload', jsonb_build_object(
      'party', 'tecnico', 'signer_name', 'Tomás Técnico', 'bucket', 'certificate-signatures',
      'object_path', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003146.png',
      'image_id', '00000000-0000-0000-0000-000000003146'
    )
  )),
  '00000000-0000-0000-0000-000000003160'::uuid
);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-000000003151'),
  'reject', 'La firma ya estaba registrada'
)->>'resolution', 'rejected', 'P1: an Administrador can reject a signature conflict');
select ok((select resolved_at is not null and resolution_action = 'rejected' from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-000000003151'), 'P1: the rejected signature conflict is closed');

-- P1: un Taller Móvil ajeno no puede usar el reintento para leer la firma.
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003104');
select throws_ok(
  $$select public.api_offline_submit_signature(current_setting('app.pm_sig_visit')::uuid, 'tecnico', 'Tomás Técnico', 'certificate-signatures', 'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003142.png', '00000000-0000-0000-0000-000000003142'::uuid, null)$$,
  '23514', 'A visit signature cannot be replaced', 'P1: an unassigned Taller Móvil still gets the replacement error');

-- P1: después de completar la visita el reintento sigue siendo inofensivo.
reset role;
update public.visitas_servicio set estado = 'completada' where id = current_setting('app.pm_sig_visit')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select is(public.api_offline_submit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'tecnico', 'Tomás Técnico', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/tecnico/00000000-0000-0000-0000-000000003142.png',
  '00000000-0000-0000-0000-000000003142'::uuid, null
)->>'signature_id', current_setting('app.pm_tech_sig'), 'P1: a replay after completion returns the registered signature');
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003101');
select is(public.api_submit_visit_signature(
  current_setting('app.pm_sig_visit')::uuid, 'cliente', 'Carla Cliente', 'certificate-signatures',
  'visits/' || current_setting('app.pm_sig_visit') || '/cliente/00000000-0000-0000-0000-000000003145.png', 'panel_cliente'
)->>'signature_id', current_setting('app.pm_client_sig'), 'P1: the owning Cliente gets the registered signature instead of an error');

-- P3: desasignar o reasignar una visita de seguimiento aceptada no devuelve la solicitud a
-- pendiente si otra visita de la misma solicitud está completada.
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select set_config('app.pm_r', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000003101'::uuid, '00000000-0000-0000-0000-000000003120'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000003123"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000003110'::uuid, '2099-08-01 12:00:00+00'::timestamptz, '2099-08-01 13:00:00+00'::timestamptz
)::text, true);
select set_config('app.pm_r_id', current_setting('app.pm_r')::jsonb->'request'->>'id', true);
select set_config('app.pm_a', current_setting('app.pm_r')::jsonb->'scheduled_visit'->'visit'->>'id', true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select public.api_accept_visit(current_setting('app.pm_a')::uuid);
reset role;
update public.visitas_servicio set estado = 'completada' where id = current_setting('app.pm_a')::uuid;
delete from public.visita_equipos where visita_id = current_setting('app.pm_a')::uuid;
update public.ordenes_trabajo set estado = 'no_evaluada', no_evaluada_razon = 'Sin acceso al equipo'
where visita_id = current_setting('app.pm_a')::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select set_config('app.pm_b', public.api_create_followup_visit(
  current_setting('app.pm_r_id')::uuid, current_setting('app.pm_a')::uuid,
  array['00000000-0000-0000-0000-000000003131'::uuid], '00000000-0000-0000-0000-000000003110'::uuid,
  '2099-08-05 12:00:00+00'::timestamptz, '2099-08-05 13:00:00+00'::timestamptz
)->'visit'->>'id', true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select is(public.api_accept_visit(current_setting('app.pm_b')::uuid)->'visit'->>'estado', 'aceptada', 'P3 setup: the Taller Móvil accepts the follow-up visit');
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select is(public.api_unassign_visit(current_setting('app.pm_b')::uuid, 'Sin disponibilidad')->'visit'->>'estado', 'programada', 'P3 setup: the Administrador unassigns the accepted follow-up');
select ok((select estado = 'aceptada' and accepted_at is not null and taller_movil_id is not null from public.solicitudes_servicio where id = current_setting('app.pm_r_id')::uuid), 'P3: unassigning a follow-up keeps the request accepted when another visit is completed');

select lives_ok(
  $$select public.api_assign_visit(current_setting('app.pm_b')::uuid, '00000000-0000-0000-0000-000000003110'::uuid, 'Vuelve el taller', null, null)$$,
  'P3 setup: the unassigned follow-up is assigned again');
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select public.api_accept_visit(current_setting('app.pm_b')::uuid);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select is(public.api_reassign_visit(
  current_setting('app.pm_b')::uuid, '00000000-0000-0000-0000-000000003111'::uuid, 'Cambio de taller', null, null
)->'visit'->>'estado', 'programada', 'P3 setup: the Administrador reassigns the accepted follow-up');
select is((select estado from public.solicitudes_servicio where id = current_setting('app.pm_r_id')::uuid), 'aceptada'::public.estado_solicitud, 'P3: reassigning a follow-up keeps the request accepted when another visit is completed');
select lives_ok(
  $$select public.api_create_followup_visit(current_setting('app.pm_r_id')::uuid, current_setting('app.pm_a')::uuid, array['00000000-0000-0000-0000-000000003132'::uuid], '00000000-0000-0000-0000-000000003110'::uuid, '2099-08-07 12:00:00+00'::timestamptz, '2099-08-07 13:00:00+00'::timestamptz)$$,
  'P3: another follow-up can still be scheduled');

-- P3: con una sola visita, desasignarla sigue devolviendo la solicitud a pendiente.
select set_config('app.pm_r2', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000003101'::uuid, '00000000-0000-0000-0000-000000003120'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000003124"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000003110'::uuid, '2099-09-01 12:00:00+00'::timestamptz, '2099-09-01 13:00:00+00'::timestamptz
)::text, true);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003103');
select public.api_accept_visit((current_setting('app.pm_r2')::jsonb->'scheduled_visit'->'visit'->>'id')::uuid);
select public.test_pm_set_actor('00000000-0000-0000-0000-000000003102');
select public.api_unassign_visit((current_setting('app.pm_r2')::jsonb->'scheduled_visit'->'visit'->>'id')::uuid, 'Sin disponibilidad');
select ok((select estado = 'pendiente' and accepted_at is null and taller_movil_id is null from public.solicitudes_servicio where id = (current_setting('app.pm_r2')::jsonb->'request'->>'id')::uuid), 'P3: unassigning the only accepted visit still returns the request to pendiente');

select * from extensions.finish(true);
rollback;

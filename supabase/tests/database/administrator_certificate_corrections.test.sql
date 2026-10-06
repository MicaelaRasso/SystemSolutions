begin;

select plan(14);

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000006301', 'correction-client@example.test'),
  ('00000000-0000-0000-0000-000000006302', 'correction-admin@example.test'),
  ('00000000-0000-0000-0000-000000006303', 'correction-super@example.test'),
  ('00000000-0000-0000-0000-000000006304', 'correction-technician@example.test');
insert into public.cuentas(id, rol) values
  ('00000000-0000-0000-0000-000000006301', 'cliente'),
  ('00000000-0000-0000-0000-000000006302', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000006303', 'super_administrador'),
  ('00000000-0000-0000-0000-000000006304', 'taller_movil');
insert into public.clientes(cuenta_id, nombre)
values ('00000000-0000-0000-0000-000000006301', 'Correction Cliente');
insert into public.talleres_moviles(id, nombre)
values ('00000000-0000-0000-0000-000000006305', 'Correction Taller');
insert into public.taller_cuentas(taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000006305', '00000000-0000-0000-0000-000000006304');
insert into public.yacimientos(id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
values ('00000000-0000-0000-0000-000000006306', '00000000-0000-0000-0000-000000006301', 'Correction Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones(id, yacimiento_id, nombre)
values ('00000000-0000-0000-0000-000000006307', '00000000-0000-0000-0000-000000006306', 'Correction Planta');
insert into public.equipos_unidades(id, planta_id, nombre)
values ('00000000-0000-0000-0000-000000006308', '00000000-0000-0000-0000-000000006307', 'Correction Equipo');
insert into public.valvulas(id, equipo_id, nombre)
values ('00000000-0000-0000-0000-000000006309', '00000000-0000-0000-0000-000000006308', 'Correction Valvula');

-- Historical closed certificate, retained independently of the new visit.
insert into public.solicitudes_servicio(id, yacimiento_id, cliente_cuenta_id)
values ('00000000-0000-0000-0000-000000006310', '00000000-0000-0000-0000-000000006306', '00000000-0000-0000-0000-000000006301');
insert into public.visitas_servicio(id, solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado, accepted_at, replacement_catalog_version_id)
select '00000000-0000-0000-0000-000000006311', '00000000-0000-0000-0000-000000006310', '00000000-0000-0000-0000-000000006306', '00000000-0000-0000-0000-000000006305', '2025-01-01 09:00+00', '2025-01-01 10:00+00', 'completada', '2025-01-01 08:00+00', current_version_id
from public.replacement_catalog_state where singleton;
insert into public.ordenes_trabajo(id, visita_id, valvula_id, estado)
values ('00000000-0000-0000-0000-000000006312', '00000000-0000-0000-0000-000000006311', '00000000-0000-0000-0000-000000006309', 'evaluada');
insert into public.valvula_revisiones(id, valvula_id, datos)
values ('00000000-0000-0000-0000-000000006313', '00000000-0000-0000-0000-000000006309', '{"tag":"Correction Valvula"}');
insert into public.certificados(id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id, equipo_id, valvula_revision_id, estado_captura, estado, fecha_ejecucion, tecnico_ejecutor, datos_tecnicos, plantilla_version, plantilla_version_id, plantilla_snapshot, finalized_at)
select '00000000-0000-0000-0000-000000006314', '00000000-0000-0000-0000-000000006312', '00000000-0000-0000-0000-000000006311', '00000000-0000-0000-0000-000000006309', '00000000-0000-0000-0000-000000006306', '00000000-0000-0000-0000-000000006307', '00000000-0000-0000-0000-000000006308', '00000000-0000-0000-0000-000000006313', 'cerrado', 'finalizado', current_date, 'Técnico Original', '{"test":"original"}'::jsonb, version, id, jsonb_build_object('id', id, 'version', version, 'campos', campos), now()
from public.plantillas_certificado where estado = 'activa';

select has_function('public', 'api_authorize_certificate_correction', array['uuid','uuid','timestamptz','timestamptz','text']::text[], 'administrator correction command exists');
select is(has_function_privilege('authenticated', 'public.api_authorize_certificate_correction(uuid,uuid,timestamptz,timestamptz,text)', 'execute'), false, 'browser role cannot bypass Edge correction gateway');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000006304"}', true);
select public.require_systemsolutions_edge_gateway();
select throws_ok(
  $$select public.api_authorize_certificate_correction('00000000-0000-0000-0000-000000006314', '00000000-0000-0000-0000-000000006305', '2099-03-10 09:00+00', '2099-03-10 10:00+00', 'Wrong role')$$,
  '42501', 'Only an active Administrador can authorize a certificate correction', 'Taller Móvil cannot authorize correction'
);

select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000006302"}', true);
select public.require_systemsolutions_edge_gateway();
select throws_ok(
  $$select public.api_authorize_certificate_correction('00000000-0000-0000-0000-000000006314', '00000000-0000-0000-0000-000000006305', '2099-03-10 09:00+00', '2099-03-10 10:00+00', ' ')$$,
  '22023', 'A correction reason is required', 'blank correction reason is rejected'
);
select set_config('app.correction_id', (public.api_authorize_certificate_correction(
  '00000000-0000-0000-0000-000000006314', '00000000-0000-0000-0000-000000006305',
  '2099-03-10 09:00+00', '2099-03-10 10:00+00', 'Recalibración aprobada'
)->>'correction_id'), true);
select is((select count(*) from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid), 1::bigint, 'regular Administrador creates durable correction authorization');
select is((select count(*) from public.ordenes_trabajo where visita_id = (select visita_id from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid)), 1::bigint, 'correction creates one new work order');
select is((select estado from public.visitas_servicio where id = (select visita_id from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid))::text, 'programada', 'correction starts a normal scheduled visit');
select is((select estado from public.certificados where id = '00000000-0000-0000-0000-000000006314')::text, 'finalizado', 'source certificate remains closed and finalized');
select is((select count(*) from public.certificados where reemplaza_certificado_id = '00000000-0000-0000-0000-000000006314'), 0::bigint, 'replacement certificate is not created before normal evaluation');
select ok(exists(select 1 from public.registros_auditoria where accion = 'certificado_correccion_autorizada' and resumen_cambio->>'motivo' = 'Recalibración aprobada'), 'authorization reason is audited');

select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000006303"}', true);
select public.require_systemsolutions_edge_gateway();
select ok((public.api_authorize_certificate_correction(
  '00000000-0000-0000-0000-000000006314', '00000000-0000-0000-0000-000000006305',
  '2099-03-11 09:00+00', '2099-03-11 10:00+00', 'Segunda revisión'
)->>'correction_id') is not null, 'Super administrador may also authorize a correction');

reset role;
update public.visitas_servicio
set estado = 'en_curso', accepted_at = now(),
  replacement_catalog_version_id = (select current_version_id from public.replacement_catalog_state where singleton)
where id = (select visita_id from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid);
update public.ordenes_trabajo set estado = 'evaluada'
where id = (select orden_trabajo_id from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000006304"}', true);
select public.require_systemsolutions_edge_gateway();
select set_config('app.replacement_id', (public.api_start_certificate_draft(
  (select orden_trabajo_id from public.correcciones_certificado where id = current_setting('app.correction_id')::uuid)
)->'certificate'->>'id'), true);
select is((select reemplaza_certificado_id from public.certificados where id = current_setting('app.replacement_id')::uuid), '00000000-0000-0000-0000-000000006314'::uuid, 'normal draft creation links the replacement to its authorized historical source');
select is((select estado from public.certificados where id = '00000000-0000-0000-0000-000000006314')::text, 'finalizado', 'starting the correction draft does not change the source certificate');
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000006302"}', true);
select public.require_systemsolutions_edge_gateway();
select is((public.api_valvula_certificates('00000000-0000-0000-0000-000000006309')->>'current_certificate_id'), '00000000-0000-0000-0000-000000006314', 'an unfinalized correction does not displace the prior finalized certificate');

select * from extensions.finish(true);
rollback;

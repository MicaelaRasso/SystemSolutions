begin;

select plan(18);

select has_table('public', 'partes_diarios', 'each visit stores one Parte diario code');
select has_table('public', 'parte_diario_imagenes', 'Parte diario image references are separate from certificates');
select is((select relrowsecurity from pg_class where oid = 'public.partes_diarios'::regclass), true, 'Parte diario records have row-level security enabled');
select is(has_table_privilege('authenticated', 'public.partes_diarios', 'select'), false, 'browser sessions cannot bypass the Edge gateway to read Parte diario records');
select has_function('public', 'api_set_visit_parte_diario', array['uuid', 'text']::text[], 'the visit accepts an alphanumeric Parte diario code');
select is(has_function_privilege('authenticated', 'public.api_set_visit_parte_diario(uuid,text)', 'execute'), false, 'browser sessions cannot call the Parte diario mutation RPC directly');
select is(has_function_privilege('service_role', 'public.api_set_visit_parte_diario(uuid,text)', 'execute'), true, 'the Edge gateway can call the Parte diario mutation RPC');
select is(has_function_privilege('authenticated', 'public.api_sync_visit_part_diario_batch(uuid,jsonb,uuid)', 'execute'), false, 'browser sessions cannot bypass the gateway for PD synchronization');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002901', 'pd-client@example.test'),
  ('00000000-0000-0000-0000-000000002902', 'pd-other-client@example.test'),
  ('00000000-0000-0000-0000-000000002903', 'pd-tech@example.test'),
  ('00000000-0000-0000-0000-000000002904', 'pd-admin@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000002901', 'cliente'),
  ('00000000-0000-0000-0000-000000002902', 'cliente'),
  ('00000000-0000-0000-0000-000000002903', 'taller_movil'),
  ('00000000-0000-0000-0000-000000002904', 'administrador_regular');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000002901', 'PD Cliente'),
  ('00000000-0000-0000-0000-000000002902', 'PD Otro Cliente');
insert into public.talleres_moviles (id, nombre) values ('00000000-0000-0000-0000-000000002905', 'PD Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000002905', '00000000-0000-0000-0000-000000002903');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000002906', '00000000-0000-0000-0000-000000002901', 'PD Yacimiento', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000002907', '00000000-0000-0000-0000-000000002902', 'PD Yacimiento ajeno', 'Salta', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values ('00000000-0000-0000-0000-000000002908', '00000000-0000-0000-0000-000000002906', 'PD Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values ('00000000-0000-0000-0000-000000002909', '00000000-0000-0000-0000-000000002908', 'PD Equipo');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000002910', '00000000-0000-0000-0000-000000002909', 'PD Válvula 1'),
  ('00000000-0000-0000-0000-000000002917', '00000000-0000-0000-0000-000000002909', 'PD Válvula 2');

create function public.test_pd_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_pd_set_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_pd_set_actor('00000000-0000-0000-0000-000000002904');
select set_config('app.pd_request_id', (public.api_admin_create_service_request(
  '00000000-0000-0000-0000-000000002901'::uuid,
  '00000000-0000-0000-0000-000000002906'::uuid,
  '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000002910"},{"kind":"valvula","id":"00000000-0000-0000-0000-000000002917"}]'::jsonb
)->'request'->>'id'), true);
select set_config('app.pd_visit_id', (public.api_schedule_visit(
  current_setting('app.pd_request_id')::uuid,
  '00000000-0000-0000-0000-000000002905'::uuid,
  '2099-04-10 09:00:00+00'::timestamptz,
  '2099-04-10 10:00:00+00'::timestamptz
)->'visit'->>'id'), true);
select public.test_pd_set_actor('00000000-0000-0000-0000-000000002903');
select is((public.api_accept_visit(current_setting('app.pd_visit_id')::uuid)->'visit'->>'estado'), 'aceptada', 'the assigned Taller Móvil accepts the visit');
select is((public.api_start_visit(current_setting('app.pd_visit_id')::uuid)->'visit'->>'estado'), 'en_curso', 'the assigned Taller Móvil starts the visit');
select is(
  public.api_set_visit_parte_diario(current_setting('app.pd_visit_id')::uuid, 'PD2026A')->>'codigo',
  'PD2026A',
  'the Taller Móvil stores an alphanumeric code on the visit'
);
select set_config('app.pd_work_order_id', (select id::text from public.ordenes_trabajo where visita_id = current_setting('app.pd_visit_id')::uuid limit 1), true);
select public.api_update_work_order(current_setting('app.pd_work_order_id')::uuid, 'evaluada', null);
select public.api_start_certificate_draft(current_setting('app.pd_work_order_id')::uuid);
select public.api_update_work_order(
  (select id from public.ordenes_trabajo where visita_id = current_setting('app.pd_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000002917'::uuid),
  'evaluada', null
);
select public.api_start_certificate_draft(
  (select id from public.ordenes_trabajo where visita_id = current_setting('app.pd_visit_id')::uuid and valvula_id = '00000000-0000-0000-0000-000000002917'::uuid)
);
select is(
  (select count(*) from public.certificados c join public.partes_diarios pd on pd.visita_id = c.visita_id where c.visita_id = current_setting('app.pd_visit_id')::uuid and pd.codigo = 'PD2026A'),
  2::bigint,
  'one visit Parte diario code is shared by the certificates for both Válvulas'
);

select public.api_sync_visit_part_diario_batch(
  current_setting('app.pd_visit_id')::uuid,
  jsonb_build_array(
    jsonb_build_object('operation_id', '00000000-0000-0000-0000-000000002912', 'idempotency_key', 'pd-image-one', 'kind', 'attach_part_diario_image', 'payload', jsonb_build_object('codigo', 'PD2026A', 'image_id', '00000000-0000-0000-0000-000000002913', 'bucket', 'certificate-evidence', 'object_path', 'visits/' || current_setting('app.pd_visit_id') || '/parte-diario/00000000-0000-0000-0000-000000002913.jpg')),
    jsonb_build_object('operation_id', '00000000-0000-0000-0000-000000002914', 'idempotency_key', 'pd-image-two', 'kind', 'attach_part_diario_image', 'payload', jsonb_build_object('codigo', 'PD2026A', 'image_id', '00000000-0000-0000-0000-000000002915', 'bucket', 'certificate-evidence', 'object_path', 'visits/' || current_setting('app.pd_visit_id') || '/parte-diario/00000000-0000-0000-0000-000000002915.webp'))
  ),
  '00000000-0000-0000-0000-000000002916'::uuid
);
select is((select count(*) from public.parte_diario_imagenes where visita_id = current_setting('app.pd_visit_id')::uuid and codigo = 'PD2026A'), 2::bigint, 'a Parte diario accepts multiple images');
select public.api_sync_visit_part_diario_batch(
  current_setting('app.pd_visit_id')::uuid,
  jsonb_build_array(jsonb_build_object('operation_id', '00000000-0000-0000-0000-000000002912', 'idempotency_key', 'pd-image-one', 'kind', 'attach_part_diario_image', 'payload', jsonb_build_object('codigo', 'PD2026A', 'image_id', '00000000-0000-0000-0000-000000002913', 'bucket', 'certificate-evidence', 'object_path', 'visits/' || current_setting('app.pd_visit_id') || '/parte-diario/00000000-0000-0000-0000-000000002913.jpg'))),
  '00000000-0000-0000-0000-000000002916'::uuid
);
select is((select count(*) from public.parte_diario_imagenes where visita_id = current_setting('app.pd_visit_id')::uuid and codigo = 'PD2026A'), 2::bigint, 'replaying accepted media does not duplicate images');
select is(jsonb_array_length(public.api_visit_parte_diario(current_setting('app.pd_visit_id')::uuid)->'images'), 2, 'the visit read returns all PD images');

select public.test_pd_set_actor('00000000-0000-0000-0000-000000002901');
select is(
  (public.api_valvula_certificates_by_pd('00000000-0000-0000-0000-000000002910'::uuid, 'PD2026A')->'certificates'->0->'certificate'->>'pd'),
  'PD2026A',
  'the Cliente certificate history exposes the associated PD code'
);
select is(jsonb_array_length(public.api_valvula_certificates_by_pd('00000000-0000-0000-0000-000000002910'::uuid, 'OTHER')->'certificates'), 0, 'the Cliente history filter excludes a different PD code');
select public.test_pd_set_actor('00000000-0000-0000-0000-000000002902');
select throws_ok(
  $$select public.api_visit_parte_diario(current_setting('app.pd_visit_id')::uuid)$$,
  '42501', 'Not authorized', 'another Cliente cannot read the visit PD or images'
);

select * from extensions.finish(true);
rollback;

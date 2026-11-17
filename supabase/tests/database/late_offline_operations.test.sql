begin;

-- E3 (#96), decisión (e): las operaciones offline que llegan después del cierre automático de la
-- visita (`requiere_finalizacion`) quedan en conflicto para el Administrador y no modifican la
-- visita. El Administrador puede aceptarlas o rechazarlas; la corrección ya no pide hora de fin.
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f601', 'late-client@example.test'),
  ('00000000-0000-0000-0000-00000000f602', 'late-admin@example.test'),
  ('00000000-0000-0000-0000-00000000f603', 'late-tech@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-00000000f601', 'cliente'),
  ('00000000-0000-0000-0000-00000000f602', 'administrador_regular'),
  ('00000000-0000-0000-0000-00000000f603', 'taller_movil');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-00000000f601', 'Tardías Cliente');
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-00000000f610', 'Tardías Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-00000000f610', '00000000-0000-0000-0000-00000000f603');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-00000000f620', '00000000-0000-0000-0000-00000000f601', 'Tardías Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-00000000f621', '00000000-0000-0000-0000-00000000f620', 'Tardías Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-00000000f622', '00000000-0000-0000-0000-00000000f621', 'Tardías Equipo 1'),
  ('00000000-0000-0000-0000-00000000f623', '00000000-0000-0000-0000-00000000f621', 'Tardías Equipo 2');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-00000000f630', '00000000-0000-0000-0000-00000000f622', 'V-T-1'),
  ('00000000-0000-0000-0000-00000000f631', '00000000-0000-0000-0000-00000000f622', 'V-T-2'),
  ('00000000-0000-0000-0000-00000000f632', '00000000-0000-0000-0000-00000000f623', 'V-T-3');

create function public.test_late_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_late_set_actor(uuid) to service_role;

create function public.test_late_op(operation uuid, op_kind text, op_payload jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'operation_id', operation, 'idempotency_key', operation, 'kind', op_kind,
    'schema_version', 2, 'device_timestamp', '2099-08-01T20:00:00Z', 'payload', op_payload
  )
$$;
grant execute on function public.test_late_op(uuid, text, jsonb) to service_role;

create function public.test_late_closed_reason(operation uuid)
returns text language sql as $$
  select error_message from public.operaciones_sync where operation_id = operation
$$;
grant execute on function public.test_late_closed_reason(uuid) to service_role;

select has_function('public', 'visit_open_for_field_work', array['visitas_servicio']::text[], 'the field-work gate exists');
select is(has_function_privilege('authenticated', 'public.visit_open_for_field_work(public.visitas_servicio)', 'execute'), false, 'browser roles cannot call the field-work gate');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Visita sobre el Equipo 1 (dos válvulas), aceptada e iniciada; la válvula 1 queda evaluada.
select public.test_late_set_actor('00000000-0000-0000-0000-00000000f602');
select set_config('app.late_visit', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-00000000f601'::uuid, '00000000-0000-0000-0000-00000000f620'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-00000000f622"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-00000000f610'::uuid, '2099-08-01 12:00:00+00'::timestamptz, '2099-08-01 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select public.test_late_set_actor('00000000-0000-0000-0000-00000000f603');
select public.api_accept_visit(current_setting('app.late_visit')::uuid);
select public.api_start_visit(current_setting('app.late_visit')::uuid);
select set_config('app.late_wo1', (select id::text from public.ordenes_trabajo where visita_id = current_setting('app.late_visit')::uuid and valvula_id = '00000000-0000-0000-0000-00000000f630'), true);
select set_config('app.late_wo2', (select id::text from public.ordenes_trabajo where visita_id = current_setting('app.late_visit')::uuid and valvula_id = '00000000-0000-0000-0000-00000000f631'), true);
select public.api_update_work_order(current_setting('app.late_wo1')::uuid, 'evaluada', null);

-- El cierre automático vence la visita.
select ok(public.close_expired_visits('2099-12-31 12:00:00+00') >= 1, 'the automatic closing moves the visit to requiere_finalizacion');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.late_visit')::uuid), 'requiere_finalizacion', 'the visit requires finalization');

-- Llegan tarde operaciones de cada tipo, en un mismo lote.
select set_config('app.late_batch', public.api_sync_visit_batch(
  current_setting('app.late_visit')::uuid,
  jsonb_build_array(
    public.test_late_op('00000000-0000-0000-0000-00000000f701', 'work_order_outcome',
      jsonb_build_object('work_order_id', current_setting('app.late_wo2'), 'outcome', 'no_evaluada', 'not_evaluated_reason', 'Sin acceso')),
    public.test_late_op('00000000-0000-0000-0000-00000000f702', 'start_certificate_draft',
      jsonb_build_object('work_order_id', current_setting('app.late_wo1'), 'certificate_id', '00000000-0000-0000-0000-00000000f650')),
    public.test_late_op('00000000-0000-0000-0000-00000000f703', 'update_certificate_draft',
      '{"certificate_id":"00000000-0000-0000-0000-00000000f650","data":{"observaciones":"ok"}}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f704', 'capture_evidence',
      '{"certificate_id":"00000000-0000-0000-0000-00000000f650","media_id":"00000000-0000-0000-0000-00000000f651","category":"desarmada"}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f705', 'submit_signature',
      '{"party":"tecnico","signer_name":"Ana Técnica","image_id":"00000000-0000-0000-0000-00000000f652"}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f706', 'finalize_certificate',
      '{"certificate_id":"00000000-0000-0000-0000-00000000f650"}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f707', 'add_work_order',
      '{"work_order_id":"00000000-0000-0000-0000-00000000f660","valvula_id":"00000000-0000-0000-0000-00000000f632"}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f708', 'create_valve',
      '{"work_order_id":"00000000-0000-0000-0000-00000000f661","valvula_id":"00000000-0000-0000-0000-00000000f662","equipo_id":"00000000-0000-0000-0000-00000000f623","valvula":{"nombre":"PSV-NUEVA"}}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f709', 'complete_visit', '{}'::jsonb)
  ),
  '00000000-0000-0000-0000-00000000f690'::uuid
)::text, true);
select set_config('app.late_pd_batch', public.api_sync_visit_part_diario_batch(
  current_setting('app.late_visit')::uuid,
  jsonb_build_array(
    public.test_late_op('00000000-0000-0000-0000-00000000f710', 'set_part_diario', '{"codigo":"PD77"}'::jsonb),
    public.test_late_op('00000000-0000-0000-0000-00000000f711', 'attach_part_diario_image',
      '{"codigo":"PD77","image_id":"00000000-0000-0000-0000-00000000f653"}'::jsonb)
  ),
  '00000000-0000-0000-0000-00000000f690'::uuid
)::text, true);

select is(
  (select count(*) from jsonb_array_elements(current_setting('app.late_batch')::jsonb->'operations') op where op->>'estado' = 'conflicto'),
  9::bigint,
  'every kind of late operation becomes a conflict (orders, drafts, photos, signatures, valves, completion)'
);
select is(
  (select count(*) from jsonb_array_elements(current_setting('app.late_pd_batch')::jsonb->'operations') op where op->>'estado' = 'conflicto'),
  2::bigint,
  'late Parte diario operations become conflicts too'
);
select is(
  (select count(distinct op->>'error_message') from jsonb_array_elements(
    (current_setting('app.late_batch')::jsonb->'operations') || (current_setting('app.late_pd_batch')::jsonb->'operations')) op),
  1::bigint,
  'all late operations share one reason'
);
select is(
  public.test_late_closed_reason('00000000-0000-0000-0000-00000000f709'),
  'The visit was closed at the end of its day and requires finalization',
  'the conflict reason says the visit closed by expiry'
);
select is(
  (select error_code from public.operaciones_sync where operation_id = '00000000-0000-0000-0000-00000000f705'),
  '55000',
  'the late operation keeps a distinctive error code'
);
select is(
  (select count(*) from public.conflictos_sync where visita_id = current_setting('app.late_visit')::uuid and resolved_at is null),
  11::bigint,
  'the Administrador receives one conflict per late operation, with its payload'
);
select is(current_setting('app.late_batch')::jsonb#>>'{visit_acknowledgement,backend_status}', 'requiere_finalizacion', 'the batch acknowledgement reports the visit state');
select is(current_setting('app.late_pd_batch')::jsonb#>>'{visit_acknowledgement,backend_status}', 'requiere_finalizacion', 'the Parte diario acknowledgement reports the visit state');

-- Nada se aplicó.
select is((select estado::text from public.visitas_servicio where id = current_setting('app.late_visit')::uuid), 'requiere_finalizacion', 'the late completion does not change the visit');
select is((select estado::text from public.ordenes_trabajo where id = current_setting('app.late_wo2')::uuid), 'pendiente', 'the late outcome does not change the work order');
select is((select count(*) from public.certificados where visita_id = current_setting('app.late_visit')::uuid), 0::bigint, 'no certificate draft is created');
select is((select count(*) from public.firmas_visita where visita_id = current_setting('app.late_visit')::uuid), 0::bigint, 'no signature is registered');
select is((select count(*) from public.ordenes_trabajo where visita_id = current_setting('app.late_visit')::uuid), 2::bigint, 'no work order is added');
select is((select count(*) from public.valvulas where id = '00000000-0000-0000-0000-00000000f662'), 0::bigint, 'no Válvula is created');
select is((select count(*) from public.partes_diarios where visita_id = current_setting('app.late_visit')::uuid), 0::bigint, 'no Parte diario is stored');

-- Reenviar el lote devuelve el mismo recibo, sin duplicar conflictos.
select is(public.api_sync_visit_batch(
  current_setting('app.late_visit')::uuid,
  jsonb_build_array(public.test_late_op('00000000-0000-0000-0000-00000000f709', 'complete_visit', '{}'::jsonb)),
  '00000000-0000-0000-0000-00000000f690'::uuid
)#>>'{operations,0,estado}', 'conflicto', 'replaying a late operation returns its stored conflict');
select is((select count(*) from public.conflictos_sync where visita_id = current_setting('app.late_visit')::uuid), 11::bigint, 'replaying does not duplicate conflicts');

-- El Técnico no puede saltear el conflicto operando en línea.
select throws_ok(
  $$select public.api_update_work_order(current_setting('app.late_wo2')::uuid, 'no_evaluada', 'Sin acceso')$$,
  '23514', 'Work orders can be updated only while the visit is in progress',
  'the Técnico cannot change work orders of a visit that requires finalization'
);
select throws_ok(
  $$select public.api_set_visit_parte_diario(current_setting('app.late_visit')::uuid, 'PD77')$$,
  '23514', 'A Parte diario can only be changed while its visit is in progress',
  'the Técnico cannot change the Parte diario of a visit that requires finalization'
);

-- El Administrador acepta las operaciones hechas ese día.
select public.test_late_set_actor('00000000-0000-0000-0000-00000000f602');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f701'),
  'accept', 'Resultado registrado en campo ese día'
)->>'resolution', 'accepted', 'an Administrador can accept a late work-order outcome');
select is((select estado::text from public.ordenes_trabajo where id = current_setting('app.late_wo2')::uuid), 'no_evaluada', 'the accepted outcome is applied');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f702'),
  'accept', 'Borrador iniciado ese día'
)->>'resolution', 'accepted', 'an Administrador can accept a late certificate draft');
select ok(exists (select 1 from public.certificados where id = '00000000-0000-0000-0000-00000000f650'), 'the accepted draft keeps the device id');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f707'),
  'accept', 'Válvula agregada ese día'
)->>'resolution', 'accepted', 'an Administrador can accept a late valve addition');
select ok(exists (
  select 1 from public.ordenes_trabajo
  where id = '00000000-0000-0000-0000-00000000f660' and visita_id = current_setting('app.late_visit')::uuid
), 'the accepted addition creates the work order with the device id');
select is((select count(*) from public.visita_equipos where visita_id = current_setting('app.late_visit')::uuid), 0::bigint, 'accepting a late addition does not reserve the released Equipo again');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f710'),
  'accept', 'PD cargado ese día'
)->>'resolution', 'accepted', 'an Administrador can accept a late Parte diario code');
select is((select codigo from public.partes_diarios where visita_id = current_setting('app.late_visit')::uuid), 'PD77', 'the accepted Parte diario code is stored');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.late_visit')::uuid), 'requiere_finalizacion', 'accepting late work keeps the visit requiring finalization');

-- Una firma tardía no se acepta: se rechaza y se vuelve a firmar (#97).
select throws_ok(
  $$select public.api_resolve_sync_conflict(
    (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f705'),
    'accept', 'Firma de ese día')$$,
  '23514', 'An Administrador cannot accept a visit-signature operation; reject it or authorize a certificate correction',
  'a late signature still cannot be accepted'
);
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f705'),
  'reject', 'El Técnico firma de nuevo desde el panel'
)->>'resolution', 'rejected', 'a late signature is rejected');

-- La corrección pide taller, inicio y fin estimado; con todo, el error es el del certificado.
select throws_ok(
  $$select public.api_resolve_sync_conflict(
    (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f706'),
    'correction', 'Corregir', null, '00000000-0000-0000-0000-00000000f610'::uuid,
    '2100-01-10 12:00:00+00'::timestamptz, '2100-01-10 13:00:00+00'::timestamptz)$$,
  '23514', 'Correction resolution requires a closed certificate from the conflicted visit',
  'with a Taller Móvil, start and estimated end, a correction still needs a closed certificate'
);
select throws_ok(
  $$select public.api_resolve_sync_conflict(
    (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f706'),
    'correction', 'Corregir', null, '00000000-0000-0000-0000-00000000f610'::uuid,
    '2100-01-10 12:00:00+00'::timestamptz, null)$$,
  '22023', 'Correction resolution requires a Taller Móvil and visit start/end times',
  'a correction needs its estimated end time'
);

select * from finish();
rollback;

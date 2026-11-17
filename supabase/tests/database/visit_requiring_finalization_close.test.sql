begin;

-- E4 (#97), «Decisiones cerradas (2026-11-16)»: completar una visita en «Requiere finalización».
-- El Técnico (cualquiera del taller, incluido un reemplazante) firma desde el panel, el Cliente
-- firma desde el portal y el Administrador la cierra con un motivo: las válvulas sin evaluar van a
-- una visita de seguimiento y los borradores incompletos no se emiten.
select plan(43);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f801', 'fin-client@example.test'),
  ('00000000-0000-0000-0000-00000000f802', 'fin-admin@example.test'),
  ('00000000-0000-0000-0000-00000000f803', 'fin-tech@example.test'),
  ('00000000-0000-0000-0000-00000000f804', 'fin-other-tech@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-00000000f801', 'cliente'),
  ('00000000-0000-0000-0000-00000000f802', 'administrador_regular'),
  ('00000000-0000-0000-0000-00000000f803', 'taller_movil'),
  ('00000000-0000-0000-0000-00000000f804', 'taller_movil');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-00000000f801', 'Finalización Cliente');
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-00000000f810', 'Finalización Taller'),
  ('00000000-0000-0000-0000-00000000f811', 'Otro Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-00000000f810', '00000000-0000-0000-0000-00000000f803'),
  ('00000000-0000-0000-0000-00000000f811', '00000000-0000-0000-0000-00000000f804');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-00000000f820', '00000000-0000-0000-0000-00000000f801', 'Finalización Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-00000000f821', '00000000-0000-0000-0000-00000000f820', 'Finalización Planta');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-00000000f822', '00000000-0000-0000-0000-00000000f821', 'Equipo A'),
  ('00000000-0000-0000-0000-00000000f823', '00000000-0000-0000-0000-00000000f821', 'Equipo B');
-- Visita A: V1 (borrador completo), V2 (borrador incompleto) y V3 (sin resultado). Visita B: V4.
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-00000000f831', '00000000-0000-0000-0000-00000000f822', 'V-1'),
  ('00000000-0000-0000-0000-00000000f832', '00000000-0000-0000-0000-00000000f822', 'V-2'),
  ('00000000-0000-0000-0000-00000000f833', '00000000-0000-0000-0000-00000000f822', 'V-3'),
  ('00000000-0000-0000-0000-00000000f834', '00000000-0000-0000-0000-00000000f823', 'V-4');

create function public.test_fin_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_fin_set_actor(uuid) to service_role;

create function public.test_fin_order(visit uuid, valve uuid)
returns uuid language sql as $$
  select id from public.ordenes_trabajo where visita_id = visit and valvula_id = valve
$$;
grant execute on function public.test_fin_order(uuid, uuid) to service_role;

-- Borrador con los datos técnicos obligatorios (como en service_workflow.test.sql).
create function public.test_fin_complete_draft(certificate uuid)
returns jsonb language sql as $$
  select public.api_update_certificate_draft(certificate, jsonb_build_object(
    'fecha_ejecucion', current_date::text,
    'tecnico_ejecutor', 'Tecnico Reemplazo',
    'campos_personalizados', jsonb_build_object(
      'fecha_ejecucion', current_date::text,
      'tecnico_ejecutor', 'Tecnico Reemplazo'
    ),
    'datos_tecnicos', jsonb_build_object('ensayos', jsonb_build_object(
      'sp_inicial', jsonb_build_object('valor', 1, 'unidad', 'bar'),
      'sp_apertura', jsonb_build_object('valor', 2, 'unidad', 'bar'),
      'presion_cierre', jsonb_build_object('valor', 3, 'unidad', 'bar'),
      'patron', jsonb_build_object('id', 'p1', 'label', 'Patrón 1')
    ))
  ))
$$;
grant execute on function public.test_fin_complete_draft(uuid) to service_role;

-- Firma subida a Storage (el RPC exige el objeto); devuelve la ruta.
create function public.test_fin_signature_object(visit uuid, party text, image uuid)
returns text language plpgsql security definer as $$
declare path text := 'visits/' || visit::text || '/' || party || '/' || image::text || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('certificate-signatures', path);
  return path;
end;
$$;
grant execute on function public.test_fin_signature_object(uuid, text, uuid) to service_role;

select has_function('public', 'api_admin_close_visit_requiring_finalization', array['uuid', 'text', 'uuid', 'timestamptz', 'timestamptz']::text[], 'the administrative closing RPC exists');
select is(has_function_privilege('authenticated', 'public.api_admin_close_visit_requiring_finalization(uuid,text,uuid,timestamptz,timestamptz)', 'execute'), false, 'browser roles cannot close visits directly');
select is(has_function_privilege('service_role', 'public.api_admin_close_visit_requiring_finalization(uuid,text,uuid,timestamptz,timestamptz)', 'execute'), true, 'the Edge gateway can close visits');
select is(has_function_privilege('service_role', 'public.complete_visit_requiring_finalization(uuid)', 'execute'), false, 'the automatic completion helper is internal');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f802');
select set_config('app.fin_a', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-00000000f801'::uuid, '00000000-0000-0000-0000-00000000f820'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-00000000f822"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-00000000f810'::uuid, '2099-08-01 12:00:00+00'::timestamptz, '2099-08-01 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select set_config('app.fin_b', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-00000000f801'::uuid, '00000000-0000-0000-0000-00000000f820'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-00000000f823"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-00000000f810'::uuid, '2099-08-01 14:00:00+00'::timestamptz, '2099-08-01 15:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);

select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f803');
select public.api_accept_visit(current_setting('app.fin_a')::uuid);
select public.api_accept_visit(current_setting('app.fin_b')::uuid);
select public.api_start_visit(current_setting('app.fin_a')::uuid);

-- Visita A: V1 con borrador completo, V2 con borrador incompleto, V3 sin resultado.
select public.api_update_work_order(public.test_fin_order(current_setting('app.fin_a')::uuid, '00000000-0000-0000-0000-00000000f831'), 'evaluada', null);
select public.api_update_work_order(public.test_fin_order(current_setting('app.fin_a')::uuid, '00000000-0000-0000-0000-00000000f832'), 'evaluada', null);
select public.api_start_certificate_draft(public.test_fin_order(current_setting('app.fin_a')::uuid, '00000000-0000-0000-0000-00000000f831'), '00000000-0000-0000-0000-00000000f841');
select public.api_start_certificate_draft(public.test_fin_order(current_setting('app.fin_a')::uuid, '00000000-0000-0000-0000-00000000f832'), '00000000-0000-0000-0000-00000000f842');
select public.test_fin_complete_draft('00000000-0000-0000-0000-00000000f841');
-- Un taller atiende una visita a la vez: B no puede iniciar mientras A sigue en curso.
select throws_ok(
  $$select public.api_start_visit(current_setting('app.fin_b')::uuid)$$,
  '23514', 'The Taller Móvil already has a visit in progress; complete it before starting another',
  'the Taller cannot start a second visit while another one is in progress'
);
-- A vence (cierre automático) y deja libre al taller para iniciar B.
select ok(public.close_expired_visits('2099-12-31 12:00:00+00') >= 1, 'visit A expires');
select public.api_start_visit(current_setting('app.fin_b')::uuid);
-- Visita B: V4 con borrador completo, sin firmas.
select public.api_update_work_order(public.test_fin_order(current_setting('app.fin_b')::uuid, '00000000-0000-0000-0000-00000000f834'), 'evaluada', null);
select public.api_start_certificate_draft(public.test_fin_order(current_setting('app.fin_b')::uuid, '00000000-0000-0000-0000-00000000f834'), '00000000-0000-0000-0000-00000000f844');
select public.test_fin_complete_draft('00000000-0000-0000-0000-00000000f844');

select ok(public.close_expired_visits('2099-12-31 12:00:00+00') >= 1, 'visit B expires');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fin_a')::uuid), 'requiere_finalizacion', 'visit A requires finalization');

-- El panel del taller sigue mostrando la visita vencida.
select ok(exists (
  select 1 from jsonb_array_elements(public.api_offline_working_set_for_device('00000000-0000-0000-0000-00000000f890'::uuid)->'visits') entry
  where entry#>>'{visit,id}' = current_setting('app.fin_a')
), 'the device working set keeps the visit that requires finalization');

-- 1. El Técnico firma desde el panel: primero la firma presencial del Cliente, después la suya.
select lives_ok(
  $$select public.api_submit_visit_signature(current_setting('app.fin_a')::uuid, 'cliente'::public.parte_firma_visita,
    'Juan Perez', 'certificate-signatures',
    public.test_fin_signature_object(current_setting('app.fin_a')::uuid, 'cliente', '00000000-0000-0000-0000-00000000f851'),
    'pwa_cliente_presencial')$$,
  'the Técnico can capture the in-person Cliente signature on an expired visit'
);
select set_config('app.fin_a_sig', public.api_submit_visit_signature(current_setting('app.fin_a')::uuid, 'tecnico'::public.parte_firma_visita,
  'Reemplazo Fuera De Nomina', 'certificate-signatures',
  public.test_fin_signature_object(current_setting('app.fin_a')::uuid, 'tecnico', '00000000-0000-0000-0000-00000000f852'),
  'pwa_tecnico')::text, true);
select ok((current_setting('app.fin_a_sig')::jsonb->>'signature_id') is not null, 'any Técnico of the Taller, even a replacement, can sign an expired visit');
select is((current_setting('app.fin_a_sig')::jsonb->>'visit_completed')::boolean, false, 'with pending work the signature does not complete the visit');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fin_a')::uuid), 'requiere_finalizacion', 'the visit waits for the Administrador');
select is((select estado::text from public.certificados where id = '00000000-0000-0000-0000-00000000f841'), 'borrador', 'no certificate is issued while the visit is not closed');
select is(
  public.api_submit_visit_signature(current_setting('app.fin_a')::uuid, 'tecnico'::public.parte_firma_visita,
    'Reemplazo Fuera De Nomina', 'certificate-signatures',
    public.test_fin_signature_object(current_setting('app.fin_a')::uuid, 'tecnico', '00000000-0000-0000-0000-00000000f853'),
    'pwa_tecnico')->>'already_registered',
  'true',
  'retrying the signature on an expired visit returns the registered one'
);
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f804');
select throws_ok(
  $$select public.api_submit_visit_signature(current_setting('app.fin_b')::uuid, 'tecnico'::public.parte_firma_visita,
    'Intruso', 'certificate-signatures',
    public.test_fin_signature_object(current_setting('app.fin_b')::uuid, 'tecnico', '00000000-0000-0000-0000-00000000f854'),
    'pwa_tecnico')$$,
  '42501', 'The Técnico is not assigned to this visit Taller Móvil',
  'a Técnico of another Taller cannot sign the expired visit'
);

-- 2. El Cliente firma desde el portal la visita B y la ve en sus pendientes.
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f801');
select ok(exists (
  select 1 from jsonb_array_elements(public.api_cliente_pending_certificates()->'visits') entry
  where entry#>>'{visit,id}' = current_setting('app.fin_b')
    and (entry->>'pending_certificate_count')::integer = 1
), 'the Cliente sees the expired visit with its complete draft pending signature');
select set_config('app.fin_b_client', public.api_submit_visit_signature(current_setting('app.fin_b')::uuid, 'cliente'::public.parte_firma_visita,
  'Ana Cliente', 'certificate-signatures',
  public.test_fin_signature_object(current_setting('app.fin_b')::uuid, 'cliente', '00000000-0000-0000-0000-00000000f855'),
  'panel_cliente')::text, true);
select is((current_setting('app.fin_b_client')::jsonb->>'visit_completed')::boolean, false, 'the Cliente signs from the portal; without the Técnico signature the visit stays open');
select is((select count(*) from public.firmas_visita where visita_id = current_setting('app.fin_b')::uuid and parte = 'cliente' and capture_method = 'panel_cliente'), 1::bigint, 'the portal signature is registered');

-- La firma del Técnico sigue siendo obligatoria para completar desde «Requiere finalización».
reset role;
select throws_ok(
  $$update public.visitas_servicio set estado = 'completada' where id = current_setting('app.fin_b')::uuid$$,
  '23514', 'A Técnico signature is required to complete a visit',
  'an expired visit cannot be completed without the Técnico signature'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Con la firma del Técnico, la visita B (lista) se completa sola y emite su certificado.
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f803');
select set_config('app.fin_b_sig', public.api_submit_visit_signature(current_setting('app.fin_b')::uuid, 'tecnico'::public.parte_firma_visita,
  'Tecnico Reemplazo', 'certificate-signatures',
  public.test_fin_signature_object(current_setting('app.fin_b')::uuid, 'tecnico', '00000000-0000-0000-0000-00000000f856'),
  'pwa_tecnico')::text, true);
select is((current_setting('app.fin_b_sig')::jsonb->>'visit_completed')::boolean, true, 'the missing Técnico signature completes a ready expired visit');
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fin_b')::uuid), 'completada', 'the ready visit is completed');
select is((select estado::text from public.certificados where id = '00000000-0000-0000-0000-00000000f844'), 'finalizado', 'its complete and signed certificate is issued');
select is(jsonb_array_length(current_setting('app.fin_b_sig')::jsonb->'finalized_certificates'), 1, 'the signature response lists the issued certificate');

-- 3. El Administrador cierra la visita A con motivo.
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_a')::uuid, 'Cierre', null, null)$$,
  '42501', 'Only an active Administrador can close a visit that requires finalization',
  'a Técnico cannot close the visit administratively'
);
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f801');
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_a')::uuid, 'Cierre', null, null)$$,
  '42501', 'Only an active Administrador can close a visit that requires finalization',
  'a Cliente cannot close the visit administratively'
);
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f802');
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_a')::uuid, '   ', null, null)$$,
  '22023', 'A closing reason of 1 to 1000 characters is required',
  'the closing reason is mandatory'
);
reset role;
insert into public.operaciones_sync(operation_id, visita_id, kind, payload, device_id, estado, error_code, error_message)
values ('00000000-0000-0000-0000-00000000f861', current_setting('app.fin_a')::uuid, 'work_order_outcome', '{}',
  '00000000-0000-0000-0000-00000000f890', 'conflicto', '55000', 'The visit was closed at the end of its day and requires finalization');
insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
values ('00000000-0000-0000-0000-00000000f861', current_setting('app.fin_a')::uuid, '{}',
  'The visit was closed at the end of its day and requires finalization');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_fin_set_actor('00000000-0000-0000-0000-00000000f802');
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_a')::uuid, 'Cierre', null, null)$$,
  '23514', 'Resolve the synchronization conflicts of this visit before closing it',
  'pending synchronization conflicts must be resolved before closing'
);
select public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-00000000f861'),
  'reject', 'Se cierra la visita'
);
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_a')::uuid, 'Cierre', null, null)$$,
  '22023', 'A follow-up visit for the unevaluated Válvulas requires a Taller Móvil and start/end times',
  'unevaluated valves need the follow-up Taller Móvil, start and estimated end'
);
select is((select estado::text from public.visitas_servicio where id = current_setting('app.fin_a')::uuid), 'requiere_finalizacion', 'a rejected closing changes nothing');

select set_config('app.fin_close', public.api_admin_close_visit_requiring_finalization(
  current_setting('app.fin_a')::uuid, 'El técnico no completó V-3 ni el borrador de V-2',
  '00000000-0000-0000-0000-00000000f810'::uuid, '2099-09-01 12:00:00+00'::timestamptz,
  '2099-09-01 13:30:00+00'::timestamptz
)::text, true);
select is(current_setting('app.fin_close')::jsonb#>>'{visit,estado}', 'completada', 'the Administrador closes the visit');
select is(
  (select cierre_administrativo_motivo from public.visitas_servicio where id = current_setting('app.fin_a')::uuid),
  'El técnico no completó V-3 ni el borrador de V-2',
  'the closing reason is stored on the visit'
);
select ok(exists (
  select 1 from public.registros_auditoria
  where visita_id = current_setting('app.fin_a')::uuid
    and accion = 'visita_cierre_administrativo'
    and resumen_cambio->>'motivo' = 'El técnico no completó V-3 ni el borrador de V-2'
), 'the administrative closing is audited with its reason');
select is(
  (select estado::text || ':' || no_evaluada_razon from public.ordenes_trabajo where id = public.test_fin_order(current_setting('app.fin_a')::uuid, '00000000-0000-0000-0000-00000000f833')),
  'no_evaluada:El técnico no completó V-3 ni el borrador de V-2',
  'the valve without outcome is recorded as not evaluated with the reason'
);
select ok((current_setting('app.fin_close')::jsonb->>'follow_up_visit_id') is not null, 'a follow-up visit is created');
select is(
  (select array_agg(valvula_id order by valvula_id) from public.ordenes_trabajo where visita_id = (current_setting('app.fin_close')::jsonb->>'follow_up_visit_id')::uuid),
  array['00000000-0000-0000-0000-00000000f833'::uuid],
  'the follow-up visit carries only the unevaluated valve'
);
select is(
  (select ends_at from public.visitas_servicio where id = (current_setting('app.fin_close')::jsonb->>'follow_up_visit_id')::uuid),
  '2099-09-01 13:30:00+00'::timestamptz,
  'the follow-up visit keeps the estimated end chosen by the Administrador'
);
select is(
  (select solicitud_id from public.visitas_servicio where id = (current_setting('app.fin_close')::jsonb->>'follow_up_visit_id')::uuid),
  (select solicitud_id from public.visitas_servicio where id = current_setting('app.fin_a')::uuid),
  'the follow-up visit belongs to the same Solicitud'
);
select is((select estado::text from public.certificados where id = '00000000-0000-0000-0000-00000000f841'), 'finalizado', 'the complete and signed certificate is issued');
select is(
  (select estado::text || ':' || estado_captura::text from public.certificados where id = '00000000-0000-0000-0000-00000000f842'),
  'borrador:abierto',
  'the incomplete draft is not issued and stays as a draft'
);
select is(current_setting('app.fin_close')::jsonb->'incomplete_certificate_ids', '["00000000-0000-0000-0000-00000000f842"]'::jsonb, 'the response lists the incomplete drafts for the Administrador');
select is(
  public.api_admin_close_visit_requiring_finalization(
    current_setting('app.fin_a')::uuid, 'El técnico no completó V-3 ni el borrador de V-2',
    '00000000-0000-0000-0000-00000000f810'::uuid, '2099-09-01 12:00:00+00'::timestamptz,
    '2099-09-01 13:30:00+00'::timestamptz
  )->>'already_closed',
  'true',
  'retrying the same closing returns the result without repeating it'
);
select throws_ok(
  $$select public.api_admin_close_visit_requiring_finalization(current_setting('app.fin_b')::uuid, 'Otro motivo', null, null)$$,
  '23514', 'Only a visit that requires finalization can be closed by an Administrador',
  'a completed visit cannot be closed administratively'
);

select * from finish();
rollback;

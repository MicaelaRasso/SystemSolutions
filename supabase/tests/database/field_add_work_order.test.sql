begin;

-- A1 + A3a (#83): el técnico agrega en campo una válvula existente del catálogo del Cliente, con o
-- sin conexión. La operación offline `add_work_order` lleva el id de la orden generado en el
-- dispositivo, es idempotente, y pasa a conflicto si la visita no la admite.
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000008301', 'fa-client@example.test'),
  ('00000000-0000-0000-0000-000000008302', 'fa-admin@example.test'),
  ('00000000-0000-0000-0000-000000008303', 'fa-technician@example.test'),
  ('00000000-0000-0000-0000-000000008304', 'fa-other-client@example.test');

insert into public.cuentas (id, rol, estado) values
  ('00000000-0000-0000-0000-000000008301', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000008302', 'administrador_regular', 'activa'),
  ('00000000-0000-0000-0000-000000008303', 'taller_movil', 'activa'),
  ('00000000-0000-0000-0000-000000008304', 'cliente', 'activa');
insert into public.clientes (cuenta_id, nombre, activo) values
  ('00000000-0000-0000-0000-000000008301', 'FA Cliente', true),
  ('00000000-0000-0000-0000-000000008304', 'FA Otro Cliente', true);
insert into public.talleres_moviles (id, nombre)
values ('00000000-0000-0000-0000-000000008310', 'FA Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000008310', '00000000-0000-0000-0000-000000008303');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000008320', '00000000-0000-0000-0000-000000008301', 'FA Yacimiento', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000008324', '00000000-0000-0000-0000-000000008304', 'FA Yacimiento ajeno', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000008321', '00000000-0000-0000-0000-000000008320', 'FA Planta'),
  ('00000000-0000-0000-0000-000000008325', '00000000-0000-0000-0000-000000008324', 'FA Planta ajena');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000008322', '00000000-0000-0000-0000-000000008321', 'FA Equipo 1'),
  ('00000000-0000-0000-0000-000000008323', '00000000-0000-0000-0000-000000008321', 'FA Equipo 2'),
  ('00000000-0000-0000-0000-000000008326', '00000000-0000-0000-0000-000000008325', 'FA Equipo ajeno');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000008330', '00000000-0000-0000-0000-000000008322', 'V-FA-1'),
  ('00000000-0000-0000-0000-000000008331', '00000000-0000-0000-0000-000000008323', 'V-FA-2'),
  ('00000000-0000-0000-0000-000000008332', '00000000-0000-0000-0000-000000008323', 'V-FA-3'),
  ('00000000-0000-0000-0000-000000008333', '00000000-0000-0000-0000-000000008326', 'V-FA-AJENA');

create function public.test_fa_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_fa_set_actor(uuid) to service_role;

create function public.test_fa_add_operation(operation uuid, work_order uuid, valve uuid)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'operation_id', operation, 'idempotency_key', operation,
    'kind', 'add_work_order', 'schema_version', 2, 'device_timestamp', '2099-08-01T12:10:00Z',
    'payload', jsonb_build_object('work_order_id', work_order, 'valvula_id', valve)
  ))
$$;
grant execute on function public.test_fa_add_operation(uuid, uuid, uuid) to service_role;

select has_function('public', 'api_add_work_order_with_id', array['uuid', 'uuid', 'uuid']::text[], 'the field work-order RPC with a device id exists');
select is(has_function_privilege('authenticated', 'public.api_add_work_order_with_id(uuid,uuid,uuid)', 'execute'), false, 'browser roles cannot call the field work-order RPC');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Visita A (en curso) sobre el Equipo 1 y visita B (aceptada, sin iniciar) sobre otra válvula del Equipo 2.
select public.test_fa_set_actor('00000000-0000-0000-0000-000000008302');
select set_config('app.fa_visit_a', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000008301'::uuid, '00000000-0000-0000-0000-000000008320'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000008322"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000008310'::uuid, '2099-08-01 12:00:00+00'::timestamptz, '2099-08-01 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select set_config('app.fa_visit_b', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000008301'::uuid, '00000000-0000-0000-0000-000000008320'::uuid,
  '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000008332"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000008310'::uuid, '2099-08-02 12:00:00+00'::timestamptz, '2099-08-02 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select public.test_fa_set_actor('00000000-0000-0000-0000-000000008303');
select public.api_accept_visit(current_setting('app.fa_visit_a')::uuid);
select public.api_accept_visit(current_setting('app.fa_visit_b')::uuid);
select public.api_start_visit(current_setting('app.fa_visit_a')::uuid);

-- Caso feliz: la válvula V-FA-2 se agrega por lote con el id de orden del dispositivo.
select set_config('app.fa_batch', public.api_sync_visit_batch(
  current_setting('app.fa_visit_a')::uuid,
  public.test_fa_add_operation('00000000-0000-0000-0000-000000008360', '00000000-0000-0000-0000-000000008340', '00000000-0000-0000-0000-000000008331'),
  '00000000-0000-0000-0000-000000008350'::uuid
)::text, true);
select is(current_setting('app.fa_batch')::jsonb#>>'{operations,0,estado}', 'sincronizada', 'an offline add_work_order operation synchronizes on an in-progress visit');
select ok(exists (
  select 1 from public.ordenes_trabajo
  where id = '00000000-0000-0000-0000-000000008340'
    and visita_id = current_setting('app.fa_visit_a')::uuid
    and valvula_id = '00000000-0000-0000-0000-000000008331'
), 'the work order keeps the id generated on the device');
select is(current_setting('app.fa_batch')::jsonb#>>'{operations,0,result,work_order,valvula_nombre}', 'V-FA-2', 'the result carries the valve name for the panel');
select ok(exists (
  select 1 from public.visita_equipos
  where visita_id = current_setting('app.fa_visit_a')::uuid and equipo_id = '00000000-0000-0000-0000-000000008323'
), 'the added valve claims its equipment for the visit');

-- Idempotencia: reenviar la misma operación o una nueva con el mismo id de orden no duplica.
select is(public.api_sync_visit_batch(
  current_setting('app.fa_visit_a')::uuid,
  public.test_fa_add_operation('00000000-0000-0000-0000-000000008360', '00000000-0000-0000-0000-000000008340', '00000000-0000-0000-0000-000000008331'),
  '00000000-0000-0000-0000-000000008350'::uuid
)#>>'{operations,0,estado}', 'sincronizada', 'replaying the same operation returns the stored acknowledgement');
select is(public.api_sync_visit_batch(
  current_setting('app.fa_visit_a')::uuid,
  public.test_fa_add_operation('00000000-0000-0000-0000-000000008361', '00000000-0000-0000-0000-000000008340', '00000000-0000-0000-0000-000000008331'),
  '00000000-0000-0000-0000-000000008350'::uuid
)#>>'{operations,0,result,work_order,id}', '00000000-0000-0000-0000-000000008340', 'a new operation with the same work-order id returns the existing order');
select is((select count(*) from public.ordenes_trabajo
  where visita_id = current_setting('app.fa_visit_a')::uuid and valvula_id = '00000000-0000-0000-0000-000000008331'), 1::bigint,
  'retrying never duplicates the work order');
select throws_ok(
  $$select public.api_add_work_order_with_id(current_setting('app.fa_visit_a')::uuid, '00000000-0000-0000-0000-000000008330'::uuid, '00000000-0000-0000-0000-000000008340'::uuid)$$,
  '23514', 'The work order id is already used by another Orden de trabajo', 'a work-order id cannot be reused for another valve'
);
select throws_ok(
  $$select public.api_add_work_order_with_id(current_setting('app.fa_visit_a')::uuid, '00000000-0000-0000-0000-000000008333'::uuid, '00000000-0000-0000-0000-000000008342'::uuid)$$,
  '42501', 'An added Válvula must belong to the same Cliente', 'a valve from another Cliente cannot be added'
);

-- Conflicto: la visita B todavía no está en curso.
select set_config('app.fa_conflict_batch', public.api_sync_visit_batch(
  current_setting('app.fa_visit_b')::uuid,
  public.test_fa_add_operation('00000000-0000-0000-0000-000000008362', '00000000-0000-0000-0000-000000008341', '00000000-0000-0000-0000-000000008330'),
  '00000000-0000-0000-0000-000000008351'::uuid
)::text, true);
select is(current_setting('app.fa_conflict_batch')::jsonb#>>'{operations,0,estado}', 'conflicto', 'adding a valve to a visit that is not in progress becomes a conflict');
select ok(exists (
  select 1 from public.conflictos_sync
  where operation_id = '00000000-0000-0000-0000-000000008362' and resolved_at is null
), 'the conflict keeps the original payload for the Administrador');

-- El Administrador acepta el conflicto una vez iniciada la visita. Un taller atiende una visita a la
-- vez (decisión (e)): A deja de estar en curso por el cierre automático (se simula que empezó ayer)
-- antes de que B inicie.
update public.visitas_servicio set started_at = now() - interval '1 day'
where id = current_setting('app.fa_visit_a')::uuid;
select public.close_expired_visits();
select public.api_start_visit(current_setting('app.fa_visit_b')::uuid);
select public.test_fa_set_actor('00000000-0000-0000-0000-000000008302');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-000000008362'),
  'accept', 'La visita ya está en curso'
)->>'resolution', 'accepted', 'an Administrador can accept an add_work_order conflict');
select ok(exists (
  select 1 from public.ordenes_trabajo
  where id = '00000000-0000-0000-0000-000000008341' and visita_id = current_setting('app.fa_visit_b')::uuid
), 'accepting the conflict creates the work order with the device id');

-- Working set: el catálogo del Cliente viaja con la visita para el buscador sin conexión.
select public.test_fa_set_actor('00000000-0000-0000-0000-000000008303');
select set_config('app.fa_ws', public.api_offline_working_set_for_device('00000000-0000-0000-0000-000000008352'::uuid)::text, true);
select ok(
  (select bool_or(entry->'client_yacimientos' @> jsonb_build_array(jsonb_build_object(
    'yacimiento', jsonb_build_object('id', '00000000-0000-0000-0000-000000008320'),
    'valvulas', jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-000000008331'))
  )))
  from jsonb_array_elements(current_setting('app.fa_ws')::jsonb->'visits') entry),
  'the device working set carries the Cliente valve catalog'
);
select ok(
  not (select bool_or(entry->'client_yacimientos' @> jsonb_build_array(jsonb_build_object(
    'yacimiento', jsonb_build_object('id', '00000000-0000-0000-0000-000000008324')
  )))
  from jsonb_array_elements(current_setting('app.fa_ws')::jsonb->'visits') entry),
  'the working set leaves out yacimientos of other Clientes'
);

select * from finish();
rollback;

begin;

-- A2 + A3b (#91): alta en campo de una válvula nueva, con su revisión y su orden de trabajo, en una
-- transacción; UUID del dispositivo e idempotente; exige visita en curso, taller asignado y acceso
-- al yacimiento (sirve otro yacimiento del mismo Cliente); no crea equipos.
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009101', 'fc-client@example.test'),
  ('00000000-0000-0000-0000-000000009102', 'fc-admin@example.test'),
  ('00000000-0000-0000-0000-000000009103', 'fc-technician@example.test'),
  ('00000000-0000-0000-0000-000000009104', 'fc-other-technician@example.test'),
  ('00000000-0000-0000-0000-000000009105', 'fc-other-client@example.test');

insert into public.cuentas (id, rol, estado) values
  ('00000000-0000-0000-0000-000000009101', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000009102', 'administrador_regular', 'activa'),
  ('00000000-0000-0000-0000-000000009103', 'taller_movil', 'activa'),
  ('00000000-0000-0000-0000-000000009104', 'taller_movil', 'activa'),
  ('00000000-0000-0000-0000-000000009105', 'cliente', 'activa');
insert into public.clientes (cuenta_id, nombre, activo) values
  ('00000000-0000-0000-0000-000000009101', 'FC Cliente', true),
  ('00000000-0000-0000-0000-000000009105', 'FC Otro Cliente', true);
insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000009110', 'FC Taller'),
  ('00000000-0000-0000-0000-000000009111', 'FC Taller ajeno');
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000009110', '00000000-0000-0000-0000-000000009103'),
  ('00000000-0000-0000-0000-000000009111', '00000000-0000-0000-0000-000000009104');

-- Y1: el de la visita. Y2: del mismo Cliente, con acceso del taller. Y3: del mismo Cliente, sin
-- acceso. Y4: de otro Cliente.
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000009120', '00000000-0000-0000-0000-000000009101', 'FC Y1', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000009123', '00000000-0000-0000-0000-000000009101', 'FC Y2', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000009126', '00000000-0000-0000-0000-000000009101', 'FC Y3', 'Neuquen', 'Operadora', 'Contratista'),
  ('00000000-0000-0000-0000-000000009140', '00000000-0000-0000-0000-000000009105', 'FC Y4', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000009121', '00000000-0000-0000-0000-000000009120', 'FC Planta 1'),
  ('00000000-0000-0000-0000-000000009124', '00000000-0000-0000-0000-000000009123', 'FC Planta 2'),
  ('00000000-0000-0000-0000-000000009127', '00000000-0000-0000-0000-000000009126', 'FC Planta 3'),
  ('00000000-0000-0000-0000-000000009141', '00000000-0000-0000-0000-000000009140', 'FC Planta 4');
insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000009122', '00000000-0000-0000-0000-000000009121', 'FC Equipo 1'),
  ('00000000-0000-0000-0000-000000009125', '00000000-0000-0000-0000-000000009124', 'FC Equipo 2'),
  ('00000000-0000-0000-0000-000000009128', '00000000-0000-0000-0000-000000009127', 'FC Equipo 3'),
  ('00000000-0000-0000-0000-000000009142', '00000000-0000-0000-0000-000000009141', 'FC Equipo 4');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000009130', '00000000-0000-0000-0000-000000009122', 'V-FC-1'),
  ('00000000-0000-0000-0000-000000009131', '00000000-0000-0000-0000-000000009125', 'V-FC-2');

create function public.test_fc_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_fc_set_actor(uuid) to service_role;

create function public.test_fc_create_operation(operation uuid, valve uuid, equipo uuid, work_order uuid, tag text)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'operation_id', operation, 'idempotency_key', operation,
    'kind', 'create_valve', 'schema_version', 2, 'device_timestamp', '2099-09-01T12:10:00Z',
    'payload', jsonb_build_object(
      'work_order_id', work_order, 'valvula_id', valve, 'equipo_id', equipo,
      'valvula', jsonb_build_object('nombre', tag, 'servicio', 'GAS')
    )
  ))
$$;
grant execute on function public.test_fc_create_operation(uuid, uuid, uuid, uuid, text) to service_role;

select has_function('public', 'api_technician_create_valvula', array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb']::text[], 'the field valve creation RPC exists');
select is(has_function_privilege('authenticated', 'public.api_technician_create_valvula(uuid,uuid,uuid,uuid,jsonb)', 'execute'), false, 'browser roles cannot create valves from the field');

select set_config('app.fc_equipos', (select count(*) from public.equipos_unidades)::text, true);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Visita A (Y1, en curso) y visita B (Y2, aceptada y sin iniciar: da acceso del taller a Y2).
select public.test_fc_set_actor('00000000-0000-0000-0000-000000009102');
select set_config('app.fc_visit_a', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000009101'::uuid, '00000000-0000-0000-0000-000000009120'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000009122"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000009110'::uuid, '2099-09-01 12:00:00+00'::timestamptz, '2099-09-01 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select set_config('app.fc_visit_b', public.api_admin_create_service_request_with_visit(
  '00000000-0000-0000-0000-000000009101'::uuid, '00000000-0000-0000-0000-000000009123'::uuid,
  '[{"kind":"equipo","id":"00000000-0000-0000-0000-000000009125"}]'::jsonb, '{}'::jsonb,
  '00000000-0000-0000-0000-000000009110'::uuid, '2099-09-02 12:00:00+00'::timestamptz, '2099-09-02 13:00:00+00'::timestamptz
)->'scheduled_visit'->'visit'->>'id', true);
select public.test_fc_set_actor('00000000-0000-0000-0000-000000009103');
select public.api_accept_visit(current_setting('app.fc_visit_a')::uuid);
select public.api_accept_visit(current_setting('app.fc_visit_b')::uuid);
select public.api_start_visit(current_setting('app.fc_visit_a')::uuid);

-- Caso feliz: válvula, revisión y orden en una sola llamada, con los ids del dispositivo.
select is(public.api_technician_create_valvula(
  current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009150'::uuid,
  '00000000-0000-0000-0000-000000009122'::uuid, '00000000-0000-0000-0000-000000009160'::uuid,
  '{"nombre":"PSV-NUEVA","marca":"Crosby","numero_serie":"SN-1","tipo":"CONVENCIONAL","presion_operacion":"12,5","temperatura_operacion":""}'::jsonb
)#>>'{work_order,id}', '00000000-0000-0000-0000-000000009160', 'a Técnico creates a valve and its work order with device ids');
select ok(exists (
  select 1 from public.valvulas
  where id = '00000000-0000-0000-0000-000000009150' and equipo_id = '00000000-0000-0000-0000-000000009122'
    and nombre = 'PSV-NUEVA' and marca = 'Crosby' and numero_serie = 'SN-1' and tipo = 'CONVENCIONAL'
    and presion_operacion = 12.5 and temperatura_operacion is null
), 'the valve keeps the same data the Administrador loads');
select is((select count(*) from public.valvula_revisiones where valvula_id = '00000000-0000-0000-0000-000000009150'), 1::bigint, 'the valve gets its first revision');
select ok(exists (
  select 1 from public.ordenes_trabajo
  where id = '00000000-0000-0000-0000-000000009160' and visita_id = current_setting('app.fc_visit_a')::uuid
    and valvula_id = '00000000-0000-0000-0000-000000009150'
), 'the work order is added to the visit');
select ok(exists (
  select 1 from public.historial_relaciones
  where relacion_id = '00000000-0000-0000-0000-000000009150' and datos->>'source' = 'field' and datos->>'kind' = 'valvula'
), 'the hierarchy history records the field creation');

-- Idempotencia: reintentar con el mismo UUID no duplica nada.
select is(public.api_technician_create_valvula(
  current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009150'::uuid,
  '00000000-0000-0000-0000-000000009122'::uuid, '00000000-0000-0000-0000-000000009160'::uuid,
  '{"nombre":"PSV-NUEVA","marca":"Crosby"}'::jsonb
)#>>'{work_order,id}', '00000000-0000-0000-0000-000000009160', 'retrying the creation returns the same work order');
select ok(
  (select count(*) from public.valvulas where id = '00000000-0000-0000-0000-000000009150') = 1
  and (select count(*) from public.valvula_revisiones where valvula_id = '00000000-0000-0000-0000-000000009150') = 1
  and (select count(*) from public.ordenes_trabajo where valvula_id = '00000000-0000-0000-0000-000000009150') = 1,
  'retrying never duplicates the valve, its revision, or its work order'
);

-- Otro yacimiento del mismo Cliente con acceso del taller.
select is(public.api_technician_create_valvula(
  current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009151'::uuid,
  '00000000-0000-0000-0000-000000009125'::uuid, '00000000-0000-0000-0000-000000009161'::uuid,
  '{"nombre":"PSV-Y2"}'::jsonb
)#>>'{work_order,valvula_id}', '00000000-0000-0000-0000-000000009151', 'a valve can be created in another accessible Yacimiento of the same Cliente');

-- Rechazos.
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009152'::uuid, '00000000-0000-0000-0000-000000009128'::uuid, '00000000-0000-0000-0000-000000009162'::uuid, '{"nombre":"PSV-Y3"}'::jsonb)$$,
  '42501', 'The Taller Móvil requires active Yacimiento access', 'a Yacimiento without Taller access is rejected'
);
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009153'::uuid, '00000000-0000-0000-0000-000000009142'::uuid, '00000000-0000-0000-0000-000000009163'::uuid, '{"nombre":"PSV-Y4"}'::jsonb)$$,
  '42501', 'A created Válvula must belong to the visit Cliente', 'an Equipo of another Cliente is rejected'
);
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009154'::uuid, '00000000-0000-0000-0000-000000009199'::uuid, '00000000-0000-0000-0000-000000009164'::uuid, '{"nombre":"PSV-X"}'::jsonb)$$,
  'P0002', 'Equipo not found', 'an unknown Equipo is rejected (Equipos are not created from the field)'
);
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_b')::uuid, '00000000-0000-0000-0000-000000009155'::uuid, '00000000-0000-0000-0000-000000009125'::uuid, '00000000-0000-0000-0000-000000009165'::uuid, '{"nombre":"PSV-B"}'::jsonb)$$,
  '42501', 'Válvulas can be created only while the visit is in progress', 'a visit that is not in progress is rejected'
);
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009156'::uuid, '00000000-0000-0000-0000-000000009122'::uuid, '00000000-0000-0000-0000-000000009166'::uuid, '{"nombre":"PSV-NUM","presion_operacion":"doce"}'::jsonb)$$,
  '22023', 'Operating pressure and temperature must be numbers', 'operating values must be numbers'
);
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009157'::uuid, '00000000-0000-0000-0000-000000009122'::uuid, '00000000-0000-0000-0000-000000009167'::uuid, '{"nombre":"  "}'::jsonb)$$,
  '22023', 'Asset name or tag must be alphanumeric', 'the TAG is required'
);
select public.test_fc_set_actor('00000000-0000-0000-0000-000000009104');
select throws_ok(
  $$select public.api_technician_create_valvula(current_setting('app.fc_visit_a')::uuid, '00000000-0000-0000-0000-000000009158'::uuid, '00000000-0000-0000-0000-000000009122'::uuid, '00000000-0000-0000-0000-000000009168'::uuid, '{"nombre":"PSV-AJENA"}'::jsonb)$$,
  '42501', 'Only the assigned Taller Móvil can execute this visit', 'a Taller not assigned to the visit is rejected'
);

-- Lote offline: `create_valve` sincroniza en una visita en curso y queda en conflicto si no.
select public.test_fc_set_actor('00000000-0000-0000-0000-000000009103');
select is(public.api_sync_visit_batch(
  current_setting('app.fc_visit_a')::uuid,
  public.test_fc_create_operation('00000000-0000-0000-0000-000000009170', '00000000-0000-0000-0000-000000009159', '00000000-0000-0000-0000-000000009122', '00000000-0000-0000-0000-000000009169', 'PSV-LOTE'),
  '00000000-0000-0000-0000-000000009180'::uuid
)#>>'{operations,0,estado}', 'sincronizada', 'an offline create_valve operation synchronizes');
select is(public.api_sync_visit_batch(
  current_setting('app.fc_visit_b')::uuid,
  public.test_fc_create_operation('00000000-0000-0000-0000-000000009171', '00000000-0000-0000-0000-00000000915a', '00000000-0000-0000-0000-000000009125', '00000000-0000-0000-0000-00000000916a', 'PSV-CONFLICTO'),
  '00000000-0000-0000-0000-000000009181'::uuid
)#>>'{operations,0,estado}', 'conflicto', 'create_valve on a visit that is not in progress becomes a conflict');
-- Un taller atiende una visita a la vez (decisión (e)): A deja de estar en curso por el cierre
-- automático (se simula que empezó ayer) antes de que B inicie.
update public.visitas_servicio set started_at = now() - interval '1 day'
where id = current_setting('app.fc_visit_a')::uuid;
select public.close_expired_visits();
select public.api_start_visit(current_setting('app.fc_visit_b')::uuid);
select public.test_fc_set_actor('00000000-0000-0000-0000-000000009102');
select is(public.api_resolve_sync_conflict(
  (select id from public.conflictos_sync where operation_id = '00000000-0000-0000-0000-000000009171'),
  'accept', 'La visita ya está en curso'
)#>>'{operation_result,work_order,id}', '00000000-0000-0000-0000-00000000916a', 'an Administrador can accept a create_valve conflict');

reset role;
select is((select count(*) from public.equipos_unidades)::text, current_setting('app.fc_equipos'), 'no Equipo is created from the field');

select * from finish();
rollback;

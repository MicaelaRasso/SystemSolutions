begin;

select plan(66);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001101', 'operations-contract-admin@example.test'),
  ('00000000-0000-0000-0000-000000001102', 'operations-contract-client-a@example.test'),
  ('00000000-0000-0000-0000-000000001103', 'operations-contract-client-b@example.test'),
  ('00000000-0000-0000-0000-000000001104', 'operations-contract-tech-a@example.test'),
  ('00000000-0000-0000-0000-000000001105', 'operations-contract-tech-b@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000001101', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000001102', 'cliente'),
  ('00000000-0000-0000-0000-000000001103', 'cliente'),
  ('00000000-0000-0000-0000-000000001104', 'taller_movil'),
  ('00000000-0000-0000-0000-000000001105', 'taller_movil');

insert into public.clientes (cuenta_id, nombre, razon_social) values
  ('00000000-0000-0000-0000-000000001102', 'Cliente Contract A', 'Cliente Contract A Servicios'),
  ('00000000-0000-0000-0000-000000001103', 'Cliente Contract B', 'Cliente Contract B Servicios');

insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000001121', 'Taller Contract Norte'),
  ('00000000-0000-0000-0000-000000001122', 'Taller Contract Sur');

insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000001121', '00000000-0000-0000-0000-000000001104'),
  ('00000000-0000-0000-0000-000000001122', '00000000-0000-0000-0000-000000001105');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001102', 'Yacimiento Contract Alpha', 'Neuquen', 'Operadora A', 'Contratista A'),
  ('00000000-0000-0000-0000-000000001132', '00000000-0000-0000-0000-000000001103', 'Yacimiento Contract Beta', 'Mendoza', 'Operadora B', 'Contratista B');

insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000001141', '00000000-0000-0000-0000-000000001131', 'Planta Contract Alpha'),
  ('00000000-0000-0000-0000-000000001142', '00000000-0000-0000-0000-000000001132', 'Planta Contract Beta');

insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000001151', '00000000-0000-0000-0000-000000001141', 'Equipo Contract Alpha'),
  ('00000000-0000-0000-0000-000000001152', '00000000-0000-0000-0000-000000001142', 'Equipo Contract Beta');

insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000001161', '00000000-0000-0000-0000-000000001151', 'TAG-CONTRACT-01'),
  ('00000000-0000-0000-0000-000000001162', '00000000-0000-0000-0000-000000001151', 'TAG-CONTRACT-02'),
  ('00000000-0000-0000-0000-000000001163', '00000000-0000-0000-0000-000000001151', 'TAG-CONTRACT-03'),
  ('00000000-0000-0000-0000-000000001164', '00000000-0000-0000-0000-000000001152', 'TAG-CONTRACT-BETA');

insert into public.solicitudes_servicio (id, numero_solicitud, yacimiento_id, cliente_cuenta_id, metadata) values
  ('00000000-0000-0000-0000-000000001171', 11001, '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001102', '{"contacto":"Ana Contract","tipo":"Certificacion","condiciones":["acceso"],"adjuntos":[]}'),
  ('00000000-0000-0000-0000-000000001172', 11002, '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001102', '{"contacto":"Ana Contract","tipo":"Mantenimiento"}'),
  ('00000000-0000-0000-0000-000000001173', 11003, '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001102', '{"contacto":"Ana Contract"}'),
  ('00000000-0000-0000-0000-000000001174', 11004, '00000000-0000-0000-0000-000000001132', '00000000-0000-0000-0000-000000001103', '{"contacto":"Beto Contract"}');

insert into public.solicitud_valvulas (solicitud_id, valvula_id) values
  ('00000000-0000-0000-0000-000000001171', '00000000-0000-0000-0000-000000001161'),
  ('00000000-0000-0000-0000-000000001172', '00000000-0000-0000-0000-000000001162'),
  ('00000000-0000-0000-0000-000000001173', '00000000-0000-0000-0000-000000001163'),
  ('00000000-0000-0000-0000-000000001174', '00000000-0000-0000-0000-000000001164');

insert into public.asignaciones_servicio (id, yacimiento_id, taller_movil_id, solicitud_id) values
  ('00000000-0000-0000-0000-000000001181', '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001121', '00000000-0000-0000-0000-000000001171'),
  ('00000000-0000-0000-0000-000000001182', '00000000-0000-0000-0000-000000001132', '00000000-0000-0000-0000-000000001122', '00000000-0000-0000-0000-000000001174');

insert into public.visitas_servicio (id, solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado, accepted_at) values
  ('00000000-0000-0000-0000-000000001191', '00000000-0000-0000-0000-000000001171', '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001121', '2026-10-02 00:30:00+00', '2026-10-02 03:30:00+00', 'aceptada', '2026-09-30 12:00:00+00'),
  ('00000000-0000-0000-0000-000000001192', '00000000-0000-0000-0000-000000001172', '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001121', '2026-10-02 03:30:00+00', '2026-10-02 06:30:00+00', 'programada', null),
  ('00000000-0000-0000-0000-000000001193', '00000000-0000-0000-0000-000000001173', '00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001121', '2026-10-02 23:00:00+00', '2026-10-03 02:00:00+00', 'en_curso', '2026-09-30 12:00:00+00'),
  ('00000000-0000-0000-0000-000000001194', '00000000-0000-0000-0000-000000001174', '00000000-0000-0000-0000-000000001132', '00000000-0000-0000-0000-000000001122', '2026-10-04 12:00:00+00', '2026-10-04 13:00:00+00', 'programada', null);

insert into public.ordenes_trabajo (id, visita_id, valvula_id) values
  ('00000000-0000-0000-0000-000000001201', '00000000-0000-0000-0000-000000001191', '00000000-0000-0000-0000-000000001161'),
  ('00000000-0000-0000-0000-000000001202', '00000000-0000-0000-0000-000000001192', '00000000-0000-0000-0000-000000001162'),
  ('00000000-0000-0000-0000-000000001203', '00000000-0000-0000-0000-000000001193', '00000000-0000-0000-0000-000000001163'),
  ('00000000-0000-0000-0000-000000001204', '00000000-0000-0000-0000-000000001194', '00000000-0000-0000-0000-000000001164');

create function public.test_set_operations_contract_actor(target uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.headers',
    jsonb_build_object('x-systemsolutions-actor-id', target)::text,
    true
  );
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_set_operations_contract_actor(uuid) to service_role;

select has_function('public', 'api_operations', ARRAY['date','date','text','uuid','uuid','text','integer','integer']::text[], 'the canonical paginated operation list RPC exists');
select has_function('public', 'api_operation', ARRAY['uuid']::text[], 'the canonical visit-keyed operation detail RPC exists');
select is(
  array(
    select enum_value::text
    from unnest(enum_range(null::public.estado_visita)) with ordinality as enum_values(enum_value, position)
    order by position
  ),
  ARRAY['solicitada', 'programada', 'aceptada', 'en_curso', 'completada', 'cancelada']::text[],
  'estado_visita retains the canonical values in order'
);
select has_index('public', 'visitas_servicio', 'visitas_servicio_starts_at_idx', 'visitas_servicio has an explicit starts_at index');
select has_index('public', 'visitas_servicio', 'visitas_servicio_estado_starts_at_idx', 'visitas_servicio has an estado, starts_at index');
select has_index('public', 'visitas_servicio', 'visitas_servicio_taller_starts_at_id_idx', 'visitas_servicio has a taller_movil_id, starts_at index');
select has_index('public', 'visitas_servicio', 'visitas_servicio_yacimiento_id_starts_at_idx', 'visitas_servicio has a yacimiento_id, starts_at index');
select has_index('public', 'solicitudes_servicio', 'solicitudes_servicio_cliente_id_idx', 'solicitudes_servicio has a cliente_cuenta_id index');
select is(has_function('public', 'api_operations', ARRAY['date','date','text','uuid','uuid','text']::text[], 'legacy request-shaped list'), false, 'the legacy non-paginated operation list overload is absent');
select is(has_function_privilege('anon', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'), false, 'anonymous callers cannot execute operation lists');
select is(has_function_privilege('authenticated', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'), false, 'authenticated callers cannot execute operation lists directly');
select is(has_function_privilege('anon', 'public.api_operation(uuid)', 'execute'), false, 'anonymous callers cannot execute operation details');
select is(has_function_privilege('authenticated', 'public.api_operation(uuid)', 'execute'), false, 'authenticated callers cannot execute operation details directly');
select is(has_function_privilege('service_role', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'), true, 'service_role can execute operation lists');
select is(has_function_privilege('service_role', 'public.api_operation(uuid)', 'execute'), true, 'service_role can execute operation details');
select is(has_function_privilege('service_role', 'public.api_operation_row(uuid)', 'execute'), false, 'the historical request-keyed helper is outside the operations read API');
select is(has_function_privilege('service_role', 'public.api_create_operation(uuid,uuid,text,uuid,jsonb,uuid,timestamptz,timestamptz)', 'execute'), false, 'the historical operation create helper is outside the operations read API');
select is(has_function_privilege('service_role', 'public.api_update_operation(uuid,jsonb,uuid,timestamptz,timestamptz)', 'execute'), false, 'the historical operation update helper is outside the operations read API');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_set_operations_contract_actor('00000000-0000-0000-0000-000000001101');

select is((public.api_operations(null, null, null, null, null, null, 100, 0)->>'total')::bigint, 4::bigint, 'the envelope total contains visits only and excludes the unscheduled request');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'), 1, 'the envelope contains the requested page size');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'id', '00000000-0000-0000-0000-000000001191', 'the list is ordered by starts_at then visit id');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'estado', 'aceptada', 'the summary exposes the canonical Visita status');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'solicitud_id', '00000000-0000-0000-0000-000000001171', 'the summary exposes the canonical Solicitud id');
select is((public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'numero_solicitud')::bigint, 11001::bigint, 'the summary exposes the canonical Solicitud number');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'starts_at', '2026-10-02T00:30:00+00:00'::jsonb, 'the summary exposes the visit start timestamp');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'ends_at', '2026-10-02T03:30:00+00:00'::jsonb, 'the summary exposes the visit end timestamp');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'cliente'->>'nombre', 'Cliente Contract A Servicios', 'the summary nests the Cliente identity');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'yacimiento', '{"id":"00000000-0000-0000-0000-000000001131","nombre":"Yacimiento Contract Alpha"}'::jsonb, 'the summary nests the Yacimiento identity');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'taller_movil'->>'id', '00000000-0000-0000-0000-000000001121', 'the summary nests the Taller Móvil identity');
select is(public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->'ordenes', '{"total":1,"pendientes":1,"evaluadas":0,"no_evaluadas":0}'::jsonb, 'the summary aggregates Orden de trabajo states');
select is((public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0 ? 'empresa_id'), false, 'the summary has no legacy Empresa alias');
select is(public.api_operations(null, null, null, null, null, null, 100, 0)->>'has_more', 'false', 'the envelope reports whether another page exists');
select is((public.api_operations(null, null, null, null, null, null, 100, 0)->>'limit')::integer, 100, 'the envelope reports the applied limit');
select is((public.api_operations(null, null, null, null, null, null, 100, 0)->>'offset')::integer, 0, 'the envelope reports the applied offset');
select is(jsonb_array_length(public.api_operations('2026-10-01', '2026-10-01', null, null, null, null, 100, 0)->'items'), 1, 'a visit crossing into the next local day overlaps the from date');
select is(jsonb_array_length(public.api_operations('2026-10-02', '2026-10-02', null, null, null, null, 100, 0)->'items'), 3, 'date filters use local-day interval overlap');
select throws_ok($$select count(*) from public.api_operations('2026-10-03', '2026-10-02', null, null, null, null, 100, 0)$$, '22023', 'from_date must not be after to_date', 'inverted date filters are rejected');
select throws_ok($$select public.api_operations(null, null, 'asignada', null, null, null, 100, 0)$$, '22023', 'status_filter must contain only canonical Visita statuses', 'Tarea status aliases are rejected');
select throws_ok($$select public.api_operations(null, null, 'pendiente', null, null, null, 100, 0)$$, '22023', 'status_filter must contain only canonical Visita statuses', 'the pending alias is rejected');
select is(jsonb_array_length(public.api_operations(null, null, 'programada', null, null, null, 100, 0)->'items'), 1, 'status filtering accepts the canonical visit status');
select is(jsonb_array_length(public.api_operations(null, null, null, '00000000-0000-0000-0000-000000001121', null, null, 100, 0)->'items'), 3, 'workshop filtering uses the assigned Taller Móvil');
select is(jsonb_array_length(public.api_operations(null, null, null, null, '00000000-0000-0000-0000-000000001103', null, 100, 0)->'items'), 1, 'client filtering uses the Solicitud Cliente');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, '11002', 100, 0)->'items'), 1, 'search matches the request number');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Taller Contract Norte', 100, 0)->'items'), 3, 'search matches the Taller Móvil name');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'TAG-CONTRACT-03', 100, 0)->'items'), 1, 'search matches a Válvula tag');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Cliente Contract B Servicios', 100, 0)->'items'), 1, 'search matches the Cliente name');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Yacimiento Contract Alpha', 100, 0)->'items'), 3, 'search matches the Yacimiento name');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Planta Contract Alpha', 100, 0)->'items'), 0, 'search does not match Planta names');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Equipo Contract Alpha', 100, 0)->'items'), 0, 'search does not match Equipo names');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, 'Ana Contract', 100, 0)->'items'), 0, 'search does not match Solicitud metadata');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, null, 500, 0)->'items'), 4, 'the list caps the page size at 100');
select is(public.api_operations(null, null, null, null, null, null, 1, 1)->'items'->0->>'id', '00000000-0000-0000-0000-000000001192', 'offset follows the stable order');
select is(public.api_operation('00000000-0000-0000-0000-000000001192')->'operation'->>'id', '00000000-0000-0000-0000-000000001192', 'detail operation is keyed by the Visita de servicio id');
select is(public.api_operation('00000000-0000-0000-0000-000000001192')->'operation'->>'estado', 'programada', 'detail exposes the canonical Visita status');
select is(public.api_operation('00000000-0000-0000-0000-000000001192')->'request'->'request'->>'id', '00000000-0000-0000-0000-000000001172', 'detail uses the canonical request key');
select is(public.api_operation('00000000-0000-0000-0000-000000001192')->'work_orders'->0->'work_order'->>'id', '00000000-0000-0000-0000-000000001202', 'detail includes the related Orden de trabajo');
select is((public.api_operation('00000000-0000-0000-0000-000000001192') - 'operation' - 'visit' - 'request' - 'work_orders'), '{}'::jsonb, 'detail has exactly the canonical top-level keys');
select throws_ok($$select public.api_operation('00000000-0000-0000-0000-000000001173')$$, 'P0002', 'Operation visit not found', 'detail cannot address an unscheduled Solicitud');
select throws_ok($$select count(*) from public.api_operations(null, null, null, null, null, null, -1, 0)$$, '22023', 'limit must not be negative', 'negative limits are rejected');
select throws_ok($$select count(*) from public.api_operations(null, null, null, null, null, null, 100, -1)$$, '22023', 'offset must not be negative', 'negative offsets are rejected');

select public.test_set_operations_contract_actor('00000000-0000-0000-0000-000000001102');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'), 3, 'a Cliente sees only visits in its own Yacimiento');
select throws_ok($$select public.api_operation('00000000-0000-0000-0000-000000001194')$$, '42501', 'Not authorized', 'a Cliente cannot read another Cliente operation detail');

select public.test_set_operations_contract_actor('00000000-0000-0000-0000-000000001104');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'), 3, 'an assigned Taller Móvil sees only its assigned visits');
select throws_ok($$select public.api_operation('00000000-0000-0000-0000-000000001194')$$, '42501', 'a Taller Móvil cannot read a visit assigned to another Taller Móvil');

select public.test_set_operations_contract_actor('00000000-0000-0000-0000-000000001105');
select is(jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'), 1, 'a second Taller Móvil sees only its assigned visit');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001199', true);
select throws_ok($$select count(*) from public.api_operations(null, null, null, null, null, null, 100, 0)$$, '42501', 'Authentication required', 'the read RPC requires an authenticated Cuenta actor');

select * from extensions.finish(true);

begin;

select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000901', 'operations-admin@example.test'),
  ('00000000-0000-0000-0000-000000000902', 'operations-client-a@example.test'),
  ('00000000-0000-0000-0000-000000000903', 'operations-client-b@example.test'),
  ('00000000-0000-0000-0000-000000000904', 'operations-tech-a@example.test'),
  ('00000000-0000-0000-0000-000000000905', 'operations-tech-b@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000901', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000000902', 'cliente'),
  ('00000000-0000-0000-0000-000000000903', 'cliente'),
  ('00000000-0000-0000-0000-000000000904', 'taller_movil'),
  ('00000000-0000-0000-0000-000000000905', 'taller_movil');

insert into public.clientes (cuenta_id, nombre, razon_social) values
  ('00000000-0000-0000-0000-000000000902', 'Cliente A', 'Cliente A Servicios'),
  ('00000000-0000-0000-0000-000000000903', 'Cliente B', 'Cliente B Servicios');

insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000000921', 'Taller Norte'),
  ('00000000-0000-0000-0000-000000000922', 'Taller Sur');

insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000904'),
  ('00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000905');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista) values
  ('00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000902', 'Yacimiento Alpha', 'Neuquen', 'Operadora A', 'Contratista A'),
  ('00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000903', 'Yacimiento Beta', 'Mendoza', 'Operadora B', 'Contratista B');

insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000931', 'Planta Alpha'),
  ('00000000-0000-0000-0000-000000000942', '00000000-0000-0000-0000-000000000932', 'Planta Beta');

insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000941', 'Equipo Alpha'),
  ('00000000-0000-0000-0000-000000000952', '00000000-0000-0000-0000-000000000942', 'Equipo Beta');

insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000000961', '00000000-0000-0000-0000-000000000951', 'TAG-ALPHA-01'),
  ('00000000-0000-0000-0000-000000000962', '00000000-0000-0000-0000-000000000951', 'TAG-ALPHA-02'),
  ('00000000-0000-0000-0000-000000000963', '00000000-0000-0000-0000-000000000952', 'TAG-BETA-01');

insert into public.solicitudes_servicio (id, numero_solicitud, yacimiento_id, cliente_cuenta_id, metadata) values
  ('00000000-0000-0000-0000-000000000971', 9001, '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000902', '{"contacto":"Ana","tipo":"Certificacion"}'),
  ('00000000-0000-0000-0000-000000000972', 9002, '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000902', '{"contacto":"Ana","tipo":"Mantenimiento"}'),
  ('00000000-0000-0000-0000-000000000973', 9003, '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000902', '{"contacto":"Ana"}'),
  ('00000000-0000-0000-0000-000000000974', 9004, '00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000903', '{"contacto":"Beto"}');

insert into public.solicitud_valvulas (solicitud_id, valvula_id) values
  ('00000000-0000-0000-0000-000000000971', '00000000-0000-0000-0000-000000000961'),
  ('00000000-0000-0000-0000-000000000972', '00000000-0000-0000-0000-000000000962'),
  ('00000000-0000-0000-0000-000000000973', '00000000-0000-0000-0000-000000000961'),
  ('00000000-0000-0000-0000-000000000974', '00000000-0000-0000-0000-000000000963');

insert into public.asignaciones_servicio (id, yacimiento_id, taller_movil_id, solicitud_id) values
  ('00000000-0000-0000-0000-000000000981', '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000971'),
  ('00000000-0000-0000-0000-000000000982', '00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000974');

insert into public.visitas_servicio (id, solicitud_id, yacimiento_id, taller_movil_id, starts_at, ends_at, estado, accepted_at) values
  ('00000000-0000-0000-0000-000000000991', '00000000-0000-0000-0000-000000000971', '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000921', '2026-10-02 02:00:00+00', '2026-10-02 05:00:00+00', 'aceptada', '2026-09-30 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000992', '00000000-0000-0000-0000-000000000972', '00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000921', '2026-10-03 12:00:00+00', '2026-10-03 13:00:00+00', 'programada', null),
  ('00000000-0000-0000-0000-000000000993', '00000000-0000-0000-0000-000000000974', '00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000922', '2026-10-04 12:00:00+00', '2026-10-04 13:00:00+00', 'programada', null);

insert into public.ordenes_trabajo (id, visita_id, valvula_id) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000991', '00000000-0000-0000-0000-000000000961'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000992', '00000000-0000-0000-0000-000000000962'),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000993', '00000000-0000-0000-0000-000000000963');

create function public.test_set_operations_gateway_actor(target uuid)
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
grant execute on function public.test_set_operations_gateway_actor(uuid) to service_role;

select has_function(
  'public',
  'api_operations',
  ARRAY['date','date','text','uuid','uuid','text','integer','integer']::text[],
  'the paginated operation list RPC exists'
);

select has_function(
  'public',
  'api_operation',
  ARRAY['uuid']::text[],
  'the visit-keyed operation detail RPC exists'
);

select is(
  has_function_privilege('anon', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'),
  false,
  'anonymous callers cannot execute operation reads'
);

select is(
  has_function_privilege('authenticated', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'),
  false,
  'authenticated callers cannot execute operation lists directly'
);

select is(
  has_function_privilege('authenticated', 'public.api_operation(uuid)', 'execute'),
  false,
  'authenticated callers cannot execute operation detail directly'
);

select is(
  has_function_privilege('service_role', 'public.api_operation(uuid)', 'execute'),
  true,
  'only service_role can execute operation detail'
);

select is(
  has_function_privilege('service_role', 'public.api_operations(date,date,text,uuid,uuid,text,integer,integer)', 'execute'),
  true,
  'service_role can execute the paginated operation list'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_set_operations_gateway_actor('00000000-0000-0000-0000-000000000901');

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'),
  3,
  'the list contains visits only and excludes the unscheduled request'
);

select is(
  public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'id',
  '00000000-0000-0000-0000-000000000991',
  'OperationSummary id is the Visita de servicio id'
);

select is(
  public.api_operations(null, null, null, null, null, null, 1, 0)->'items'->0->>'starts_at',
  '2026-10-02T02:00:00+00:00',
  'the summary preserves the canonical visit start timestamp'
);

select is(
  jsonb_array_length(public.api_operations('2026-10-02', '2026-10-02', null, null, null, null, 100, 0)->'items'),
  1,
  'date filters use local-day interval overlap rather than start-date equality'
);

select is(
  public.api_operations(null, null, 'programada', null, null, null, 100, 0)->'items'->0->>'id',
  '00000000-0000-0000-0000-000000000992',
  'status filtering accepts the canonical visit status'
);

select throws_ok(
  $$select public.api_operations(null, null, 'asignada', null, null, null, 100, 0)$$,
  '22023',
  'status_filter must contain only canonical Visita statuses',
  'Tarea status aliases are rejected'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, '00000000-0000-0000-0000-000000000922', null, null, 100, 0)->'items'),
  1,
  'workshop_id filters visits by assigned Taller Móvil'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, '00000000-0000-0000-0000-000000000903', null, 100, 0)->'items'),
  1,
  'client_id filters visits by the service Cliente'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, '9002', 100, 0)->'items'),
  1,
  'search matches the request number'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, 'Taller Norte', 100, 0)->'items'),
  2,
  'search matches the Taller name'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, 'TAG-ALPHA-02', 100, 0)->'items'),
  1,
  'search matches a Válvula tag attached to the visit'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, 'Cliente B Servicios', 100, 0)->'items'),
  1,
  'search matches the Cliente name'
);

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, 'Yacimiento Alpha', 100, 0)->'items'),
  2,
  'search matches the Yacimiento name'
);

select is(
  (public.api_operations(null, null, null, null, null, null, 500, 0)->>'total')::integer,
  3,
  'the envelope reports the total before pagination'
);

select is(
  public.api_operations(null, null, null, null, null, null, 1, 1)->'items'->0->>'id',
  '00000000-0000-0000-0000-000000000992',
  'offset follows starts_at ASC, id ASC ordering'
);

select is(
  (public.api_operation('00000000-0000-0000-0000-000000000991')->'visit'->'visit'->>'id'),
  '00000000-0000-0000-0000-000000000991',
  'detail includes a VisitDto keyed by the visit'
);

select is(
  (public.api_operation('00000000-0000-0000-0000-000000000991')->'request'->'request'->>'id'),
  '00000000-0000-0000-0000-000000000971',
  'detail includes the related ServiceRequestDto'
);

select is(
  (public.api_operation('00000000-0000-0000-0000-000000000991')->'work_orders'->0->'work_order'->>'id'),
  '00000000-0000-0000-0000-000000001001',
  'detail includes WorkOrderDetailDto values'
);

select throws_ok(
  $$select public.api_operation('00000000-0000-0000-0000-000000000973')$$,
  'P0002',
  'Operation visit not found',
  'api_operation cannot address a request that has no visit'
);

select public.test_set_operations_gateway_actor('00000000-0000-0000-0000-000000000902');

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'),
  2,
  'a Cliente sees only visits in its own Yacimiento'
);

select throws_ok(
  $$select public.api_operation('00000000-0000-0000-0000-000000000993')$$,
  '42501',
  'Not authorized',
  'a Cliente cannot read another Cliente operation detail'
);

select public.test_set_operations_gateway_actor('00000000-0000-0000-0000-000000000904');

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'),
  2,
  'an assigned Taller Móvil sees only its assigned visits'
);

select public.test_set_operations_gateway_actor('00000000-0000-0000-0000-000000000905');

select is(
  jsonb_array_length(public.api_operations(null, null, null, null, null, null, 100, 0)->'items'),
  1,
  'a second Taller Móvil sees only its own assigned visit'
);

select * from extensions.finish(true);

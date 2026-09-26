begin;

select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000102', 'other-client@example.test'),
  ('00000000-0000-0000-0000-000000000103', 'assigned-tech@example.test'),
  ('00000000-0000-0000-0000-000000000104', 'unassigned-tech@example.test'),
  ('00000000-0000-0000-0000-000000000105', 'admin@example.test'),
  ('00000000-0000-0000-0000-000000000106', 'super-admin@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000101', 'cliente'),
  ('00000000-0000-0000-0000-000000000102', 'cliente'),
  ('00000000-0000-0000-0000-000000000103', 'taller_movil'),
  ('00000000-0000-0000-0000-000000000104', 'taller_movil'),
  ('00000000-0000-0000-0000-000000000105', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000000106', 'super_administrador');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000000101', 'Cliente propietario'),
  ('00000000-0000-0000-0000-000000000102', 'Otro cliente');

insert into public.talleres_moviles (id, nombre) values
  ('00000000-0000-0000-0000-000000000201', 'Taller asignado'),
  ('00000000-0000-0000-0000-000000000202', 'Taller no asignado');

insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000104');

create function public.test_set_gateway_actor(target uuid)
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
grant execute on function public.test_set_gateway_actor(uuid) to service_role;

select is(
  has_function_privilege('anon', 'public.api_context()', 'execute'),
  false,
  'anonymous callers cannot execute business RPCs directly'
);

select is(
  has_function_privilege('authenticated', 'public.api_context()', 'execute'),
  false,
  'authenticated callers cannot execute business RPCs directly'
);

select is(
  has_function_privilege('service_role', 'public.api_context()', 'execute'),
  true,
  'only the server-side service role can execute business RPCs'
);

set local role authenticated;

select throws_ok(
  $$select public.api_context()$$,
  '42501',
  'permission denied for function api_context',
  'an authenticated database role cannot call a business RPC directly'
);

select throws_ok(
  $$select * from public.yacimientos$$,
  '42501',
  'permission denied for table yacimientos',
  'direct table reads are denied to authenticated accounts'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000101');

select lives_ok(
  $$select public.api_create_yacimiento('Yacimiento 01', 'Neuquen', 'Operadora Norte', 'Contratista Sur')$$,
  'the owning Cliente creates a Yacimiento with all required attributes'
);

select is(
  (select provincia from public.api_yacimientos() where nombre = 'Yacimiento 01'),
  'Neuquen',
  'the Yacimiento exposes its province through the authenticated API'
);

select set_config(
  'app.test_yacimiento_id',
  (select id::text from public.api_yacimientos() where nombre = 'Yacimiento 01'),
  true
);

select throws_ok(
  $$select public.api_create_yacimiento('invalid!', 'Neuquen', 'Operadora Norte', 'Contratista Sur')$$,
  '22023',
  'Asset name or tag must be alphanumeric',
  'required Yacimiento names reject non-alphanumeric values'
);

select throws_ok(
  $$select public.api_create_yacimiento('Yacimiento 03', '', 'Operadora Norte', 'Contratista Sur')$$,
  '22023',
  'Provincia is required',
  'blank required Yacimiento attributes are rejected'
);

select is(
  (public.api_create_descendant('planta', current_setting('app.test_yacimiento_id')::uuid, 'Planta 01')->>'nombre'),
  'Planta 01',
  'the owning Cliente creates a Planta/locación beneath its Yacimiento'
);

select set_config(
  'app.test_planta_id',
  public.api_yacimiento_tree(current_setting('app.test_yacimiento_id')::uuid)->'plantas'->0->>'id',
  true
);

select is(
  (public.api_create_descendant('equipo', current_setting('app.test_planta_id')::uuid, 'Equipo 01')->>'nombre'),
  'Equipo 01',
  'the hierarchy accepts an Equipo/unidad only beneath its Planta/locación'
);

select set_config(
  'app.test_equipo_id',
  public.api_yacimiento_tree(current_setting('app.test_yacimiento_id')::uuid)->'equipos'->0->>'id',
  true
);

select is(
  (public.api_create_descendant('valvula', current_setting('app.test_equipo_id')::uuid, 'Valvula 01')->>'nombre'),
  'Valvula 01',
  'the hierarchy accepts a Válvula only beneath its Equipo/unidad'
);

select set_config(
  'app.test_valvula_id',
  public.api_yacimiento_tree(current_setting('app.test_yacimiento_id')::uuid)->'valvulas'->0->>'id',
  true
);

select is(
  (public.api_update_descendant('planta', current_setting('app.test_planta_id')::uuid, 'Planta 02')->>'nombre'),
  'Planta 02',
  'the owning Cliente can edit a descendant without changing its ancestry'
);

select lives_ok(
  $$select public.api_update_yacimiento(
      current_setting('app.test_yacimiento_id')::uuid,
      'Yacimiento 02',
      'Rio Negro',
      'Operadora Centro',
      'Contratista Oeste'
    )$$,
  'the owning Cliente can update all Yacimiento attributes'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000102');

select is(
  (select count(*) from public.api_yacimientos()),
  0::bigint,
  'another Cliente cannot list an unrelated Yacimiento'
);

select throws_ok(
  $$select public.api_update_yacimiento(
      current_setting('app.test_yacimiento_id')::uuid,
      'Changed', 'Rio Negro', 'Operadora Centro', 'Contratista Oeste'
    )$$,
  '42501',
  'Only the owner can change a Yacimiento',
  'another Cliente cannot update an unrelated Yacimiento'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000101');
select set_config(
  'app.test_request_id',
  (public.api_create_service_request(
    current_setting('app.test_yacimiento_id')::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', current_setting('app.test_valvula_id')))
  )->'request'->>'id'),
  true
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000105');

select set_config(
  'app.test_visit_id',
  (public.api_schedule_visit(
    current_setting('app.test_request_id')::uuid,
    '00000000-0000-0000-0000-000000000201'::uuid,
    '2099-01-01 09:00:00+00'::timestamptz,
    '2099-01-01 12:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);

select ok(
  current_setting('app.test_visit_id') <> '',
  'an Administrador schedules a one-Yacimiento visit from the frozen request scope'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000103');

select lives_ok(
  $$select public.api_accept_visit(current_setting('app.test_visit_id')::uuid)$$,
  'the assigned Taller Móvil accepts the scheduled visit'
);

select is(
  (select count(*) from public.api_yacimientos()),
  1::bigint,
  'the assigned Técnico can list the active-assignment Yacimiento'
);

select lives_ok(
  $$select public.api_yacimiento_tree(current_setting('app.test_yacimiento_id')::uuid)$$,
  'the assigned Técnico can read the complete descendant tree'
);

select throws_ok(
  $$select public.api_update_descendant('planta', current_setting('app.test_planta_id')::uuid, 'Unauthorized change')$$,
  '42501',
  'Only the owner can change hierarchy',
  'a Taller Móvil cannot edit the Cliente asset hierarchy'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000104');

select is(
  (select count(*) from public.api_yacimientos()),
  0::bigint,
  'an unassigned Taller Móvil cannot list the Yacimiento'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000101');
select set_config(
  'app.test_reassignment_request_id',
  (public.api_create_service_request(
    current_setting('app.test_yacimiento_id')::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', current_setting('app.test_valvula_id')))
  )->'request'->>'id'),
  true
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000105');
select set_config(
  'app.test_reassignment_visit_id',
  (public.api_schedule_visit(
    current_setting('app.test_reassignment_request_id')::uuid,
    '00000000-0000-0000-0000-000000000202'::uuid,
    '2099-01-02 09:00:00+00'::timestamptz,
    '2099-01-02 12:00:00+00'::timestamptz
  )->'visit'->>'id'),
  true
);

select ok(
  current_setting('app.test_reassignment_visit_id') <> '',
  'an Administrador can schedule the reassignment visit'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000104');

select lives_ok(
  $$select public.api_accept_visit(current_setting('app.test_reassignment_visit_id')::uuid)$$,
  'a newly assigned Taller Móvil can accept a replacement visit'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000103');

select is(
  (select count(*) from public.api_yacimientos()),
  0::bigint,
  'the replaced Taller Móvil loses Yacimiento access'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000105');

select is(
  (select count(*) from public.api_yacimientos()),
  1::bigint,
  'an Administrador regular can list every Yacimiento'
);

select public.test_set_gateway_actor('00000000-0000-0000-0000-000000000106');

select is(
  (select count(*) from public.api_yacimientos()),
  1::bigint,
  'a Super administrador can list every Yacimiento'
);

select is(
  jsonb_array_length((public.api_relationship_history(current_setting('app.test_yacimiento_id')::uuid)->'history'))::bigint,
  12::bigint,
  'asset changes, service requests, scheduling, acceptance, and reassignment preserve relationship history'
);

select * from extensions.finish(true);

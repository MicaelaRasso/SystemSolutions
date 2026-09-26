begin;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000801', 'valve-owner@example.test'),
  ('00000000-0000-0000-0000-000000000802', 'other-owner@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000801', 'cliente'),
  ('00000000-0000-0000-0000-000000000802', 'cliente');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000000801', 'Valve owner'),
  ('00000000-0000-0000-0000-000000000802', 'Other owner');

insert into public.yacimientos (id, cliente_cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000801', 'Field A'),
  ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000802', 'Field B');

insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
  ('00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000811', 'Plant A'),
  ('00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000812', 'Plant B');

insert into public.equipos_unidades (id, planta_id, nombre) values
  ('00000000-0000-0000-0000-000000000831', '00000000-0000-0000-0000-000000000821', 'Equipment A'),
  ('00000000-0000-0000-0000-000000000832', '00000000-0000-0000-0000-000000000822', 'Equipment B');

insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000000841', '00000000-0000-0000-0000-000000000831', 'PSV-1');

create function public.test_set_valve_gateway_actor(target uuid)
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
grant execute on function public.test_set_valve_gateway_actor(uuid) to service_role;

select has_function('public', 'api_valvula', ARRAY['uuid']::text[], 'the valve detail RPC is exposed');
select has_function('public', 'api_update_valvula', ARRAY['uuid','text','text','text','text','text','text','text','text','text','text','text']::text[], 'the valve update RPC accepts all technical fields');
select is(has_function_privilege('anon', 'public.api_update_valvula(uuid,text,text,text,text,text,text,text,text,text,text,text)', 'execute'), false, 'anonymous callers cannot update valve data');
select is(has_function_privilege('authenticated', 'public.api_update_valvula(uuid,text,text,text,text,text,text,text,text,text,text,text)', 'execute'), false, 'authenticated callers cannot bypass the Edge gateway');
select is(has_function_privilege('service_role', 'public.api_update_valvula(uuid,text,text,text,text,text,text,text,text,text,text,text)', 'execute'), true, 'service role can execute the valve update RPC');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_set_valve_gateway_actor('00000000-0000-0000-0000-000000000801');

select is(
  public.api_valvula('00000000-0000-0000-0000-000000000841')->'valve'->'marca',
  'null'::jsonb,
  'technical fields can remain null before they are recorded'
);

select lives_ok(
  $$select public.api_update_valvula(
    '00000000-0000-0000-0000-000000000841', 'PSV-1', 'Acme', 'SN-1', 'Model A',
    'Pilotada', '1 1/2', '300', '2', '150', 'NPT', null
  )$$,
  'an authorized owner can save nullable valve technical data'
);

select is(
  public.api_valvula('00000000-0000-0000-0000-000000000841')->'valve'->>'numero_serie',
  'SN-1',
  'the current valve detail returns updated technical data'
);

select is(
  (public.api_valvula('00000000-0000-0000-0000-000000000841')->'revisions'->0->'datos'->>'marca'),
  'Acme',
  'revision history includes an immutable snapshot of the update'
);

select lives_ok(
  $$select public.api_update_valvula(
    '00000000-0000-0000-0000-000000000841', 'PSV-1', 'Other brand', 'SN-1', 'Model A',
    'Pilotada', '1 1/2', '300', '2', '150', 'NPT', 'not_found'
  )$$,
  'a subsequent update may set an allowed availability reason'
);

select is(
  (public.api_valvula('00000000-0000-0000-0000-000000000841')->'revisions'->1->'datos'->>'marca'),
  'Acme',
  'a later update preserves the earlier revision contents'
);

select throws_ok(
  $$update public.valvula_revisiones set datos = '{}'::jsonb where valvula_id = '00000000-0000-0000-0000-000000000841'$$,
  '23514',
  'Valve revisions are immutable',
  'revision rows reject mutation'
);

select throws_ok(
  $$select public.api_update_valvula(
    '00000000-0000-0000-0000-000000000841', 'PSV-1', null, null, null, null,
    null, null, null, null, null, 'unknown'
  )$$,
  '23514',
  'Invalid availability reason',
  'availability reasons outside the documented values are rejected'
);

select public.test_set_valve_gateway_actor('00000000-0000-0000-0000-000000000802');

select throws_ok(
  $$select public.api_valvula('00000000-0000-0000-0000-000000000841')$$,
  '42501',
  'Not authorized',
  'a different Cliente cannot read another Client’s valve revisions'
);

select throws_ok(
  $$select public.api_update_valvula(
    '00000000-0000-0000-0000-000000000841', 'PSV-2'
  )$$,
  '42501',
  'Not authorized',
  'a different Cliente cannot update another Client’s valve'
);

select * from extensions.finish(true);

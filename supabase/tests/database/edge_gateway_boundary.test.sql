begin;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'edge-gateway-actor@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000301', 'cliente');

create function public.edge_gateway_default_privilege_probe()
returns void
language plpgsql
as $$
begin
end;
$$;

select has_function(
  'public',
  'require_systemsolutions_edge_gateway',
  ARRAY[]::text[],
  'the Data API gateway guard is installed'
);

select is(
  has_function_privilege('authenticated', 'public.api_context()', 'execute'),
  false,
  'authenticated callers have no business-RPC execute privilege'
);

select is(
  has_function_privilege('service_role', 'public.api_context()', 'execute'),
  true,
  'service_role has the business-RPC execute privilege'
);

select is(
  has_function_privilege('anon', 'public.require_systemsolutions_edge_gateway()', 'execute'),
  true,
  'anonymous Data API requests can reach the gateway guard to be rejected'
);

select is(
  has_function_privilege('authenticated', 'public.require_systemsolutions_edge_gateway()', 'execute'),
  true,
  'authenticated Data API requests can reach the gateway guard to be rejected'
);

select is(
  has_function_privilege('service_role', 'public.require_systemsolutions_edge_gateway()', 'execute'),
  true,
  'service_role can invoke the gateway guard'
);

select ok(
  exists (
    select 1
    from pg_db_role_setting settings
    join pg_roles role on role.oid = settings.setrole
    cross join lateral unnest(settings.setconfig) as config(value)
    where settings.setdatabase = 0
      and role.rolname = 'authenticator'
      and config.value = 'pgrst.db_pre_request=public.require_systemsolutions_edge_gateway'
  ),
  'PostgREST runs the gateway guard before every Data API request'
);

set local role authenticated;

select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'SystemSolutions Edge gateway required',
  'an authenticated caller without an Edge gateway is denied before actor setup'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{}', true);

select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'SystemSolutions Edge gateway required',
  'service_role requests without an actor header are denied'
);

select set_config(
  'request.headers',
  '{"x-systemsolutions-actor-id":"not-a-uuid"}',
  true
);

select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'SystemSolutions Edge gateway required',
  'service_role requests with an invalid actor header are denied'
);

select set_config(
  'request.headers',
  '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000399"}',
  true
);

select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'SystemSolutions Edge gateway required',
  'service_role requests for an unknown Cuenta are denied'
);

select set_config(
  'request.headers',
  '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000301"}',
  true
);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt', '{"role":"service_role"}', true);

select lives_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  'a current request.jwt service-role claim with a valid Cuenta actor is accepted'
);

select is(
  auth.uid(),
  '00000000-0000-0000-0000-000000000301'::uuid,
  'the accepted gateway request installs the actor identity for auth.uid()'
);

reset role;

select is(
  has_function_privilege('authenticated', 'public.edge_gateway_default_privilege_probe()', 'execute'),
  false,
  'future public-schema functions do not default to authenticated execute access'
);

select is(
  has_function_privilege('anon', 'public.edge_gateway_default_privilege_probe()', 'execute'),
  false,
  'future public-schema functions do not default to anonymous execute access'
);

select * from extensions.finish(true);

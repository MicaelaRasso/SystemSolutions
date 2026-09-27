begin;

select plan(8);

select has_function(
  'public',
  'api_cliente_pending_certificates',
  '{}',
  'the Cliente pending-certificate read RPC exists'
);
select is(
  has_function_privilege('service_role', 'public.api_cliente_pending_certificates()', 'execute'),
  true,
  'only the Edge service role can execute the pending-certificate read RPC'
);
select is(
  has_function_privilege('authenticated', 'public.api_cliente_pending_certificates()', 'execute'),
  false,
  'the browser cannot execute the pending-certificate RPC directly'
);
select like(
  pg_get_functiondef('public.api_cliente_pending_certificates()'::regprocedure),
  '%cliente_cuenta_id%',
  'the RPC scopes visits to the owning Cliente Yacimiento'
);
select like(
  pg_get_functiondef('public.api_cliente_pending_certificates()'::regprocedure),
  '%parte = ''cliente''%',
  'the RPC excludes visits that already have a Cliente signature'
);
select has_column(
  'public',
  'firmas_visita',
  'parte',
  'pending read remains visit-signature based'
);
select has_column(
  'public',
  'yacimientos',
  'cliente_cuenta_id',
  'pending read retains Yacimiento ownership scope'
);

select * from finish();

begin;

select plan(9);

select has_function(
  'public',
  'api_cliente_certificate_export',
  array['uuid'],
  'the Cliente certificate export RPC exists'
);
select is(
  has_function_privilege('service_role', 'public.api_cliente_certificate_export(uuid)', 'execute'),
  true,
  'the Edge gateway can execute the Cliente export RPC'
);
select is(
  has_function_privilege('authenticated', 'public.api_cliente_certificate_export(uuid)', 'execute'),
  false,
  'browser roles cannot execute the Cliente export RPC directly'
);
select like(
  pg_get_functiondef('public.api_cliente_certificate_export(uuid)'::regprocedure),
  '%rol <> ''cliente''%',
  'the export is restricted to Cliente accounts'
);
select like(
  pg_get_functiondef('public.api_cliente_certificate_export(uuid)'::regprocedure),
  '%api_finalized_certificate(certificate_id)%',
  'the export delegates to the finalized certificate boundary'
);
select like(
  pg_get_functiondef('public.api_finalized_certificate(uuid)'::regprocedure),
  '%parte = ''tecnico''%',
  'a Técnico signature is required for download'
);
select like(
  pg_get_functiondef('public.api_finalized_certificate(uuid)'::regprocedure),
  '%parte = ''cliente''%',
  'a Cliente signature is required for download'
);
select has_function(
  'public',
  'api_valvula_certificates',
  array['uuid'],
  'history reads remain available separately from download'
);
select like(
  pg_get_functiondef('public.api_valvula_certificates(uuid)'::regprocedure),
  '%estado = ''pendiente''%',
  'pending and historical records remain readable'
);

select * from finish();
rollback;

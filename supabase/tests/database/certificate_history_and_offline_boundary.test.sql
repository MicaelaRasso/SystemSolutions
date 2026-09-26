begin;

select plan(11);

select has_table(
  'public',
  'certificado_imagenes',
  'certificate image references are stored separately from immutable certificate data'
);

select has_table(
  'public',
  'operaciones_sync',
  'offline operations have a durable idempotency record'
);

select has_table(
  'public',
  'conflictos_sync',
  'rejected offline payloads have a durable conflict record'
);

select has_function(
  'public',
  'api_valvula_certificates',
  ARRAY['uuid']::text[],
  'valve history is exposed through one authenticated RPC'
);

select has_function(
  'public',
  'api_finalized_certificate',
  ARRAY['uuid']::text[],
  'the complete finalized consumer payload is exposed through one authenticated RPC'
);

select has_function(
  'public',
  'api_sync_visit_batch',
  ARRAY['uuid', 'jsonb']::text[],
  'offline synchronization is exposed through one authenticated RPC'
);

select is(
  has_function_privilege('anon', 'public.api_sync_visit_batch(uuid,jsonb)', 'execute'),
  false,
  'anonymous callers cannot execute offline synchronization'
);

select is(
  has_function_privilege('authenticated', 'public.api_sync_visit_batch(uuid,jsonb)', 'execute'),
  false,
  'authenticated callers cannot execute offline synchronization directly'
);

select is(
  has_function_privilege('service_role', 'public.api_sync_visit_batch(uuid,jsonb)', 'execute'),
  true,
  'the server-side service role executes the offline synchronization seam'
);

set local role authenticated;

select throws_ok(
  $$select public.api_offline_working_set()$$,
  '42501',
  'permission denied for function api_offline_working_set',
  'an authenticated caller cannot fetch the offline working set directly'
);

select throws_ok(
  $$select public.api_sync_visit_batch('00000000-0000-0000-0000-000000000000'::uuid, '[]'::jsonb)$$,
  '42501',
  'permission denied for function api_sync_visit_batch',
  'an authenticated caller cannot synchronize offline work directly'
);

select * from extensions.finish(true);

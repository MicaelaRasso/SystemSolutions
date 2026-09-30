begin;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000401', 'logo-owner@example.test'),
  ('00000000-0000-0000-0000-000000000402', 'logo-other@example.test'),
  ('00000000-0000-0000-0000-000000000403', 'logo-admin@example.test');
insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000401', 'cliente'),
  ('00000000-0000-0000-0000-000000000402', 'cliente'),
  ('00000000-0000-0000-0000-000000000403', 'administrador_regular');
insert into public.clientes (cuenta_id, nombre, razon_social) values
  ('00000000-0000-0000-0000-000000000401', 'Cliente Logo Uno', 'Logo Uno S.A.'),
  ('00000000-0000-0000-0000-000000000402', 'Cliente Logo Dos', 'Logo Dos S.A.');
insert into storage.objects (bucket_id, name) values
  ('client-logos', 'clients/00000000-0000-0000-0000-000000000401/logo.png'),
  ('client-logos', 'clients/00000000-0000-0000-0000-000000000402/logo.png');

select has_function(
  'public',
  'api_set_own_client_logo',
  array['text'],
  'the portal logo mutation RPC exists'
);
select is(
  has_function_privilege('service_role', 'public.api_set_own_client_logo(text)', 'execute'),
  true,
  'the Edge service role can execute the portal logo RPC'
);
select is(
  has_function_privilege('authenticated', 'public.api_set_own_client_logo(text)', 'execute'),
  false,
  'a browser JWT cannot execute the portal logo RPC directly'
);
select like(
  pg_get_functiondef('public.api_set_own_client_logo(text)'::regprocedure),
  '%rol = ''cliente'' and activo%',
  'the RPC requires an active Cliente actor'
);
select like(
  pg_get_functiondef('public.api_set_own_client_logo(text)'::regprocedure),
  '%auth.uid()%',
  'logo ownership is derived from the authenticated Edge actor'
);
select like(
  pg_get_functiondef('public.api_set_own_client_logo(text)'::regprocedure),
  '%actor_id::text%',
  'the logo object must belong to the actor-specific namespace'
);
select like(
  pg_get_functiondef('public.api_set_own_client_logo(text)'::regprocedure),
  '%bucket_id = ''client-logos''%',
  'the RPC accepts only uploaded objects from the private Cliente logo bucket'
);
select unlike(
  pg_get_functiondef('public.api_set_own_client_logo(text)'::regprocedure),
  '%razon_social =%',
  'the portal logo RPC cannot change Cliente profile fields'
);
select has_function(
  'public',
  'api_set_client_logo',
  array['uuid', 'text', 'text'],
  'the Administrator logo correction RPC remains available'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select lives_ok(
  $$select public.api_set_own_client_logo('clients/00000000-0000-0000-0000-000000000401/logo.png')$$,
  'a Cliente can upload or replace its own logo through the Edge RPC'
);
select is(
  (public.api_set_own_client_logo('clients/00000000-0000-0000-0000-000000000401/logo.png')->>'id'),
  '00000000-0000-0000-0000-000000000401',
  'the logo response identifies only the authenticated Cliente'
);
select throws_ok(
  $$select public.api_set_own_client_logo('clients/00000000-0000-0000-0000-000000000402/logo.png')$$,
  '22023',
  'Logo object is not authorized',
  'a Cliente cannot reference another Cliente logo object'
);
select is(
  (select razon_social from public.clientes where cuenta_id = '00000000-0000-0000-0000-000000000401'),
  'Logo Uno S.A.',
  'logo upload leaves all other Cliente profile fields unchanged'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
select throws_ok(
  $$select public.api_set_own_client_logo('clients/00000000-0000-0000-0000-000000000401/logo.png')$$,
  '22023',
  'Logo object is not authorized',
  'a second Cliente cannot update the first Cliente logo'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
select throws_ok(
  $$select public.api_set_own_client_logo('clients/00000000-0000-0000-0000-000000000401/logo.png')$$,
  '42501',
  'Only an active Cliente can change its logo',
  'an Administrator cannot use the Cliente self-service RPC'
);
select lives_ok(
  $$select public.api_set_client_logo('00000000-0000-0000-0000-000000000401', 'client-logos', 'clients/00000000-0000-0000-0000-000000000401/logo.png')$$,
  'Administrators retain the existing logo correction RPC'
);

select * from finish();
rollback;

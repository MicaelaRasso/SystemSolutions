begin;

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000004601', 'onboarding-admin@example.test'),
  ('00000000-0000-0000-0000-000000004602', 'onboarding-super@example.test'),
  ('00000000-0000-0000-0000-000000004603', 'onboarding-client@example.test'),
  ('00000000-0000-0000-0000-000000004604', 'onboarding-other@example.test'),
  ('00000000-0000-0000-0000-000000004605', 'onboarding-additional@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000004601', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000004602', 'super_administrador'),
  ('00000000-0000-0000-0000-000000004604', 'cliente');
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000004604', 'Otro Cliente');

create function public.test_set_onboarding_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_set_onboarding_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_set_onboarding_actor('00000000-0000-0000-0000-000000004601');

select lives_ok(
  $$select public.api_register_client_account('00000000-0000-0000-0000-000000004603')$$,
  'an Administrador registers the invited Cuenta as Cliente'
);
select is((public.api_create_client(
  '00000000-0000-0000-0000-000000004603', 'Cliente Principal', '30-12345678-9', 'Contacto',
  '111', 'principal@example.test', 'Dirección', true, true
)->>'id'), '00000000-0000-0000-0000-000000004603', 'onboarding creates the Cliente profile for the principal Cuenta');
select is((public.api_client('00000000-0000-0000-0000-000000004603')->>'razon_social'), 'Cliente Principal', 'Administradores can read the new profile');
select lives_ok(
  $$select public.api_update_client('00000000-0000-0000-0000-000000004603', 'Cliente Editado', '30-12345678-9', 'Contacto', '111', 'principal@example.test', 'Dirección', true, true)$$,
  'Administradores can edit Cliente profile fields'
);

select public.test_set_onboarding_actor('00000000-0000-0000-0000-000000004603');
select is((select rol::text from public.api_context()), 'cliente', 'the principal Cuenta authenticates with the Cliente portal role');
select is((public.api_client('00000000-0000-0000-0000-000000004603')->>'razon_social'), 'Cliente Editado', 'a Cliente can read its own profile');
select throws_ok(
  $$select public.api_update_client('00000000-0000-0000-0000-000000004603', 'Self edit', '30-12345678-9', 'Contacto', '111', 'principal@example.test', 'Dirección', true, true)$$,
  '42501', 'Only an Administrador can update a Cliente', 'a Cliente cannot update its profile'
);
select throws_ok(
  $$select public.api_client('00000000-0000-0000-0000-000000004604')$$,
  '42501', 'Not authorized', 'a Cliente cannot read another Cliente profile'
);

select public.test_set_onboarding_actor('00000000-0000-0000-0000-000000004602');
select lives_ok(
  $$select public.api_create_client_account('00000000-0000-0000-0000-000000004603', '00000000-0000-0000-0000-000000004605')$$,
  'additional-account compatibility remains available'
);
select is((select count(*) from public.cliente_cuentas where cliente_cuenta_id = '00000000-0000-0000-0000-000000004603'), 1::bigint, 'additional Cliente account remains linked to the principal profile');

select * from extensions.finish(true);

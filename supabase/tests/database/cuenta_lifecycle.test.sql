begin;

select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000691', 'admin-lifecycle@example.test'),
  ('00000000-0000-0000-0000-000000000692', 'pending-lifecycle@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000000691', 'super_administrador');
insert into public.cuentas (id, rol, estado, activo) values
  ('00000000-0000-0000-0000-000000000692', 'cliente', 'pendiente', false);

select has_column('public', 'cuentas', 'estado', 'Cuenta has an explicit lifecycle state');
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000000691'), 'activa', 'existing account creation defaults to active for compatibility');
select is((select activo from public.cuentas where id = '00000000-0000-0000-0000-000000000692'), false, 'pending Cuenta is not marked active');
select throws_ok(
  $$update public.cuentas set rol = 'administrador_regular' where id = '00000000-0000-0000-0000-000000000691'$$,
  '23514',
  'Cuenta role is immutable',
  'the Cuenta role cannot be changed after creation'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000692"}', true);
select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'Cuenta is not active',
  'the application gateway rejects a pending Cuenta'
);

reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000692';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000000692'), 'activa', 'accepting the invitation activates a pending Cuenta');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000692"}', true);
select lives_ok($$select public.require_systemsolutions_edge_gateway()$$, 'a newly active Cuenta can pass the gateway with its existing identity');

reset role;
update public.cuentas set estado = 'deshabilitada' where id = '00000000-0000-0000-0000-000000000692';
select is((select activo from public.cuentas where id = '00000000-0000-0000-0000-000000000692'), false, 'disabling synchronizes the legacy active flag');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000692"}', true);
select throws_ok(
  $$select public.require_systemsolutions_edge_gateway()$$,
  '42501',
  'Cuenta is not active',
  'a disabled Cuenta is denied immediately even with its same actor identity'
);

reset role;
update public.cuentas set estado = 'activa' where id = '00000000-0000-0000-0000-000000000692';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000000692'), 'activa', 'reactivation restores the existing Cuenta');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000692"}', true);
select lives_ok($$select public.require_systemsolutions_edge_gateway()$$, 'a reactivated Cuenta regains gateway access');
select set_config('request.headers', '{"x-systemsolutions-actor-id":"00000000-0000-0000-0000-000000000691"}', true);
select public.require_systemsolutions_edge_gateway();
select public.api_delete_account('00000000-0000-0000-0000-000000000692');

reset role;
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000000692'), 'deshabilitada', 'the compatibility delete endpoint only disables the Cuenta');
select ok(exists(select 1 from auth.users where id = '00000000-0000-0000-0000-000000000692'), 'soft disable preserves the Auth identity');

select * from extensions.finish(true);
rollback;

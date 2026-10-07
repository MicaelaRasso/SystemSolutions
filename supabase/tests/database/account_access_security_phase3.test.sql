begin;

select plan(23);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000007501', 'phase3-super@example.test', now()),
  ('00000000-0000-0000-0000-000000007502', 'phase3-admin@example.test', now()),
  ('00000000-0000-0000-0000-000000007503', 'phase3-client@example.test', now()),
  ('00000000-0000-0000-0000-000000007504', 'phase3-client-user@example.test', now()),
  ('00000000-0000-0000-0000-000000007505', 'phase3-workshop@example.test', now()),
  ('00000000-0000-0000-0000-000000007507', 'phase3-pending-user@example.test', null);

insert into public.cuentas (id, rol, estado) values
  ('00000000-0000-0000-0000-000000007501', 'super_administrador', 'activa'),
  ('00000000-0000-0000-0000-000000007502', 'administrador_regular', 'activa'),
  ('00000000-0000-0000-0000-000000007503', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000007504', 'cliente', 'activa'),
  ('00000000-0000-0000-0000-000000007505', 'taller_movil', 'activa'),
  ('00000000-0000-0000-0000-000000007507', 'cliente', 'pendiente');

insert into public.clientes (cuenta_id, nombre, activo) values
  ('00000000-0000-0000-0000-000000007503', 'Phase 3 Cliente', true);
insert into public.cliente_cuentas (cliente_cuenta_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000007503', '00000000-0000-0000-0000-000000007504'),
  ('00000000-0000-0000-0000-000000007503', '00000000-0000-0000-0000-000000007507');
insert into public.talleres_moviles (id, nombre, activo) values
  ('00000000-0000-0000-0000-000000007506', 'Phase 3 Taller', true);
insert into public.taller_cuentas (taller_movil_id, cuenta_id) values
  ('00000000-0000-0000-0000-000000007506', '00000000-0000-0000-0000-000000007505');

create function public.test_account_phase3_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_account_phase3_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_account_phase3_actor('00000000-0000-0000-0000-000000007502');

select is((public.api_authorize_admin_account_create('new-admin@example.test', 'administrador_regular')->'error'->>'code'), 'forbidden', 'regular Administrador cannot provision administrator accounts');
select is((public.api_authorize_account_provisioning('cliente', '00000000-0000-0000-0000-000000007503')->>'data')::boolean, true, 'active Administrador can preflight an account for an active Cliente');
select is((public.api_authorize_account_provisioning('cliente', '00000000-0000-0000-0000-000000007503')->>'error'), null, 'successful preflight has no error');

select public.test_account_phase3_actor('00000000-0000-0000-0000-000000007501');
select is((public.api_authorize_admin_account_create('new-admin@example.test', 'administrador_regular')->>'data')::boolean, true, 'Súper administrador can preflight administrator provisioning');
select is(jsonb_array_length(public.api_admin_accounts()->'data'), 2, 'Súper administrador can list administrator accounts');
select is((public.api_admin_recovery_email('00000000-0000-0000-0000-000000007502')->'data'->>'email'), 'phase3-admin@example.test', 'Súper administrador can authorize recovery by target email');
select lives_ok($$select public.api_record_auth_event('account_password_reset_requested', '00000000-0000-0000-0000-000000007502', 'exitoso', '{"channel":"email"}')$$, 'security audit accepts a password reset event without credentials');
select throws_ok($$select public.api_record_auth_event('account_password_reset_requested', '00000000-0000-0000-0000-000000007502', 'exitoso', '{"password":"secret"}')$$, '22023', 'Credentials and tokens cannot be audited', 'security audit rejects password material');

update public.clientes set activo = false where cuenta_id = '00000000-0000-0000-0000-000000007503';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007503'), 'deshabilitada', 'disabling a Cliente disables its principal Cuenta');
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007504'), 'deshabilitada', 'disabling a Cliente disables linked Cuentas');
select is((select estado_previo_padre::text from public.cuentas where id = '00000000-0000-0000-0000-000000007504'), 'activa', 'parent cascade preserves linked Cuenta state for reactivation');
update auth.users set email_confirmed_at = now(), encrypted_password = 'phase3-password-hash'
where id = '00000000-0000-0000-0000-000000007507';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007507'), 'deshabilitada', 'accepting an invitation under a disabled parent does not restore access');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000007504', true);
select is((select estado::text from public.api_context() where cuenta_id = '00000000-0000-0000-0000-000000007504'), 'deshabilitada', 'api_context denies an account when its parent Cliente is disabled');
select throws_ok($$select public.test_account_phase3_actor('00000000-0000-0000-0000-000000007504')$$, '42501', 'Cuenta is not active', 'gateway rejects a linked Cuenta under a disabled Cliente');
select public.test_account_phase3_actor('00000000-0000-0000-0000-000000007501');
select throws_ok($$select public.api_update_account('00000000-0000-0000-0000-000000007504', true)$$, '42501', 'Cannot reactivate a Cuenta under a disabled Cliente', 'individual reactivation cannot bypass a disabled parent');
select ok(exists(select 1 from public.cliente_cuentas where cuenta_id = '00000000-0000-0000-0000-000000007504'), 'parent disablement preserves the account relationship');

update public.clientes set activo = true where cuenta_id = '00000000-0000-0000-0000-000000007503';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007503'), 'activa', 'reactivating a Cliente restores its principal Cuenta');
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007504'), 'activa', 'reactivating a Cliente restores linked Cuentas');
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007507'), 'activa', 'reactivating a parent makes a previously pending accepted invitation active');
select ok(exists(select 1 from public.registros_auditoria where accion = 'account_disabled' and objetivo_id = '00000000-0000-0000-0000-000000007504'), 'account disablement has a canonical audit event');
select ok(exists(select 1 from public.registros_auditoria where accion = 'account_reactivated' and objetivo_id = '00000000-0000-0000-0000-000000007504'), 'account reactivation has a canonical audit event');

update public.talleres_moviles set activo = false where id = '00000000-0000-0000-0000-000000007506';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007505'), 'deshabilitada', 'disabling a Taller Móvil disables its shared Cuenta');
update public.talleres_moviles set activo = true where id = '00000000-0000-0000-0000-000000007506';
select is((select estado::text from public.cuentas where id = '00000000-0000-0000-0000-000000007505'), 'activa', 'reactivating a Taller Móvil restores its shared Cuenta');

select * from extensions.finish(true);
rollback;

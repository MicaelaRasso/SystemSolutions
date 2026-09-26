begin;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003601', 'backup-client@example.test'),
  ('00000000-0000-0000-0000-000000003602', 'backup-admin@example.test'),
  ('00000000-0000-0000-0000-000000003603', 'backup-super@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000003601', 'cliente'),
  ('00000000-0000-0000-0000-000000003602', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000003603', 'super_administrador');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000003601', 'Cliente backup');

insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista, created_at)
values (
  '00000000-0000-0000-0000-000000003611',
  '00000000-0000-0000-0000-000000003601',
  'Yacimiento backup', 'Neuquen', 'Operadora', 'Contratista',
  '2026-09-10 03:00:00+00'
);

insert into public.historial_relaciones (yacimiento_id, actor_cuenta_id, datos, created_at)
values
  ('00000000-0000-0000-0000-000000003611', '00000000-0000-0000-0000-000000003601', '{"event":"inside"}', '2026-09-11 02:59:59+00'),
  ('00000000-0000-0000-0000-000000003611', '00000000-0000-0000-0000-000000003601', '{"event":"outside"}', '2026-09-11 03:00:00+00');

insert into public.catalogo_opciones (lista, valor, created_at)
values ('backup-test', 'unrelated current configuration', '2026-09-10 04:00:00+00');

create function public.test_set_backup_actor(target uuid)
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
grant execute on function public.test_set_backup_actor(uuid) to service_role;

select has_table('public', 'registros_generacion_backup', 'backup generation metadata is persisted');
select has_function('public', 'api_prepare_backup_export', ARRAY['text', 'date', 'date']::text[], 'the snapshot preparation RPC exists');
select has_function('public', 'api_record_backup_export_result', ARRAY['uuid', 'text', 'integer', 'integer', 'bigint', 'text', 'jsonb', 'text', 'text']::text[], 'the result RPC exists');
select is(has_function_privilege('anon', 'public.api_prepare_backup_export(text,date,date)', 'execute'), false, 'anonymous accounts cannot prepare a backup');
select is(has_function_privilege('authenticated', 'public.api_prepare_backup_export(text,date,date)', 'execute'), false, 'authenticated accounts cannot prepare a backup directly');
select is(has_function_privilege('service_role', 'public.api_prepare_backup_export(text,date,date)', 'execute'), true, 'only the Edge service role can prepare a backup');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select public.test_set_backup_actor('00000000-0000-0000-0000-000000003602');
select throws_ok(
  $$select public.api_prepare_backup_export('complete', null, null)$$,
  '42501',
  'Only an active Súper Administrador can generate a Backup manual',
  'a regular Administrador is denied by the database capability seam'
);

select public.test_set_backup_actor('00000000-0000-0000-0000-000000003601');
select throws_ok(
  $$select public.api_prepare_backup_export('complete', null, null)$$,
  '42501',
  'Only an active Súper Administrador can generate a Backup manual',
  'a Cliente is denied by the database capability seam'
);

select public.test_set_backup_actor('00000000-0000-0000-0000-000000003603');
select lives_ok(
  $$select public.api_prepare_backup_export('date_range', '2026-09-10', '2026-09-10')$$,
  'a Súper Administrador can prepare a date-range snapshot'
);

select is(
  (select count(*) from public.registros_generacion_backup where actor_cuenta_id = '00000000-0000-0000-0000-000000003603'),
  1::bigint,
  'preparing a backup creates one generation attempt'
);

select is(
  jsonb_array_length((select public.api_prepare_backup_export('date_range', '2026-09-10', '2026-09-10')->'records'->'historial_relaciones')),
  1,
  'the final instant of an Argentina business day is included in its range'
);

select is(
  (select count(*) from public.registros_generacion_backup where scope = 'date_range' and from_date = '2026-09-10' and to_date = '2026-09-10'),
  2::bigint,
  'date boundaries are persisted as normalized inclusive business dates'
);

select is(
  jsonb_array_length((select public.api_prepare_backup_export('date_range', '2026-09-11', '2026-09-11')->'records'->'historial_relaciones')),
  1,
  'the first instant of the next Argentina business day is included only in its own range'
);

select is(
  jsonb_array_length((select public.api_prepare_backup_export('date_range', '2026-09-10', '2026-09-10')->'records'->'catalogo_opciones')),
  0,
  'unrelated current configuration is excluded from date-range exports'
);

select is(
  ((select public.api_prepare_backup_export('complete', null, null))->'excluded') ? 'auth.users',
  true,
  'complete exports disclose authentication internals as excluded'
);

select * from extensions.finish(true);

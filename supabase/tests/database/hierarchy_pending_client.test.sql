begin;

-- P5: al crear un Cliente, el panel lleva a cargar su estructura, pero el Cliente invitado queda con
-- la cuenta pendiente de activación (estado 'pendiente', activo = false) y el alta del yacimiento
-- respondía «The target account is not an active Cliente». Como en S3, la cuenta pendiente se
-- acepta; la deshabilitada se sigue rechazando.
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009811', 'hier-pending-client@example.test'),
  ('00000000-0000-0000-0000-000000009812', 'hier-disabled-client@example.test'),
  ('00000000-0000-0000-0000-000000009813', 'hier-pending-admin@example.test');

insert into public.cuentas (id, rol, estado, activo) values
  ('00000000-0000-0000-0000-000000009811', 'cliente', 'pendiente', false),
  ('00000000-0000-0000-0000-000000009812', 'cliente', 'deshabilitada', false),
  ('00000000-0000-0000-0000-000000009813', 'administrador_regular', 'activa', true);
insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000009811', 'Hier Pendiente'),
  ('00000000-0000-0000-0000-000000009812', 'Hier Deshabilitado');

create function public.test_hier_pending_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_hier_pending_set_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_hier_pending_set_actor('00000000-0000-0000-0000-000000009813');

select lives_ok(
  $$select public.api_create_yacimiento_for_actor(
    '00000000-0000-0000-0000-000000009811', 'Yacimiento Pendiente', 'Neuquén', 'Operadora', 'Contratista')$$,
  'an Administrador loads the hierarchy of a Cliente whose account is pending activation'
);
select is(
  (select count(*)::int from public.yacimientos where cliente_cuenta_id = '00000000-0000-0000-0000-000000009811'),
  1,
  'the Yacimiento belongs to the pending Cliente'
);
select throws_ok(
  $$select public.api_create_yacimiento_for_actor(
    '00000000-0000-0000-0000-000000009812', 'Yacimiento Deshabilitado', 'Neuquén', 'Operadora', 'Contratista')$$,
  'The target account is not an active Cliente',
  'a disabled Cliente account is still rejected'
);

select * from finish();
rollback;

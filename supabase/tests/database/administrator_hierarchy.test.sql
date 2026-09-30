begin;

select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'hierarchy-admin@example.test'),
  ('00000000-0000-0000-0000-000000001702', 'hierarchy-client@example.test'),
  ('00000000-0000-0000-0000-000000001703', 'hierarchy-other@example.test'),
  ('00000000-0000-0000-0000-000000001704', 'hierarchy-tech@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000001701', 'administrador_regular'),
  ('00000000-0000-0000-0000-000000001702', 'cliente'),
  ('00000000-0000-0000-0000-000000001703', 'cliente'),
  ('00000000-0000-0000-0000-000000001704', 'taller_movil');

insert into public.clientes (cuenta_id, nombre) values
  ('00000000-0000-0000-0000-000000001702', 'Cliente de jerarquía'),
  ('00000000-0000-0000-0000-000000001703', 'Otro Cliente');

create function public.test_set_admin_hierarchy_gateway_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_set_admin_hierarchy_gateway_actor(uuid) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_set_admin_hierarchy_gateway_actor('00000000-0000-0000-0000-000000001701');

select throws_ok(
  $$select public.api_create_yacimiento_for_actor(null, 'Sin Cliente', 'Neuquen', 'Operadora', 'Contratista')$$,
  '22023',
  'A Cliente is required to create a Yacimiento',
  'an Administrador cannot create an unowned Yacimiento'
);

select throws_ok(
  $$select public.api_create_yacimiento_for_actor('00000000-0000-0000-0000-000000001701'::uuid, 'Cuenta admin', 'Neuquen', 'Operadora', 'Contratista')$$,
  '22023',
  'The target account is not an active Cliente',
  'an Administrador can only target a Cliente account'
);

select lives_ok(
  $$select public.api_create_yacimiento_for_actor('00000000-0000-0000-0000-000000001702'::uuid, 'Campo Administrativo', 'Neuquen', 'Operadora', 'Contratista')$$,
  'an Administrador creates a Yacimiento for the selected Cliente'
);

select is(
  (select cliente_cuenta_id from public.yacimientos where nombre = 'Campo Administrativo'),
  '00000000-0000-0000-0000-000000001702'::uuid,
  'the Yacimiento owner is the selected Cliente'
);

select set_config(
  'app.test_admin_yacimiento_id',
  (select id::text from public.yacimientos where nombre = 'Campo Administrativo'),
  true
);

select is((public.api_create_descendant_for_actor('planta', current_setting('app.test_admin_yacimiento_id')::uuid, 'Planta Admin')->>'nombre'), 'Planta Admin', 'an Administrador creates a Planta');
select set_config('app.test_admin_planta_id', (select id::text from public.plantas_locaciones where nombre = 'Planta Admin'), true);
select is((public.api_create_descendant_for_actor('equipo', current_setting('app.test_admin_planta_id')::uuid, 'Equipo Admin')->>'nombre'), 'Equipo Admin', 'an Administrador creates an Equipo');
select set_config('app.test_admin_equipo_id', (select id::text from public.equipos_unidades where nombre = 'Equipo Admin'), true);
select is((public.api_create_descendant_for_actor('valvula', current_setting('app.test_admin_equipo_id')::uuid, 'Valvula Admin')->>'nombre'), 'Valvula Admin', 'an Administrador creates a Válvula');

select lives_ok(
  $$select public.api_update_descendant_for_actor('equipo', current_setting('app.test_admin_equipo_id')::uuid, 'Equipo Corregido')$$,
  'an Administrador corrects a descendant name'
);

select is(
  (select count(*) from public.api_yacimientos()),
  1::bigint,
  'an Administrador can read the Cliente Yacimiento'
);
select is(
  public.api_yacimiento_tree(current_setting('app.test_admin_yacimiento_id')::uuid)->'valvulas'->0->>'nombre',
  'Valvula Admin',
  'an Administrador can read the complete hierarchy tree'
);

select public.test_set_admin_hierarchy_gateway_actor('00000000-0000-0000-0000-000000001704');
select throws_ok(
  $$select public.api_update_descendant_for_actor('equipo', current_setting('app.test_admin_equipo_id')::uuid, 'Cambio no autorizado')$$,
  '42501',
  'Not authorized',
  'a Taller Móvil cannot edit the administrative hierarchy'
);

select public.test_set_admin_hierarchy_gateway_actor('00000000-0000-0000-0000-000000001702');
select is(
  (select count(*) from public.api_yacimientos()),
  1::bigint,
  'a Cliente can list its owned Yacimiento'
);
select is(
  public.api_yacimiento_tree(current_setting('app.test_admin_yacimiento_id')::uuid)->'valvulas'->0->>'nombre',
  'Valvula Admin',
  'a Cliente can read its complete Yacimiento tree'
);
select throws_ok(
  $$select public.api_create_yacimiento_for_actor(null, 'No permitido', 'Neuquen', 'Operadora', 'Contratista')$$,
  '42501',
  'Only an Administrador can change hierarchy',
  'a Cliente cannot create a Yacimiento'
);
select throws_ok(
  $$select public.api_update_yacimiento_for_actor(current_setting('app.test_admin_yacimiento_id')::uuid, 'No permitido', 'Neuquen', 'Operadora', 'Contratista')$$,
  '42501',
  'Only an Administrador can change hierarchy',
  'a Cliente cannot rename a Yacimiento'
);
select throws_ok(
  $$select public.api_create_descendant_for_actor('planta', current_setting('app.test_admin_yacimiento_id')::uuid, 'No permitido')$$,
  '42501',
  'Only an Administrador can change hierarchy',
  'a Cliente cannot create a descendant'
);
select throws_ok(
  $$select public.api_update_descendant_for_actor('equipo', current_setting('app.test_admin_equipo_id')::uuid, 'No permitido')$$,
  '42501',
  'Only an Administrador can change hierarchy',
  'a Cliente cannot rename a descendant'
);

select public.test_set_admin_hierarchy_gateway_actor('00000000-0000-0000-0000-000000001703');
select is((select count(*) from public.api_yacimientos()), 0::bigint, 'another Cliente cannot list an unrelated Yacimiento');
select throws_ok(
  $$select public.api_yacimiento_tree(current_setting('app.test_admin_yacimiento_id')::uuid)$$,
  '42501',
  'Not authorized',
  'another Cliente cannot read an unrelated Yacimiento tree'
);
select throws_ok(
  $$select public.api_update_yacimiento_for_actor(current_setting('app.test_admin_yacimiento_id')::uuid, 'Cambio ajeno', 'Neuquen', 'Operadora', 'Contratista')$$,
  '42501',
  'Only an Administrador can change hierarchy',
  'another Cliente cannot mutate the hierarchy'
);

select is(
  (select count(*) from public.historial_relaciones where yacimiento_id = current_setting('app.test_admin_yacimiento_id')::uuid and tipo = 'jerarquia'),
  6::bigint,
  'hierarchy creation and corrections preserve relationship history'
);

select * from extensions.finish(true);

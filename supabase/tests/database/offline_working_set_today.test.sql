begin;

-- P4: una visita aceptada cuyo horario ya pasó hoy (el técnico llega tarde) sigue en la agenda de
-- campo. Antes, el working set exigía `starts_at >= now()` y la visita desaparecía de /taller sin
-- poder iniciarse. Las de días anteriores siguen fuera.
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009111', 'ws-today-client@example.test'),
  ('00000000-0000-0000-0000-000000009112', 'ws-today-tech@example.test'),
  ('00000000-0000-0000-0000-000000009113', 'ws-today-admin@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000009111', 'cliente'),
  ('00000000-0000-0000-0000-000000009112', 'taller_movil'),
  ('00000000-0000-0000-0000-000000009113', 'administrador_regular');
insert into public.clientes (cuenta_id, nombre)
values ('00000000-0000-0000-0000-000000009111', 'WS Today Cliente');
insert into public.talleres_moviles (id, nombre)
values ('00000000-0000-0000-0000-000000009211', 'WS Today Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009112');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
values ('00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009111', 'WS Today Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre)
values ('00000000-0000-0000-0000-000000009411', '00000000-0000-0000-0000-000000009311', 'WS Today Planta');
insert into public.equipos_unidades (id, planta_id, nombre)
values ('00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009411', 'WS Today Equipo');
insert into public.valvulas (id, equipo_id, nombre) values
  ('00000000-0000-0000-0000-000000009611', '00000000-0000-0000-0000-000000009511', 'WS Today Válvula 1'),
  ('00000000-0000-0000-0000-000000009612', '00000000-0000-0000-0000-000000009511', 'WS Today Válvula 2');

create function public.test_ws_today_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_ws_today_set_actor(uuid) to service_role;

-- Dos visitas aceptadas (una por válvula) con horario futuro; después se las mueve al pasado.
create function public.test_ws_today_accepted_visit(valve uuid, offset_hours int)
returns uuid language plpgsql as $$
declare
  request_id uuid;
  visit_id uuid;
begin
  perform public.test_ws_today_set_actor('00000000-0000-0000-0000-000000009111');
  request_id := (public.api_create_service_request(
    '00000000-0000-0000-0000-000000009311'::uuid,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', valve))
  )->'request'->>'id')::uuid;
  perform public.test_ws_today_set_actor('00000000-0000-0000-0000-000000009113');
  visit_id := (public.api_schedule_visit(
    request_id, '00000000-0000-0000-0000-000000009211'::uuid,
    now() + make_interval(hours => offset_hours), now() + make_interval(hours => offset_hours + 2)
  )->'visit'->>'id')::uuid;
  perform public.test_ws_today_set_actor('00000000-0000-0000-0000-000000009112');
  perform public.api_accept_visit(visit_id);
  return visit_id;
end;
$$;
grant execute on function public.test_ws_today_accepted_visit(uuid, int) to service_role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('app.ws_today_late', public.test_ws_today_accepted_visit('00000000-0000-0000-0000-000000009611', 1)::text, true);
select set_config('app.ws_today_old', public.test_ws_today_accepted_visit('00000000-0000-0000-0000-000000009612', 4)::text, true);
reset role;

-- Tarde: empezaba hace un segundo (hoy). Vieja: empezaba ayer (hora argentina) y ya terminó.
update public.visitas_servicio
set starts_at = now() - interval '1 second', ends_at = now() + interval '1 hour'
where id = current_setting('app.ws_today_late')::uuid;
update public.visitas_servicio
set starts_at = (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires') - interval '3 hours',
    ends_at = (date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires') - interval '2 hours'
where id = current_setting('app.ws_today_old')::uuid;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_ws_today_set_actor('00000000-0000-0000-0000-000000009112');

select ok(
  (public.api_offline_working_set_for_device('00000000-0000-0000-0000-000000009711'::uuid)->'visits')
    @> jsonb_build_array(jsonb_build_object('visit', jsonb_build_object('id', current_setting('app.ws_today_late')))),
  'an accepted visit whose start time already passed today stays in the device working set'
);
select ok(
  not ((public.api_offline_working_set_for_device('00000000-0000-0000-0000-000000009711'::uuid)->'visits')
    @> jsonb_build_array(jsonb_build_object('visit', jsonb_build_object('id', current_setting('app.ws_today_old'))))),
  'an accepted visit from a previous day is not in the device working set'
);
select ok(
  (public.api_offline_working_set()->'visits')
    @> jsonb_build_array(jsonb_build_object('visit', jsonb_build_object('id', current_setting('app.ws_today_late')))),
  'the legacy working set also keeps today''s late visit'
);
select ok(
  not ((public.api_offline_working_set()->'visits')
    @> jsonb_build_array(jsonb_build_object('visit', jsonb_build_object('id', current_setting('app.ws_today_old'))))),
  'the legacy working set leaves out visits from previous days'
);

select * from finish();
rollback;

begin;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009101', 'catalog-freeze-client@example.test'),
  ('00000000-0000-0000-0000-000000009102', 'catalog-freeze-tech@example.test'),
  ('00000000-0000-0000-0000-000000009103', 'catalog-freeze-admin@example.test');

insert into public.cuentas (id, rol) values
  ('00000000-0000-0000-0000-000000009101', 'cliente'),
  ('00000000-0000-0000-0000-000000009102', 'taller_movil'),
  ('00000000-0000-0000-0000-000000009103', 'administrador_regular');
insert into public.clientes (cuenta_id, nombre)
values ('00000000-0000-0000-0000-000000009101', 'Catalog Freeze Cliente');
insert into public.talleres_moviles (id, nombre)
values ('00000000-0000-0000-0000-000000009201', 'Catalog Freeze Taller');
insert into public.taller_cuentas (taller_movil_id, cuenta_id)
values ('00000000-0000-0000-0000-000000009201', '00000000-0000-0000-0000-000000009102');
insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
values ('00000000-0000-0000-0000-000000009301', '00000000-0000-0000-0000-000000009101', 'Catalog Freeze Yacimiento', 'Neuquen', 'Operadora', 'Contratista');
insert into public.plantas_locaciones (id, yacimiento_id, nombre)
values ('00000000-0000-0000-0000-000000009401', '00000000-0000-0000-0000-000000009301', 'Catalog Freeze Planta');
insert into public.equipos_unidades (id, planta_id, nombre)
values ('00000000-0000-0000-0000-000000009501', '00000000-0000-0000-0000-000000009401', 'Catalog Freeze Equipo');
insert into public.valvulas (id, equipo_id, nombre)
values ('00000000-0000-0000-0000-000000009601', '00000000-0000-0000-0000-000000009501', 'Catalog Freeze Válvula');

create function public.test_catalog_freeze_set_actor(target uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.headers', jsonb_build_object('x-systemsolutions-actor-id', target)::text, true);
  perform public.require_systemsolutions_edge_gateway();
end;
$$;
grant execute on function public.test_catalog_freeze_set_actor(uuid) to service_role;

select has_function('public', 'api_offline_working_set_for_device', array['uuid']::text[], 'device-scoped working set RPC exists');
select is(has_function_privilege('authenticated', 'public.api_offline_working_set_for_device(uuid)', 'execute'), false, 'browser roles cannot call the device-scoped working set RPC directly');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009101');
select set_config(
  'app.catalog_freeze_request_id',
  (public.api_create_service_request(
    '00000000-0000-0000-0000-000000009301'::uuid,
    '[{"kind":"valvula","id":"00000000-0000-0000-0000-000000009601"}]'::jsonb
  )->'request'->>'id'),
  true
);

select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009103');
select set_config(
  'app.catalog_freeze_visit_id',
  (public.api_schedule_visit(
    current_setting('app.catalog_freeze_request_id')::uuid,
    '00000000-0000-0000-0000-000000009201'::uuid,
    now() + interval '1 hour',
    now() + interval '3 hours'
  )->'visit'->>'id'),
  true
);
select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009102');
select is(
  (public.api_accept_visit(current_setting('app.catalog_freeze_visit_id')::uuid)->'visit'->>'estado'),
  'aceptada',
  'the assigned Taller Móvil accepts the visit before catalog download'
);

select set_config(
  'app.catalog_freeze_device_id',
  '00000000-0000-0000-0000-000000009701',
  true
);
select set_config(
  'app.catalog_freeze_downloaded_version',
  (public.api_offline_working_set_for_device(current_setting('app.catalog_freeze_device_id')::uuid)
    ->'visits'->0->'certificate_catalogs'->>'replacement_catalog_version'),
  true
);
select public.api_claim_visit_device(
  current_setting('app.catalog_freeze_visit_id')::uuid,
  current_setting('app.catalog_freeze_device_id')::uuid
);
select throws_ok(
  $$select public.api_claim_visit_device(
    current_setting('app.catalog_freeze_visit_id')::uuid,
    '00000000-0000-0000-0000-000000009702'::uuid
  )$$,
  '40001',
  'Another device is already working on this visit',
  'a second device cannot claim a visit already owned by another device'
);

select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009103');
select set_config(
  'app.catalog_freeze_new_option_id',
  (public.api_create_catalog_option('repuestos', 'PRESTART_NEW_PART')->>'id'),
  true
);
select set_config(
  'app.catalog_freeze_version_after_create',
  public.api_certificate_capture_catalogs()->>'replacement_catalog_version',
  true
);
select isnt(
  current_setting('app.catalog_freeze_version_after_create'),
  current_setting('app.catalog_freeze_downloaded_version'),
  'an administrator edit creates a distinct active replacement catalog revision'
);
select public.api_update_catalog_option(
  current_setting('app.catalog_freeze_new_option_id')::uuid,
  'PRESTART_NEW_PART_RENAMED',
  null
);
select isnt(
  (public.api_certificate_capture_catalogs()->>'replacement_catalog_version'),
  current_setting('app.catalog_freeze_version_after_create'),
  'renaming a replacement option creates another immutable catalog revision'
);
select set_config(
  'app.catalog_freeze_version_after_rename',
  public.api_certificate_capture_catalogs()->>'replacement_catalog_version',
  true
);
select public.api_reorder_catalog(
  'repuestos',
  array[current_setting('app.catalog_freeze_new_option_id')::uuid]
);
select isnt(
  (public.api_certificate_capture_catalogs()->>'replacement_catalog_version'),
  current_setting('app.catalog_freeze_version_after_rename'),
  'reordering replacement options creates another immutable catalog revision'
);
select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009102');
select throws_ok(
  $$select public.api_start_visit_with_catalog(
    current_setting('app.catalog_freeze_visit_id')::uuid,
    (public.api_certificate_capture_catalogs()->>'replacement_catalog_version')::uuid,
    current_setting('app.catalog_freeze_device_id')::uuid
  )$$,
  '23514',
  'The replacement catalog version was not the last version downloaded for this visit and device',
  'visit start rejects the live revision added after the device download'
);

select public.test_catalog_freeze_set_actor('00000000-0000-0000-0000-000000009102');
select is(
  (public.api_sync_visit_batch(
    current_setting('app.catalog_freeze_visit_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'operation_id', '00000000-0000-0000-0000-000000009801',
      'kind', 'start_visit',
      'payload', jsonb_build_object(
        'device_id', current_setting('app.catalog_freeze_device_id'),
        'replacement_catalog_version_id', current_setting('app.catalog_freeze_downloaded_version')
      ),
      'schema_version', 2,
      'dependencies', '[]'::jsonb,
      'device_timestamp', now()
    )),
    current_setting('app.catalog_freeze_device_id')::uuid
  )->'operations'->0->>'estado'),
  'sincronizada',
  'offline visit start synchronizes with the catalog version downloaded before the edit'
);
select is(
  (select replacement_catalog_version_id::text from public.visitas_servicio where id = current_setting('app.catalog_freeze_visit_id')::uuid),
  current_setting('app.catalog_freeze_downloaded_version'),
  'the visit remains bound to the device’s downloaded catalog revision'
);
select is(
  (public.api_offline_working_set_for_device(current_setting('app.catalog_freeze_device_id')::uuid)
    ->'visits'->0->'certificate_catalogs'->>'replacement_catalog_version'),
  current_setting('app.catalog_freeze_downloaded_version'),
  'later working-set refresh returns the visit-bound revision'
);
select ok(
  not ((public.api_offline_working_set_for_device(current_setting('app.catalog_freeze_device_id')::uuid)
    ->'visits'->0->'certificate_catalogs'->'replacement_parts') @> '[{"label":"PRESTART_NEW_PART_RENAMED"}]'::jsonb),
  'the visit-bound option list excludes options added after the pre-visit download'
);

select lives_ok(
  $$select public.api_update_work_order(
    (select id from public.ordenes_trabajo where visita_id = current_setting('app.catalog_freeze_visit_id')::uuid limit 1),
    'evaluada'::public.estado_orden_trabajo,
    null
  )$$,
  'the Taller Móvil can evaluate a work order after synchronized visit start'
);
select set_config(
  'app.catalog_freeze_certificate_id',
  (public.api_start_certificate_draft(
    (select id from public.ordenes_trabajo where visita_id = current_setting('app.catalog_freeze_visit_id')::uuid limit 1),
    '00000000-0000-0000-0000-000000009901'::uuid
  )->'certificate'->>'id'),
  true
);
select is(
  (select repuestos->>'catalog_version' from public.certificados where id = current_setting('app.catalog_freeze_certificate_id')::uuid),
  current_setting('app.catalog_freeze_downloaded_version'),
  'a new certificate draft initializes its replacement catalog version from the visit snapshot'
);
select throws_ok(
  $$select public.api_update_certificate_draft(
    current_setting('app.catalog_freeze_certificate_id')::uuid,
    jsonb_build_object('repuestos', jsonb_build_object('catalog_version', 'different-version', 'items', '[]'::jsonb, 'otros', null))
  )$$,
  '23514',
  'Certificate replacement catalog version must match the visit snapshot',
  'draft updates cannot switch to a different replacement catalog version'
);
select throws_ok(
  $$select public.api_update_certificate_draft(
    current_setting('app.catalog_freeze_certificate_id')::uuid,
    jsonb_build_object('repuestos', jsonb_build_object(
      'catalog_version', current_setting('app.catalog_freeze_downloaded_version'),
      'items', jsonb_build_array(jsonb_build_object(
        'id', current_setting('app.catalog_freeze_new_option_id'),
        'label', 'PRESTART_NEW_PART_RENAMED'
      )),
      'otros', null
    ))
  )$$,
  '23514',
  'Replacement part does not belong to the visit catalog snapshot',
  'draft updates cannot add an option created after the visit catalog was frozen'
);

select * from extensions.finish(true);
rollback;

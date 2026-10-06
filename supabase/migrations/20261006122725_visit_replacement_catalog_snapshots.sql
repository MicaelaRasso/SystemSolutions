begin;

-- A replacement-catalog revision is an immutable ordered snapshot.  The
-- current pointer changes only through the administrator catalog RPCs below.
create table public.replacement_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  options jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references public.cuentas(id),
  constraint replacement_catalog_versions_options_array
    check (jsonb_typeof(options) = 'array')
);

create table public.replacement_catalog_state (
  singleton boolean primary key default true check (singleton),
  current_version_id uuid not null references public.replacement_catalog_versions(id)
);

alter table public.replacement_catalog_versions enable row level security;
alter table public.replacement_catalog_state enable row level security;
revoke all on public.replacement_catalog_versions, public.replacement_catalog_state from public, anon, authenticated, service_role;

insert into public.replacement_catalog_versions(options, created_by)
select coalesce(
  jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor, o.id),
  '[]'::jsonb
), null
from public.catalogo_opciones o
where o.lista = 'repuestos' and o.activo
returning id;

insert into public.replacement_catalog_state(singleton, current_version_id)
select true, id
from public.replacement_catalog_versions
order by created_at desc, id desc
limit 1;

alter table public.visitas_servicio
  add column replacement_catalog_version_id uuid
    references public.replacement_catalog_versions(id);
alter table public.certificados
  add column replacement_catalog_version_id uuid
    references public.replacement_catalog_versions(id),
  add constraint certificados_replacement_catalog_version_matches_payload
    check (
      replacement_catalog_version_id is null
      or repuestos->>'catalog_version' = replacement_catalog_version_id::text
    );

create or replace function public.assert_certificate_replacement_options(
  target_version uuid,
  replacement_parts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_options jsonb;
  item jsonb;
begin
  select options into snapshot_options
  from public.replacement_catalog_versions
  where id = target_version;
  if snapshot_options is null then
    raise exception using errcode = '23503', message = 'Replacement catalog version does not exist';
  end if;
  if jsonb_typeof(replacement_parts->'items') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Replacement parts must be an array';
  end if;
  for item in select value from jsonb_array_elements(replacement_parts->'items') loop
    if jsonb_typeof(item) = 'string' then
      if not exists (
        select 1 from jsonb_array_elements(snapshot_options) catalog_item
        where catalog_item->>'label' = item #>> '{}'
      ) then
        raise exception using errcode = '23514', message = 'Replacement part does not belong to the visit catalog snapshot';
      end if;
    elsif jsonb_typeof(item) = 'object' then
      if not exists (
        select 1 from jsonb_array_elements(snapshot_options) catalog_item
        where catalog_item->>'id' = item->>'id'
          and catalog_item->>'label' = item->>'label'
      ) then
        raise exception using errcode = '23514', message = 'Replacement part does not belong to the visit catalog snapshot';
      end if;
    else
      raise exception using errcode = '22023', message = 'Replacement part must be a label or a catalog option';
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_certificate_replacement_options(uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.bind_certificate_replacement_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_version uuid;
begin
  select replacement_catalog_version_id into visit_version
  from public.visitas_servicio
  where id = new.visita_id;
  if visit_version is null then
    raise exception using errcode = '23514', message = 'A certificate requires a visit with a pinned replacement catalog version';
  end if;
  if new.replacement_catalog_version_id is not null
     and new.replacement_catalog_version_id is distinct from visit_version then
    raise exception using errcode = '23514', message = 'Certificate replacement catalog version must match the visit snapshot';
  end if;
  new.replacement_catalog_version_id := visit_version;
  new.repuestos := coalesce(new.repuestos, '{}'::jsonb)
    || jsonb_build_object('catalog_version', visit_version::text);
  perform public.assert_certificate_replacement_options(visit_version, new.repuestos);
  return new;
end;
$$;

create trigger certificados_bind_replacement_catalog
before insert on public.certificados
for each row execute function public.bind_certificate_replacement_catalog();

create or replace function public.guard_certificate_replacement_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.replacement_catalog_version_id is not null
     and (new.replacement_catalog_version_id is distinct from old.replacement_catalog_version_id
          or new.repuestos->>'catalog_version' is distinct from old.replacement_catalog_version_id::text) then
    raise exception using errcode = '23514', message = 'Certificate replacement catalog version must match the visit snapshot';
  end if;
  if old.replacement_catalog_version_id is not null then
    perform public.assert_certificate_replacement_options(old.replacement_catalog_version_id, new.repuestos);
  end if;
  return new;
end;
$$;

create trigger certificados_replacement_catalog_immutable
before update on public.certificados
for each row execute function public.guard_certificate_replacement_catalog_change();

revoke all on function public.bind_certificate_replacement_catalog() from public, anon, authenticated, service_role;
revoke all on function public.guard_certificate_replacement_catalog_change() from public, anon, authenticated, service_role;

-- Already-running visits receive a one-time baseline revision. Their closed
-- certificates retain their prior catalog_version strings and labels.
update public.visitas_servicio
set replacement_catalog_version_id = (select current_version_id from public.replacement_catalog_state where singleton)
where estado in ('en_curso', 'completada')
  and replacement_catalog_version_id is null;

create table public.visit_catalog_downloads (
  visit_id uuid not null references public.visitas_servicio(id) on delete cascade,
  device_id uuid not null,
  replacement_catalog_version_id uuid not null references public.replacement_catalog_versions(id),
  downloaded_at timestamptz not null default clock_timestamp(),
  primary key (visit_id, device_id)
);

alter table public.visit_catalog_downloads enable row level security;
revoke all on public.visit_catalog_downloads from public, anon, authenticated, service_role;
create index visit_catalog_downloads_revision_idx
  on public.visit_catalog_downloads(replacement_catalog_version_id);

create or replace function public.reject_replacement_catalog_version_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Replacement catalog revisions are immutable';
end;
$$;

create trigger replacement_catalog_versions_immutable
before update or delete on public.replacement_catalog_versions
for each row execute function public.reject_replacement_catalog_version_mutation();

revoke all on function public.reject_replacement_catalog_version_mutation() from public, anon, authenticated, service_role;

create or replace function public.publish_replacement_catalog_version()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  version_id uuid;
begin
  -- Serialize admin changes and make each successful edit publish exactly one
  -- snapshot after the option-row mutation in the same transaction.
  perform pg_advisory_xact_lock(672341908);
  insert into public.replacement_catalog_versions(options, created_by)
  select coalesce(
    jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor, o.id),
    '[]'::jsonb
  ), auth.uid()
  from public.catalogo_opciones o
  where o.lista = 'repuestos' and o.activo
  returning id into version_id;

  insert into public.replacement_catalog_state(singleton, current_version_id)
  values (true, version_id)
  on conflict (singleton) do update set current_version_id = excluded.current_version_id;
  return version_id;
end;
$$;

revoke all on function public.publish_replacement_catalog_version() from public, anon, authenticated, service_role;

create or replace function public.api_create_catalog_option(target_list text, option_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.catalogo_opciones;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs';
  end if;
  if target_list = 'repuestos' then perform pg_advisory_xact_lock(672341908); end if;
  insert into public.catalogo_opciones(lista, valor, orden)
  values (target_list, btrim(option_value), coalesce((select max(orden) + 1 from public.catalogo_opciones where lista = target_list), 0))
  returning * into result;
  if target_list = 'repuestos' then perform public.publish_replacement_catalog_version(); end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_update_catalog_option(target uuid, option_value text, option_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.catalogo_opciones; target_list text;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs';
  end if;
  -- The list is immutable. Read it before taking the shared catalog lock so
  -- catalog edits and reorders acquire locks in a consistent order.
  select lista into target_list from public.catalogo_opciones where id = target;
  if target_list is null then raise exception using errcode = 'no_data_found', message = 'Catalog option not found'; end if;
  if target_list = 'repuestos' then perform pg_advisory_xact_lock(672341908); end if;
  update public.catalogo_opciones
  set valor = coalesce(nullif(btrim(option_value), ''), valor),
      activo = coalesce(option_active, activo)
  where id = target returning * into result;
  if target_list = 'repuestos' then perform public.publish_replacement_catalog_version(); end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_reorder_catalog(target_list text, option_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare changed_rows integer;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs';
  end if;
  if target_list = 'repuestos' then perform pg_advisory_xact_lock(672341908); end if;
  update public.catalogo_opciones o set orden = positions.position
  from unnest(option_ids) with ordinality positions(id, position)
  where o.id = positions.id and o.lista = target_list
    and o.orden is distinct from positions.position::integer;
  get diagnostics changed_rows = row_count;
  if target_list = 'repuestos' and changed_rows > 0 then perform public.publish_replacement_catalog_version(); end if;
end;
$$;

create or replace function public.api_certificate_capture_catalogs_for_version(target_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  version_row public.replacement_catalog_versions;
begin
  perform public.require_authenticated_cuenta();
  select * into version_row from public.replacement_catalog_versions where id = target_version;
  if version_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Replacement catalog version not found';
  end if;
  return jsonb_build_object(
    'template', (select to_jsonb(p) from public.plantillas_certificado p where p.estado = 'activa'),
    'maintenance', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'alcance' and o.activo), '[]'::jsonb),
    'replacement_catalog_version', version_row.id,
    'replacement_parts', version_row.options,
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'unidad' and o.activo), '[]'::jsonb),
    'standards', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.nombre || ' · ' || p.nro_serie, 'nro_serie', p.nro_serie, 'vencimiento', p.vencimiento) order by p.nombre, p.nro_serie)
      from public.patrones_ensayo p where p.activo), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_certificate_capture_catalogs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare current_version uuid;
begin
  perform public.require_authenticated_cuenta();
  select current_version_id into current_version from public.replacement_catalog_state where singleton;
  return public.api_certificate_capture_catalogs_for_version(current_version);
end;
$$;

revoke all on function public.api_certificate_capture_catalogs_for_version(uuid) from public, anon, authenticated;
revoke all on function public.api_certificate_capture_catalogs() from public, anon, authenticated;
grant execute on function public.api_certificate_capture_catalogs_for_version(uuid) to service_role;
grant execute on function public.api_certificate_capture_catalogs() to authenticated, service_role;

create or replace function public.api_offline_working_set_for_device(target_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  provider uuid;
  latest_version uuid;
  visit_row public.visitas_servicio;
  visit_version uuid;
begin
  perform public.require_authenticated_cuenta();
  if target_device is null then
    raise exception using errcode = '22023', message = 'A device id is required';
  end if;
  select taller_movil_id into provider
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = '42501', message = 'Only a Taller Móvil can use the offline working set';
  end if;
  select current_version_id into latest_version from public.replacement_catalog_state where singleton;

  for visit_row in
    select v.*
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= now() and v.starts_at < now() + interval '2 days'))
  loop
    visit_version := coalesce(visit_row.replacement_catalog_version_id, latest_version);
    insert into public.visit_catalog_downloads(visit_id, device_id, replacement_catalog_version_id, downloaded_at)
    values (visit_row.id, target_device, visit_version, clock_timestamp())
    on conflict (visit_id, device_id) do update
      set replacement_catalog_version_id = excluded.replacement_catalog_version_id,
          downloaded_at = excluded.downloaded_at;
  end loop;

  return jsonb_build_object(
    'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(latest_version),
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'visit', to_jsonb(v) || jsonb_build_object('sync_version', v.sync_version),
          'work_orders', coalesce((
            select jsonb_agg(to_jsonb(ot) || jsonb_build_object(
              'sync_version', ot.sync_version,
              'certificate_id', c.id,
              'certificate', to_jsonb(c)
            ) order by ot.created_at, ot.id)
            from public.ordenes_trabajo ot
            left join public.certificados c on c.orden_trabajo_id = ot.id
            where ot.visita_id = v.id
          ), '[]'::jsonb),
          'context', public.api_yacimiento_tree(v.yacimiento_id),
          'assigned_technicians', coalesce((
            select jsonb_agg(to_jsonb(person) order by person.nombre, person.apellido)
            from public.personas person
            where person.id = any(coalesce((
              select staffing.persona_ids
              from public.nominas_jornada staffing
              where staffing.taller_movil_id = v.taller_movil_id
                and staffing.fecha = v.starts_at::date
              limit 1
            ), '{}'::uuid[]))
          ), '[]'::jsonb),
          'claim', (
            select jsonb_build_object('device_id', claim.device_id, 'claimed_at', claim.claimed_at, 'last_seen_at', claim.last_seen_at)
            from public.dispositivos_visita claim where claim.visita_id = v.id
          ),
          'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(
            coalesce(v.replacement_catalog_version_id, latest_version)
          )
        ) order by v.starts_at, v.id
      )
      from public.visitas_servicio v
      where v.taller_movil_id = provider
        and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= now() and v.starts_at < now() + interval '2 days'))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.api_offline_working_set_for_device(uuid) from public, anon, authenticated;
grant execute on function public.api_offline_working_set_for_device(uuid) to service_role;

create or replace function public.api_start_visit_with_catalog(
  visit_id uuid,
  replacement_catalog_version_id uuid,
  target_device uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  claimed_device uuid;
  downloaded_version uuid;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  select device_id into claimed_device from public.dispositivos_visita where visita_id = visit_id for update;
  if claimed_device is distinct from target_device then
    raise exception using errcode = '42501', message = 'The visit is not claimed by this device';
  end if;
  if visit_row.estado = 'en_curso' then
    if visit_row.replacement_catalog_version_id = replacement_catalog_version_id then
      return public.api_visit(visit_id);
    end if;
    raise exception using errcode = '23514', message = 'The visit is already bound to a different replacement catalog version';
  end if;
  if visit_row.estado <> 'aceptada' then
    raise exception using errcode = '23514', message = 'Only an accepted visit can begin';
  end if;
  select d.replacement_catalog_version_id into downloaded_version
  from public.visit_catalog_downloads d
  where d.visit_id = api_start_visit_with_catalog.visit_id and d.device_id = target_device;
  if downloaded_version is distinct from replacement_catalog_version_id then
    raise exception using errcode = '23514', message = 'The replacement catalog version was not the last version downloaded for this visit and device';
  end if;
  if not exists (select 1 from public.replacement_catalog_versions where id = replacement_catalog_version_id) then
    raise exception using errcode = '23503', message = 'The replacement catalog version does not exist';
  end if;
  update public.visitas_servicio
  set estado = 'en_curso',
      replacement_catalog_version_id = api_start_visit_with_catalog.replacement_catalog_version_id,
      updated_at = now()
  where id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

-- Compatibility RPC: older online callers did not send a device or revision.
-- Preserve that route by pinning the currently published revision atomically.
create or replace function public.api_start_visit(visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  current_version uuid;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  if visit_row.estado <> 'aceptada' then
    raise exception using errcode = '23514', message = 'Only an accepted visit can begin';
  end if;
  select current_version_id into current_version from public.replacement_catalog_state where singleton;
  update public.visitas_servicio
  set estado = 'en_curso', replacement_catalog_version_id = current_version, updated_at = now()
  where id = visit_id;
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_start_visit_with_catalog(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_start_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_start_visit_with_catalog(uuid, uuid, uuid), public.api_start_visit(uuid) to service_role;

-- Keep the existing batch envelope and add start_visit as a durable, idempotent
-- synchronization operation. It uses the version stored with the local start.
create or replace function public.api_sync_visit_batch(
  target_visit uuid,
  operations jsonb,
  target_device uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  operation jsonb;
  op_id uuid;
  op_kind text;
  op_payload jsonb;
  op_schema integer;
  op_device_timestamp timestamptz;
  op_idempotency text;
  stored public.operaciones_sync;
  api_result jsonb;
  response jsonb := '[]'::jsonb;
  visit_version bigint;
  expected_version bigint;
  ack_state public.estado_operacion_sync;
  ack jsonb;
begin
  perform public.api_claim_visit_device(target_visit, target_device);
  if jsonb_typeof(operations) <> 'array' then
    raise exception using errcode = '22023', message = 'operations must be an array';
  end if;

  for operation in select value from jsonb_array_elements(operations) loop
    op_id := null;
    begin
      op_id := (operation->>'operation_id')::uuid;
      op_kind := operation->>'kind';
      op_payload := coalesce(operation->'payload', '{}'::jsonb);
      op_schema := coalesce((operation->>'schema_version')::integer, 1);
      op_device_timestamp := nullif(operation->>'device_timestamp', '')::timestamptz;
      op_idempotency := coalesce(nullif(operation->>'idempotency_key', ''), op_id::text);
      if op_id is null or op_kind is null or op_idempotency is null then
        raise exception using errcode = '22023', message = 'operation_id, idempotency_key and kind are required';
      end if;

      select * into stored from public.operaciones_sync
      where operation_id = op_id or (device_id = target_device and idempotency_key = op_idempotency)
      limit 1;
      if stored.id is not null then
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id, 'estado', stored.estado, 'result', stored.result,
          'error_code', stored.error_code, 'error_message', stored.error_message,
          'server_received_at', stored.server_received_at, 'server_acknowledged_at', stored.server_acknowledged_at
        ));
        continue;
      end if;
      if op_schema <> 1 and op_schema <> 2 then
        raise exception using errcode = '0A000', message = 'Unsupported offline operation schema version';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(coalesce(operation->'dependencies', '[]'::jsonb)) dependency
        where not exists (
          select 1 from public.operaciones_sync os
          where os.operation_id = dependency::uuid and os.visita_id = target_visit and os.estado = 'sincronizada'
        )
      ) then
        raise exception using errcode = '23514', message = 'An offline operation dependency is not synchronized';
      end if;

      select sync_version into visit_version from public.visitas_servicio where id = target_visit for update;
      expected_version := nullif(op_payload->>'expected_version', '')::bigint;
      if expected_version is not null and op_kind = 'complete_visit' and expected_version <> visit_version then
        raise exception using errcode = '40001', message = 'The offline visit version is stale';
      end if;

      insert into public.operaciones_sync(
        operation_id, visita_id, kind, payload, device_id, idempotency_key,
        schema_version, dependencies, device_timestamp, server_received_at, base_versions
      ) values (
        op_id, target_visit, op_kind, op_payload, target_device, op_idempotency,
        op_schema, coalesce(operation->'dependencies', '[]'::jsonb), op_device_timestamp,
        now(), coalesce(operation->'base_versions', '{}'::jsonb)
      );

      begin
        if op_kind = 'start_visit' then
          if nullif(op_payload->>'device_id', '')::uuid is distinct from target_device then
            raise exception using errcode = '42501', message = 'Visit start device does not match the synchronization device';
          end if;
          api_result := public.api_start_visit_with_catalog(
            target_visit,
            nullif(op_payload->>'replacement_catalog_version_id', '')::uuid,
            target_device
          );
        elsif op_kind = 'work_order_outcome' then
          select sync_version into expected_version from public.ordenes_trabajo where id = (op_payload->>'work_order_id')::uuid;
          if nullif(op_payload->>'expected_version', '') is not null and expected_version <> (op_payload->>'expected_version')::bigint then
            raise exception using errcode = '40001', message = 'The offline work order version is stale';
          end if;
          api_result := public.api_update_work_order(
            (op_payload->>'work_order_id')::uuid,
            (op_payload->>'outcome')::public.estado_orden_trabajo,
            op_payload->>'not_evaluated_reason'
          );
        elsif op_kind = 'start_certificate_draft' then
          api_result := public.api_start_certificate_draft((op_payload->>'work_order_id')::uuid, nullif(op_payload->>'certificate_id', '')::uuid);
        elsif op_kind = 'update_certificate_draft' then
          select sync_version into expected_version from public.certificados where id = (op_payload->>'certificate_id')::uuid;
          if nullif(op_payload->>'expected_version', '') is not null and expected_version <> (op_payload->>'expected_version')::bigint then
            raise exception using errcode = '40001', message = 'The offline certificate version is stale';
          end if;
          api_result := public.api_update_certificate_draft((op_payload->>'certificate_id')::uuid, op_payload->'data');
        elsif op_kind in ('capture_evidence', 'upload_evidence', 'upload_photo') then
          api_result := public.api_register_offline_media(
            (op_payload->>'certificate_id')::uuid, nullif(op_payload->>'media_id', '')::uuid,
            coalesce(op_payload->>'category', op_payload->>'section'), op_payload->>'bucket', op_payload->>'object_path',
            coalesce((op_payload->>'unavailable')::boolean, false)
          );
        elsif op_kind = 'submit_signature' then
          api_result := public.api_offline_submit_signature(
            target_visit, (op_payload->>'party')::public.parte_firma_visita,
            op_payload->>'signer_name', op_payload->>'bucket', op_payload->>'object_path',
            nullif(op_payload->>'image_id', '')::uuid, op_device_timestamp
          );
        elsif op_kind = 'finalize_certificate' then
          api_result := public.api_finalize_offline_certificate((op_payload->>'certificate_id')::uuid);
        elsif op_kind = 'complete_visit' then
          api_result := public.api_complete_visit(target_visit);
        else
          raise exception using errcode = '22023', message = 'Unsupported synchronization operation';
        end if;

        update public.operaciones_sync
        set estado = 'sincronizada', result = api_result, server_acknowledged_at = now(), acknowledged_at = now()
        where operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id, 'estado', 'sincronizada', 'result', api_result,
          'server_received_at', (select server_received_at from public.operaciones_sync where operation_id = op_id),
          'server_acknowledged_at', now()
        ));
      exception when others then
        insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
        values (op_id, target_visit, op_payload, sqlerrm) on conflict (operation_id) do nothing;
        update public.operaciones_sync
        set estado = 'conflicto', error_code = sqlstate, error_message = sqlerrm,
            server_acknowledged_at = now(), acknowledged_at = now()
        where operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id, 'estado', 'conflicto', 'error_code', sqlstate, 'error_message', sqlerrm
        ));
      end;
    exception when others then
      if op_id is not null and not exists (select 1 from public.operaciones_sync where operation_id = op_id) then
        insert into public.operaciones_sync(
          operation_id, visita_id, kind, payload, device_id, idempotency_key, schema_version,
          dependencies, device_timestamp, server_received_at, server_acknowledged_at, estado, error_code, error_message
        ) values (
          op_id, target_visit, coalesce(op_kind, 'unknown'), op_payload, target_device,
          coalesce(op_idempotency, op_id::text), coalesce(op_schema, 1),
          coalesce(operation->'dependencies', '[]'::jsonb), op_device_timestamp,
          now(), now(), 'conflicto', sqlstate, sqlerrm
        );
        insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
        values (op_id, target_visit, op_payload, sqlerrm) on conflict (operation_id) do nothing;
      end if;
      response := response || jsonb_build_array(jsonb_build_object(
        'operation_id', coalesce(op_id::text, operation->>'operation_id'),
        'estado', 'conflicto', 'error_code', sqlstate, 'error_message', sqlerrm
      ));
    end;
  end loop;

  select case
    when exists (select 1 from public.operaciones_sync where visita_id = target_visit and estado = 'conflicto') then 'conflicto'::public.estado_operacion_sync
    when exists (select 1 from public.operaciones_sync where visita_id = target_visit and estado <> 'sincronizada') then 'pendiente'::public.estado_operacion_sync
    else 'sincronizada'::public.estado_operacion_sync
  end into ack_state;
  insert into public.visitas_sync_ack(
    visita_id, device_id, estado, operaciones_sincronizadas, operaciones_pendientes,
    operaciones_en_conflicto, server_received_at, server_acknowledged_at
  )
  select target_visit, target_device, ack_state,
    count(*) filter (where estado = 'sincronizada')::integer,
    count(*) filter (where estado = 'pendiente')::integer,
    count(*) filter (where estado = 'conflicto')::integer, now(), now()
  from public.operaciones_sync where visita_id = target_visit
  on conflict (visita_id) do update set
    device_id = excluded.device_id, estado = excluded.estado,
    operaciones_sincronizadas = excluded.operaciones_sincronizadas,
    operaciones_pendientes = excluded.operaciones_pendientes,
    operaciones_en_conflicto = excluded.operaciones_en_conflicto,
    server_received_at = excluded.server_received_at,
    server_acknowledged_at = excluded.server_acknowledged_at;
  ack := jsonb_build_object('visit_id', target_visit, 'estado', ack_state, 'server_received_at', now(), 'server_acknowledged_at', now());
  return jsonb_build_object('visit_id', target_visit, 'operations', response, 'visit_acknowledgement', ack);
end;
$$;

revoke all on function public.api_sync_visit_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_sync_visit_batch(uuid, jsonb, uuid) to service_role;

commit;

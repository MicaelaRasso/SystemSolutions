begin;

-- This migration extends the original offline tables.  The earlier migrations
-- remain historical: queued work must be replayable against the same durable
-- operation identity even after an application or API update.
alter table public.operaciones_sync
  add column if not exists device_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists schema_version integer not null default 1,
  add column if not exists dependencies jsonb not null default '[]'::jsonb,
  add column if not exists device_timestamp timestamptz,
  add column if not exists server_received_at timestamptz,
  add column if not exists server_acknowledged_at timestamptz,
  add column if not exists base_versions jsonb not null default '{}'::jsonb;

update public.operaciones_sync
set idempotency_key = operation_id::text
where idempotency_key is null;

create unique index if not exists operaciones_sync_device_idempotency_idx
  on public.operaciones_sync(device_id, idempotency_key)
  where device_id is not null and idempotency_key is not null;

alter table public.visitas_servicio
  add column if not exists sync_version bigint not null default 1;
alter table public.ordenes_trabajo
  add column if not exists sync_version bigint not null default 1;
alter table public.certificados
  add column if not exists sync_version bigint not null default 1;

create or replace function public.bump_offline_sync_version()
returns trigger
language plpgsql
as $$
begin
  new.sync_version := old.sync_version + 1;
  return new;
end;
$$;

drop trigger if exists visitas_servicio_sync_version on public.visitas_servicio;
create trigger visitas_servicio_sync_version
before update on public.visitas_servicio
for each row execute function public.bump_offline_sync_version();

drop trigger if exists ordenes_trabajo_sync_version on public.ordenes_trabajo;
create trigger ordenes_trabajo_sync_version
before update on public.ordenes_trabajo
for each row execute function public.bump_offline_sync_version();

drop trigger if exists certificados_sync_version on public.certificados;
create trigger certificados_sync_version
before update on public.certificados
for each row execute function public.bump_offline_sync_version();

create table if not exists public.visitas_sync_ack (
  visita_id uuid primary key references public.visitas_servicio(id) on delete cascade,
  device_id uuid not null,
  estado public.estado_operacion_sync not null,
  operaciones_sincronizadas integer not null default 0,
  operaciones_pendientes integer not null default 0,
  operaciones_en_conflicto integer not null default 0,
  server_received_at timestamptz not null default now(),
  server_acknowledged_at timestamptz not null default now(),
  last_error text
);

alter table public.visitas_sync_ack enable row level security;
create index if not exists visitas_sync_ack_device_idx
  on public.visitas_sync_ack(device_id, server_received_at desc);

-- The working set is intentionally limited to the authenticated Técnico's
-- assigned Taller Móvil and the next two days.  Current in-progress visits
-- remain available while a technician reconnects during field work.
create or replace function public.api_offline_working_set()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select taller_movil_id into provider
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = '42501', message = 'Only a Taller Móvil can use the offline working set';
  end if;

  return jsonb_build_object('visits', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'visit', to_jsonb(v) || jsonb_build_object('sync_version', v.sync_version),
        'work_orders', coalesce((
          select jsonb_agg(
            to_jsonb(ot) || jsonb_build_object('sync_version', ot.sync_version)
            order by ot.created_at, ot.id
          )
          from public.ordenes_trabajo ot
          where ot.visita_id = v.id
        ), '[]'::jsonb),
        'context', public.api_yacimiento_tree(v.yacimiento_id),
        'claim', (
          select jsonb_build_object(
            'device_id', claim.device_id,
            'claimed_at', claim.claimed_at,
            'last_seen_at', claim.last_seen_at
          )
          from public.dispositivos_visita claim
          where claim.visita_id = v.id
        )
      ) order by v.starts_at, v.id
    )
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and (
        v.estado = 'en_curso'
        or (
          v.estado = 'aceptada'
          and v.starts_at >= now()
          and v.starts_at < now() + interval '2 days'
        )
      )
  ), '[]'::jsonb));
end;
$$;

create or replace function public.api_claim_visit_device(target_visit uuid, target_device uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_claim public.dispositivos_visita;
  visit_row public.visitas_servicio;
begin
  if target_device is null then
    raise exception using errcode = '22023', message = 'A device id is required';
  end if;
  select * into visit_row from public.api_assigned_visit(target_visit);
  if visit_row.estado not in ('aceptada', 'en_curso') then
    raise exception using errcode = 'check_violation', message = 'Only an active visit can be claimed';
  end if;

  select * into current_claim
  from public.dispositivos_visita
  where visita_id = target_visit
  for update;
  if current_claim.visita_id is not null and current_claim.device_id <> target_device then
    raise exception using errcode = 'serialization_failure', message = 'Another device is already working on this visit';
  end if;

  insert into public.dispositivos_visita(visita_id, device_id, claimed_at, last_seen_at)
  values (target_visit, target_device, now(), now())
  on conflict (visita_id) do update
    set last_seen_at = now();
  return jsonb_build_object(
    'visit_id', target_visit,
    'device_id', target_device,
    'claimed_at', coalesce(current_claim.claimed_at, now()),
    'last_seen_at', now()
  );
end;
$$;

-- Device supplied IDs are accepted for offline-created certificate entities;
-- online callers continue to use the historical one-argument function.
create or replace function public.api_start_certificate_draft(
  work_order_id uuid,
  target_certificate_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.ordenes_trabajo;
  v public.visitas_servicio;
  yid uuid;
  pid uuid;
  eid uuid;
  revision uuid;
  c public.certificados;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null or o.estado <> 'evaluada' then
    raise exception using errcode = '23514', message = 'Only an evaluated work order can create a certificate draft';
  end if;
  select * into v from public.api_assigned_visit(o.visita_id);
  if v.estado <> 'en_curso' then
    raise exception using errcode = '23514', message = 'Certificate drafts can be started only while the visit is in progress';
  end if;
  select p.yacimiento_id, p.id, e.id into yid, pid, eid
  from public.valvulas x
  join public.equipos_unidades e on e.id = x.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where x.id = o.valvula_id;
  insert into public.valvula_revisiones(valvula_id, datos)
  select o.valvula_id, jsonb_build_object('tag', x.nombre)
  from public.valvulas x where x.id = o.valvula_id
  returning id into revision;
  insert into public.certificados(
    id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id,
    equipo_id, valvula_revision_id
  )
  values (
    coalesce(target_certificate_id, gen_random_uuid()), o.id, o.visita_id,
    o.valvula_id, yid, pid, eid, revision
  )
  on conflict (orden_trabajo_id) do update set updated_at = public.certificados.updated_at
  returning * into c;
  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.api_register_offline_media(
  target_certificate uuid,
  target_media uuid,
  media_category text,
  bucket_name text,
  asset_path text,
  unavailable boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.certificados;
  image public.imagenes_certificado;
  evidence jsonb;
begin
  select * into c from public.certificados where id = target_certificate for update;
  if c.id is null then
    raise exception using errcode = '02000', message = 'Certificate not found';
  end if;
  if c.estado_captura <> 'abierto' then
    raise exception using errcode = '23514', message = 'Certificate capture is closed';
  end if;
  if unavailable then
    evidence := c.evidencia_fotografica || jsonb_build_object(media_category, null);
  else
    insert into public.imagenes_certificado(id, bucket, object_path, categoria)
    values (coalesce(target_media, gen_random_uuid()), bucket_name, asset_path, media_category)
    on conflict (id) do update set bucket = excluded.bucket, object_path = excluded.object_path;
    select * into image
    from public.imagenes_certificado
    where id = target_media;
    evidence := c.evidencia_fotografica || jsonb_build_object(
      media_category,
      jsonb_build_object('image_id', image.id, 'bucket', image.bucket, 'object_path', image.object_path)
    );
  end if;
  update public.certificados
  set evidencia_fotografica = evidence, updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('certificate', to_jsonb(c), 'media_id', image.id);
end;
$$;

create or replace function public.api_offline_submit_signature(
  target_visit uuid,
  signing_party public.parte_firma_visita,
  signer_name text,
  bucket_name text,
  asset_path text,
  target_image_id uuid,
  captured_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.visitas_servicio;
  image_id uuid;
  signature_id uuid;
begin
  select * into v from public.api_assigned_visit(target_visit);
  if signer_name is null or btrim(signer_name) = '' or bucket_name is null or asset_path is null then
    raise exception using errcode = '22023', message = 'A signature image and signer name are required';
  end if;
  -- The assigned Técnico may capture a physically present Cliente signature;
  -- the owning Cliente may also submit their own signature.
  if signing_party = 'cliente'
    and not exists (
      select 1 from public.yacimientos y
      where y.id = v.yacimiento_id and y.cliente_cuenta_id = auth.uid()
    ) then
    perform public.api_assigned_visit(target_visit);
  end if;
  insert into public.imagenes_certificado(id, bucket, object_path, categoria)
  values (coalesce(target_image_id, gen_random_uuid()), bucket_name, asset_path, 'firma_' || signing_party::text)
  on conflict (id) do update set bucket = excluded.bucket, object_path = excluded.object_path
  returning id into image_id;
  insert into public.firmas_visita(visita_id, parte, nombre_firmante, cuenta_id, imagen_id, captured_at)
  values (target_visit, signing_party, btrim(signer_name), auth.uid(), image_id, coalesce(captured_at, now()))
  returning id into signature_id;
  return jsonb_build_object('signature_id', signature_id, 'image_id', image_id);
exception when unique_violation then
  raise exception using errcode = '23514', message = 'A visit signature cannot be replaced';
end;
$$;

create or replace function public.api_finalize_offline_certificate(target_certificate uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.certificados;
begin
  select * into c from public.certificados where id = target_certificate for update;
  if c.id is null then
    raise exception using errcode = '02000', message = 'Certificate not found';
  end if;
  if c.estado = 'finalizado' then
    return jsonb_build_object('certificate', to_jsonb(c));
  end if;
  if c.estado_captura <> 'cerrado' then
    raise exception using errcode = '23514', message = 'Certificate capture is still open';
  end if;
  perform public.api_finalize_visit_certificates(c.visita_id);
  select * into c from public.certificados where id = target_certificate;
  return jsonb_build_object('certificate', to_jsonb(c));
end;
$$;

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
      where operation_id = op_id
         or (device_id = target_device and idempotency_key = op_idempotency)
      limit 1;
      if stored.id is not null then
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id,
          'estado', stored.estado,
          'result', stored.result,
          'error_code', stored.error_code,
          'error_message', stored.error_message,
          'server_received_at', stored.server_received_at,
          'server_acknowledged_at', stored.server_acknowledged_at
        ));
        continue;
      end if;
      if op_schema <> 1 and op_schema <> 2 then
        raise exception using errcode = '0A000', message = 'Unsupported offline operation schema version';
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(coalesce(operation->'dependencies', '[]'::jsonb)) dependency
        where not exists (
          select 1 from public.operaciones_sync os
          where os.operation_id = dependency::uuid
            and os.visita_id = target_visit
            and os.estado = 'sincronizada'
        )
      ) then
        raise exception using errcode = '23514', message = 'An offline operation dependency is not synchronized';
      end if;

      select sync_version into visit_version
      from public.visitas_servicio where id = target_visit for update;
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
        if op_kind = 'work_order_outcome' then
          select sync_version into expected_version from public.ordenes_trabajo
          where id = (op_payload->>'work_order_id')::uuid;
          if nullif(op_payload->>'expected_version', '') is not null
             and expected_version <> (op_payload->>'expected_version')::bigint then
            raise exception using errcode = '40001', message = 'The offline work order version is stale';
          end if;
          api_result := public.api_update_work_order(
            (op_payload->>'work_order_id')::uuid,
            (op_payload->>'outcome')::public.estado_orden_trabajo,
            op_payload->>'not_evaluated_reason'
          );
        elsif op_kind = 'start_certificate_draft' then
          api_result := public.api_start_certificate_draft(
            (op_payload->>'work_order_id')::uuid,
            nullif(op_payload->>'certificate_id', '')::uuid
          );
        elsif op_kind = 'update_certificate_draft' then
          select sync_version into expected_version from public.certificados
          where id = (op_payload->>'certificate_id')::uuid;
          if nullif(op_payload->>'expected_version', '') is not null
             and expected_version <> (op_payload->>'expected_version')::bigint then
            raise exception using errcode = '40001', message = 'The offline certificate version is stale';
          end if;
          api_result := public.api_update_certificate_draft(
            (op_payload->>'certificate_id')::uuid, op_payload->'data'
          );
        elsif op_kind in ('capture_evidence', 'upload_evidence', 'upload_photo') then
          api_result := public.api_register_offline_media(
            (op_payload->>'certificate_id')::uuid,
            nullif(op_payload->>'media_id', '')::uuid,
            coalesce(op_payload->>'category', op_payload->>'section'),
            op_payload->>'bucket', op_payload->>'object_path',
            coalesce((op_payload->>'unavailable')::boolean, false)
          );
        elsif op_kind = 'submit_signature' then
          api_result := public.api_offline_submit_signature(
            target_visit,
            (op_payload->>'party')::public.parte_firma_visita,
            op_payload->>'signer_name', op_payload->>'bucket', op_payload->>'object_path',
            nullif(op_payload->>'image_id', '')::uuid,
            op_device_timestamp
          );
        elsif op_kind = 'finalize_certificate' then
          api_result := public.api_finalize_offline_certificate(
            (op_payload->>'certificate_id')::uuid
          );
        elsif op_kind = 'complete_visit' then
          api_result := public.api_complete_visit(target_visit);
        else
          raise exception using errcode = '22023', message = 'Unsupported synchronization operation';
        end if;

        update public.operaciones_sync
        set estado = 'sincronizada', result = api_result,
            server_acknowledged_at = now(), acknowledged_at = now()
        where operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id, 'estado', 'sincronizada', 'result', api_result,
          'server_received_at', (select server_received_at from public.operaciones_sync where operation_id = op_id),
          'server_acknowledged_at', now()
        ));
      exception when others then
        insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
        values (op_id, target_visit, op_payload, sqlerrm)
        on conflict (operation_id) do nothing;
        update public.operaciones_sync
        set estado = 'conflicto', error_code = sqlstate, error_message = sqlerrm,
            server_acknowledged_at = now(), acknowledged_at = now()
        where operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', op_id, 'estado', 'conflicto', 'error_code', sqlstate,
          'error_message', sqlerrm
        ));
      end;
    exception when others then
      -- Validation and unsupported-schema errors are also durable conflicts;
      -- the operation payload is retained for administrative resolution.
      if op_id is not null and not exists (
        select 1 from public.operaciones_sync where operation_id = op_id
      ) then
        insert into public.operaciones_sync(
          operation_id, visita_id, kind, payload, device_id, idempotency_key,
          schema_version, dependencies, device_timestamp, server_received_at,
          server_acknowledged_at, estado, error_code, error_message
        ) values (
          op_id, target_visit, coalesce(op_kind, 'unknown'), op_payload, target_device,
          coalesce(op_idempotency, op_id::text), coalesce(op_schema, 1),
          coalesce(operation->'dependencies', '[]'::jsonb), op_device_timestamp,
          now(), now(), 'conflicto', sqlstate, sqlerrm
        );
        insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
        values (op_id, target_visit, op_payload, sqlerrm)
        on conflict (operation_id) do nothing;
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
    visita_id, device_id, estado, operaciones_sincronizadas,
    operaciones_pendientes, operaciones_en_conflicto,
    server_received_at, server_acknowledged_at
  )
  select target_visit, target_device, ack_state,
    count(*) filter (where estado = 'sincronizada')::integer,
    count(*) filter (where estado = 'pendiente')::integer,
    count(*) filter (where estado = 'conflicto')::integer,
    now(), now()
  from public.operaciones_sync
  where visita_id = target_visit
  on conflict (visita_id) do update set
    device_id = excluded.device_id, estado = excluded.estado,
    operaciones_sincronizadas = excluded.operaciones_sincronizadas,
    operaciones_pendientes = excluded.operaciones_pendientes,
    operaciones_en_conflicto = excluded.operaciones_en_conflicto,
    server_received_at = excluded.server_received_at,
    server_acknowledged_at = excluded.server_acknowledged_at;
  ack := jsonb_build_object(
    'visit_id', target_visit, 'estado', ack_state,
    'server_received_at', now(), 'server_acknowledged_at', now()
  );
  return jsonb_build_object(
    'visit_id', target_visit,
    'operations', response,
    'visit_acknowledgement', ack
  );
end;
$$;

-- Application data remains reachable only through the authenticated Edge
-- gateway.  The RPC is service_role-only after the gateway migration.
revoke all on function public.api_offline_working_set() from public, anon, authenticated;
revoke all on function public.api_claim_visit_device(uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_start_certificate_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_register_offline_media(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.api_finalize_offline_certificate(uuid) from public, anon, authenticated;
revoke all on function public.api_sync_visit_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_offline_working_set(), public.api_claim_visit_device(uuid, uuid), public.api_start_certificate_draft(uuid, uuid), public.api_register_offline_media(uuid, uuid, text, text, text, boolean), public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz), public.api_finalize_offline_certificate(uuid), public.api_sync_visit_batch(uuid, jsonb, uuid) to service_role;

commit;

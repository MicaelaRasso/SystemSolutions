begin;

-- E3 (#96), decisión (e) de la usuaria (2026-11-16): las operaciones offline que lleguen después
-- del cierre de la visita pasan a conflicto para el Administrador. Una visita en «Requiere
-- finalización» (`requiere_finalizacion`, 20261116121000) ya no acepta operaciones del taller sin
-- revisión.
--
-- * `api_sync_visit_batch` y `api_sync_visit_part_diario_batch`: si la visita está en
--   `requiere_finalizacion`, cada operación nueva del lote (fotos, firmas, borradores, órdenes,
--   `add_work_order`, `create_valve`, Parte diario y completar) queda en `conflicto` con el motivo
--   «The visit was closed at the end of its day and requires finalization» (SQLSTATE 55000) y no
--   modifica la visita. Los reenvíos de operaciones ya registradas devuelven su recibo, como antes.
--   El reconocimiento del lote informa además el estado de la visita (`backend_status`).
-- * `api_claim_visit_device` admite la visita en `requiere_finalizacion`: sin esto el lote entero
--   (y la subida de archivos) fallaba y el dispositivo reintentaba en bucle en lugar de recibir el
--   conflicto.
-- * El Administrador puede aceptar esos conflictos: `visit_open_for_field_work(v)` deja operar sobre
--   la visita vencida solo mientras se acepta un conflicto suyo (`app.sync_conflict_resolution_id`,
--   como `api_assigned_visit`). La usan las funciones de trabajo de campo, que antes exigían
--   `en_curso`. Una orden aceptada tarde no vuelve a reservar el equipo. Aceptar `complete_visit`
--   completa la visita si cumple las condiciones de cierre. Las firmas siguen sin poder aceptarse:
--   se rechazan y el Técnico (panel) o el Cliente (portal) firman de nuevo (#97).
-- * `api_resolve_sync_conflict`: suma la aceptación de las operaciones del Parte diario. La
--   corrección sigue pidiendo inicio y fin estimado de la visita.
--
-- Funciones redefinidas (base = última definición):
--   api_claim_visit_device (20261006151926); api_sync_visit_batch, api_resolve_sync_conflict,
--   api_technician_create_valvula (20261116110500); api_sync_visit_part_diario_batch,
--   api_set_visit_parte_diario, api_register_visit_parte_diario_image (20261019141439);
--   api_update_work_order (20260925000400); api_start_certificate_draft (20261003221209);
--   api_update_certificate_draft (20261116100000); api_add_work_order_with_id (20261116110000);
--   api_complete_visit (20261006130927).

-- La visita admite trabajo de campo: está en curso, o está en «Requiere finalización» y un
-- Administrador activo está aceptando un conflicto de sincronización de esa visita.
create or replace function public.visit_open_for_field_work(v public.visitas_servicio)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select v.estado = 'en_curso'
    or (
      v.estado = 'requiere_finalizacion'
      and exists (
        select 1
        from public.conflictos_sync conflict
        join public.cuentas actor on actor.id = auth.uid()
        where conflict.id::text = current_setting('app.sync_conflict_resolution_id', true)
          and conflict.visita_id = v.id
          and conflict.resolved_at is null
          and actor.rol in ('administrador_regular', 'super_administrador')
          and actor.activo
      )
    )
$$;

revoke all on function public.visit_open_for_field_work(public.visitas_servicio)
  from public, anon, authenticated, service_role;

-- Base: 20261006151926. Admite la visita en «Requiere finalización».
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
  if visit_row.estado not in ('aceptada', 'en_curso', 'requiere_finalizacion') then
    raise exception using errcode = 'check_violation', message = 'Only an active visit can be claimed';
  end if;

  select * into current_claim
  from public.dispositivos_visita
  where visita_id = target_visit
  for update;
  if current_claim.visita_id is not null and current_claim.device_id <> target_device then
    raise exception using errcode = 'serialization_failure', message = 'Another device is already working on this visit';
  end if;

  insert into public.dispositivos_visita as existing_claim(visita_id, device_id, claimed_at, last_seen_at)
  values (target_visit, target_device, now(), now())
  on conflict (visita_id) do update
    set last_seen_at = now()
    where existing_claim.device_id = excluded.device_id
  returning * into current_claim;
  if not found then
    raise exception using errcode = 'serialization_failure', message = 'Another device is already working on this visit';
  end if;
  return jsonb_build_object(
    'visit_id', target_visit,
    'device_id', target_device,
    'claimed_at', current_claim.claimed_at,
    'last_seen_at', current_claim.last_seen_at
  );
end;
$$;

revoke all on function public.api_claim_visit_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_claim_visit_device(uuid, uuid) to service_role;

-- Base: 20261116110500. Conflicto para toda operación nueva sobre una visita vencida.
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
      -- E3 (#96): una visita en «Requiere finalización» no acepta operaciones del taller sin
      -- revisión. La operación queda en conflicto para el Administrador, con este motivo.
      if exists (
        select 1 from public.visitas_servicio
        where id = target_visit and estado = 'requiere_finalizacion'
      ) then
        raise exception using errcode = 'object_not_in_prerequisite_state',
          message = 'The visit was closed at the end of its day and requires finalization';
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
        elsif op_kind = 'add_work_order' then
          -- A1: válvula existente del catálogo agregada en campo. El id de la orden lo genera el
          -- dispositivo para que las operaciones encoladas detrás (resultado, borrador) la referencien.
          api_result := public.api_add_work_order_with_id(
            target_visit,
            (op_payload->>'valvula_id')::uuid,
            nullif(op_payload->>'work_order_id', '')::uuid
          );
        elsif op_kind = 'create_valve' then
          -- A2: válvula nueva dada de alta en campo, con su revisión y su orden de trabajo.
          api_result := public.api_technician_create_valvula(
            target_visit,
            (op_payload->>'valvula_id')::uuid,
            (op_payload->>'equipo_id')::uuid,
            nullif(op_payload->>'work_order_id', '')::uuid,
            coalesce(op_payload->'valvula', '{}'::jsonb)
          );
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
  ack := jsonb_build_object(
    'visit_id', target_visit, 'estado', ack_state,
    'backend_status', (select estado from public.visitas_servicio where id = target_visit),
    'server_received_at', now(), 'server_acknowledged_at', now()
  );
  return jsonb_build_object('visit_id', target_visit, 'operations', response, 'visit_acknowledgement', ack);
end;
$$;

revoke all on function public.api_sync_visit_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_sync_visit_batch(uuid, jsonb, uuid) to service_role;

-- Base: 20261019141439. Igual para las operaciones del Parte diario.
create or replace function public.api_sync_visit_part_diario_batch(
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
  ack_state public.estado_operacion_sync;
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
      if op_id is null or op_kind is null or op_idempotency is null
        or op_kind not in ('set_part_diario', 'attach_part_diario_image') then
        raise exception using errcode = '22023', message = 'A valid Parte diario operation is required';
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
      -- E3 (#96): una visita en «Requiere finalización» no acepta operaciones del taller sin
      -- revisión. La operación queda en conflicto para el Administrador, con este motivo.
      if exists (
        select 1 from public.visitas_servicio
        where id = target_visit and estado = 'requiere_finalizacion'
      ) then
        raise exception using errcode = 'object_not_in_prerequisite_state',
          message = 'The visit was closed at the end of its day and requires finalization';
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
        raise exception using errcode = 'check_violation', message = 'An offline operation dependency is not synchronized';
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
        if op_kind = 'set_part_diario' then
          api_result := public.api_set_visit_parte_diario(target_visit, op_payload->>'codigo');
        else
          api_result := public.api_register_visit_parte_diario_image(
            target_visit,
            op_payload->>'codigo',
            nullif(op_payload->>'image_id', '')::uuid,
            op_payload->>'bucket',
            op_payload->>'object_path'
          );
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

  return jsonb_build_object(
    'visit_id', target_visit,
    'operations', response,
    'visit_acknowledgement', jsonb_build_object(
      'visit_id', target_visit, 'estado', ack_state,
      'backend_status', (select estado from public.visitas_servicio where id = target_visit),
      'server_received_at', now(), 'server_acknowledged_at', now()
    )
  );
end;
$$;

revoke all on function public.api_sync_visit_part_diario_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_sync_visit_part_diario_batch(uuid, jsonb, uuid) to service_role;

-- Base: 20261116110500. Suma la aceptación del Parte diario.
create or replace function public.api_resolve_sync_conflict(
  p_target_conflict uuid,
  p_resolution_action text,
  p_action_reason text,
  correction_source_certificate_id uuid default null,
  correction_provider_id uuid default null,
  correction_starts_at timestamptz default null,
  correction_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict_row public.conflictos_sync;
  operation_row public.operaciones_sync;
  visit_row public.visitas_servicio;
  v_resolution_result jsonb;
  correction_result jsonb;
  source_id uuid;
  claimed_device uuid;
  sync_ack_state public.estado_operacion_sync;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can resolve synchronization conflicts';
  end if;
  if p_resolution_action is null or p_resolution_action not in ('accept', 'reject', 'correction') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Resolution must be accept, reject, or correction';
  end if;
  if nullif(btrim(p_action_reason), '') is null or length(btrim(p_action_reason)) > 1000 then
    raise exception using errcode = 'invalid_parameter_value', message = 'A resolution reason of 1 to 1000 characters is required';
  end if;

  select * into conflict_row from public.conflictos_sync where id = p_target_conflict for update;
  if conflict_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Synchronization conflict not found';
  end if;
  select * into operation_row from public.operaciones_sync where operation_id = conflict_row.operation_id for update;
  select * into visit_row from public.visitas_servicio where id = conflict_row.visita_id;

  if conflict_row.resolved_at is not null then
    if conflict_row.resolution_action = (case p_resolution_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'correction_authorized' end)
       and conflict_row.resolution_reason = btrim(p_action_reason)
       and (p_resolution_action <> 'correction' or (
         (conflict_row.resolution_result#>>'{request,source_certificate_id}')::uuid = coalesce(
           correction_source_certificate_id,
           nullif(conflict_row.payload->>'certificate_id', '')::uuid
         )
         and (conflict_row.resolution_result#>>'{request,provider_id}')::uuid = correction_provider_id
         and (conflict_row.resolution_result#>>'{request,starts_at}')::timestamptz = correction_starts_at
         and (conflict_row.resolution_result#>>'{request,ends_at}')::timestamptz = correction_ends_at
       )) then
      return conflict_row.resolution_result;
    end if;
    raise exception using errcode = 'check_violation', message = 'This synchronization conflict has already been resolved';
  end if;
  if operation_row.id is null or visit_row.id is null then
    raise exception using errcode = 'foreign_key_violation', message = 'The original synchronization operation is unavailable';
  end if;

  if p_resolution_action = 'accept' then
    perform set_config('app.sync_conflict_resolution_id', conflict_row.id::text, true);
    case operation_row.kind
      when 'start_visit' then
        if nullif(conflict_row.payload->>'device_id', '') is null then
          v_resolution_result := public.api_start_visit(conflict_row.visita_id);
        else
          claimed_device := nullif(conflict_row.payload->>'device_id', '')::uuid;
          if operation_row.device_id is distinct from claimed_device then
            raise exception using errcode = 'check_violation', message = 'The conflicted start operation is not bound to its original device';
          end if;
          if not exists (
            select 1 from public.dispositivos_visita claim
            where claim.visita_id = conflict_row.visita_id and claim.device_id = claimed_device
          ) then
            raise exception using errcode = 'check_violation', message = 'The original device must still hold the visit claim to accept its start operation';
          end if;
          v_resolution_result := public.api_start_visit_with_catalog(
            conflict_row.visita_id,
            nullif(conflict_row.payload->>'replacement_catalog_version_id', '')::uuid,
            claimed_device
          );
        end if;
      when 'work_order_outcome' then
        v_resolution_result := public.api_update_work_order(
          (conflict_row.payload->>'work_order_id')::uuid,
          (conflict_row.payload->>'outcome')::public.estado_orden_trabajo,
          conflict_row.payload->>'not_evaluated_reason'
        );
      when 'start_certificate_draft' then
        v_resolution_result := public.api_start_certificate_draft(
          (conflict_row.payload->>'work_order_id')::uuid,
          nullif(conflict_row.payload->>'certificate_id', '')::uuid
        );
      when 'update_certificate_draft' then
        v_resolution_result := public.api_update_certificate_draft(
          (conflict_row.payload->>'certificate_id')::uuid,
          conflict_row.payload->'data'
        );
      when 'capture_evidence', 'upload_evidence', 'upload_photo' then
        select visita_id into source_id
        from public.certificados
        where id = (conflict_row.payload->>'certificate_id')::uuid;
        if source_id is distinct from conflict_row.visita_id then
          raise exception using errcode = 'check_violation', message = 'Evidence does not belong to the conflicted visit';
        end if;
        perform 1 from public.visitas_servicio where id = conflict_row.visita_id for update;
        v_resolution_result := public.api_register_offline_media(
          (conflict_row.payload->>'certificate_id')::uuid,
          nullif(conflict_row.payload->>'media_id', '')::uuid,
          coalesce(conflict_row.payload->>'category', conflict_row.payload->>'section'),
          conflict_row.payload->>'bucket',
          conflict_row.payload->>'object_path',
          coalesce((conflict_row.payload->>'unavailable')::boolean, false)
        );
      when 'finalize_certificate' then
        if not exists (
          select 1 from public.certificados certificate
          where certificate.id = (conflict_row.payload->>'certificate_id')::uuid
            and certificate.visita_id = conflict_row.visita_id
        ) then
          raise exception using errcode = 'check_violation', message = 'The certificate does not belong to the conflicted visit';
        end if;
        v_resolution_result := public.api_finalize_offline_certificate((conflict_row.payload->>'certificate_id')::uuid);
      when 'add_work_order' then
        v_resolution_result := public.api_add_work_order_with_id(
          conflict_row.visita_id,
          (conflict_row.payload->>'valvula_id')::uuid,
          nullif(conflict_row.payload->>'work_order_id', '')::uuid
        );
      when 'create_valve' then
        v_resolution_result := public.api_technician_create_valvula(
          conflict_row.visita_id,
          (conflict_row.payload->>'valvula_id')::uuid,
          (conflict_row.payload->>'equipo_id')::uuid,
          nullif(conflict_row.payload->>'work_order_id', '')::uuid,
          coalesce(conflict_row.payload->'valvula', '{}'::jsonb)
        );
      when 'set_part_diario' then
        v_resolution_result := public.api_set_visit_parte_diario(
          conflict_row.visita_id,
          conflict_row.payload->>'codigo'
        );
      when 'attach_part_diario_image' then
        v_resolution_result := public.api_register_visit_parte_diario_image(
          conflict_row.visita_id,
          conflict_row.payload->>'codigo',
          nullif(conflict_row.payload->>'image_id', '')::uuid,
          conflict_row.payload->>'bucket',
          conflict_row.payload->>'object_path'
        );
      when 'complete_visit' then
        v_resolution_result := public.api_complete_visit(conflict_row.visita_id);
      when 'submit_signature' then
        raise exception using errcode = 'check_violation', message = 'An Administrador cannot accept a visit-signature operation; reject it or authorize a certificate correction';
      else
        raise exception using errcode = 'invalid_parameter_value', message = 'This synchronization operation cannot be accepted; reject it or authorize a certificate correction';
    end case;
    v_resolution_result := jsonb_build_object(
      'resolution', 'accepted',
      'reason', btrim(p_action_reason),
      'operation_result', v_resolution_result
    );
  elsif p_resolution_action = 'reject' then
    v_resolution_result := jsonb_build_object(
      'resolution', 'rejected',
      'reason', btrim(p_action_reason),
      'operation_id', conflict_row.operation_id
    );
  else
    source_id := coalesce(
      correction_source_certificate_id,
      nullif(conflict_row.payload->>'certificate_id', '')::uuid
    );
    if correction_provider_id is null or correction_starts_at is null or correction_ends_at is null then
      raise exception using errcode = 'invalid_parameter_value', message = 'Correction resolution requires a Taller Móvil and visit start/end times';
    end if;
    if source_id is null or not exists (
      select 1 from public.certificados source
      where source.id = source_id
        and source.visita_id = conflict_row.visita_id
        and source.estado_captura = 'cerrado'
    ) then
      raise exception using errcode = 'check_violation', message = 'Correction resolution requires a closed certificate from the conflicted visit';
    end if;
    correction_result := public.api_authorize_certificate_correction(
      source_id,
      correction_provider_id,
      correction_starts_at,
      correction_ends_at,
      btrim(p_action_reason)
    );
    v_resolution_result := jsonb_build_object(
      'resolution', 'correction_authorized',
      'reason', btrim(p_action_reason),
      'request', jsonb_build_object(
        'source_certificate_id', source_id,
        'provider_id', correction_provider_id,
        'starts_at', correction_starts_at,
        'ends_at', correction_ends_at
      ),
      'correction', correction_result
    );
  end if;

  update public.conflictos_sync
  set resolved_at = now(),
      resolution_action = case p_resolution_action
        when 'accept' then 'accepted'
        when 'reject' then 'rejected'
        else 'correction_authorized'
      end,
      resolution_reason = btrim(p_action_reason),
      resolution_actor_cuenta_id = auth.uid(),
      resolution_result = v_resolution_result
  where id = p_target_conflict
  returning * into conflict_row;

  update public.operaciones_sync
  set estado = case when p_resolution_action = 'accept' then 'sincronizada'::public.estado_operacion_sync else 'conflicto'::public.estado_operacion_sync end,
      result = v_resolution_result,
      error_code = case when p_resolution_action = 'accept' then null else 'conflict_resolved_without_application' end,
      error_message = case when p_resolution_action = 'accept' then null else 'Conflict resolved without applying the original operation' end,
      server_acknowledged_at = now(),
      acknowledged_at = now()
  where operation_id = conflict_row.operation_id;

  select case
    when exists (select 1 from public.operaciones_sync where visita_id = conflict_row.visita_id and estado = 'conflicto') then 'conflicto'::public.estado_operacion_sync
    when exists (select 1 from public.operaciones_sync where visita_id = conflict_row.visita_id and estado <> 'sincronizada') then 'pendiente'::public.estado_operacion_sync
    else 'sincronizada'::public.estado_operacion_sync
  end into sync_ack_state;
  claimed_device := coalesce(
    operation_row.device_id,
    (select claim.device_id from public.dispositivos_visita claim where claim.visita_id = conflict_row.visita_id)
  );
  if claimed_device is not null then
    insert into public.visitas_sync_ack(
      visita_id, device_id, estado, operaciones_sincronizadas, operaciones_pendientes,
      operaciones_en_conflicto, server_received_at, server_acknowledged_at
    )
    select conflict_row.visita_id, claimed_device, sync_ack_state,
      count(*) filter (where estado = 'sincronizada')::integer,
      count(*) filter (where estado = 'pendiente')::integer,
      count(*) filter (where estado = 'conflicto')::integer, now(), now()
    from public.operaciones_sync where visita_id = conflict_row.visita_id
    on conflict (visita_id) do update set
      device_id = excluded.device_id,
      estado = excluded.estado,
      operaciones_sincronizadas = excluded.operaciones_sincronizadas,
      operaciones_pendientes = excluded.operaciones_pendientes,
      operaciones_en_conflicto = excluded.operaciones_en_conflicto,
      server_received_at = excluded.server_received_at,
      server_acknowledged_at = excluded.server_acknowledged_at;
  end if;

  return v_resolution_result;
end;
$$;

revoke all on function public.api_resolve_sync_conflict(uuid, text, text, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_resolve_sync_conflict(uuid, text, text, uuid, uuid, timestamptz, timestamptz)
  to service_role;

-- Base: 20260925000400.
create or replace function public.api_update_work_order(work_order_id uuid, outcome public.estado_orden_trabajo, not_evaluated_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.ordenes_trabajo; v public.visitas_servicio;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null then raise exception using errcode = 'no_data_found', message = 'Work order not found'; end if;
  select * into v from public.api_assigned_visit(o.visita_id);
  if not public.visit_open_for_field_work(v) then raise exception using errcode = 'check_violation', message = 'Work orders can be updated only while the visit is in progress'; end if;
  if outcome not in ('evaluada', 'no_evaluada') then raise exception using errcode = 'invalid_parameter_value', message = 'A work order outcome must be evaluada or no_evaluada'; end if;
  if outcome = 'no_evaluada' and (not_evaluated_reason is null or btrim(not_evaluated_reason) = '') then raise exception using errcode = 'invalid_parameter_value', message = 'A no evaluada work order requires a reason'; end if;
  update public.ordenes_trabajo set estado = outcome, no_evaluada_razon = case when outcome = 'no_evaluada' then btrim(not_evaluated_reason) else null end where id = work_order_id returning * into o;
  return jsonb_build_object('work_order', to_jsonb(o));
end;
$$;

revoke all on function public.api_update_work_order(uuid, public.estado_orden_trabajo, text) from public, anon, authenticated;
grant execute on function public.api_update_work_order(uuid, public.estado_orden_trabajo, text) to service_role;

-- Base: 20261003221209.
create or replace function public.api_start_certificate_draft(
  work_order_id uuid,
  target_certificate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.ordenes_trabajo;
  v public.visitas_servicio;
  y public.yacimientos;
  p public.plantas_locaciones;
  e public.equipos_unidades;
  x public.valvulas;
  template_row public.plantillas_certificado;
  revision uuid;
  c public.certificados;
  context_snapshot jsonb;
  template_snapshot jsonb;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null or o.estado <> 'evaluada' then
    raise exception using errcode = 'check_violation', message = 'Only an evaluated work order can create a certificate draft';
  end if;

  select * into v from public.api_assigned_visit(o.visita_id);
  if not public.visit_open_for_field_work(v) then
    raise exception using errcode = 'check_violation', message = 'Certificate drafts can be started only while the visit is in progress';
  end if;

  select * into c from public.certificados where orden_trabajo_id = o.id for update;
  if c.id is not null then
    return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
  end if;

  select * into template_row
  from public.plantillas_certificado
  where estado = 'activa'
  for share;
  if template_row.id is null then
    raise exception using errcode = 'check_violation', message = 'No active certificate template exists';
  end if;

  select * into x from public.valvulas where id = o.valvula_id;
  select * into e from public.equipos_unidades where id = x.equipo_id;
  select * into p from public.plantas_locaciones where id = e.planta_id;
  select * into y from public.yacimientos where id = p.yacimiento_id;
  if x.id is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;

  context_snapshot := jsonb_build_object(
    'yacimiento', to_jsonb(y),
    'planta', to_jsonb(p),
    'equipo', to_jsonb(e),
    'valvula', to_jsonb(x)
  );
  template_snapshot := jsonb_build_object(
    'id', template_row.id,
    'version', template_row.version,
    'campos', template_row.campos
  );

  insert into public.valvula_revisiones(valvula_id, datos)
  values (x.id, to_jsonb(x))
  returning id into revision;

  insert into public.certificados(
    id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id,
    equipo_id, valvula_revision_id, contexto_captura, plantilla_version,
    plantilla_version_id, plantilla_snapshot
  )
  values (
    coalesce(target_certificate_id, gen_random_uuid()), o.id, o.visita_id, x.id,
    y.id, p.id, e.id, revision, context_snapshot, template_row.version,
    template_row.id, template_snapshot
  )
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

revoke all on function public.api_start_certificate_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_start_certificate_draft(uuid, uuid) to service_role;

-- Base: 20261116100000.
create or replace function public.api_update_certificate_draft(certificate_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  v public.visitas_servicio;
  target_visit uuid;
  next_payload jsonb;
  validation jsonb;
  custom_validation jsonb;
  key_name text;
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Certificate payload must be an object';
  end if;

  for key_name in select jsonb_object_keys(payload) loop
    if key_name not in (
      'fecha_ejecucion', 'tecnico_ejecutor', 'datos_tecnicos',
      'campos_personalizados', 'alcance_mantenimiento', 'repuestos',
      'evidencia_fotografica', 'observaciones'
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Unsupported certificate field: ' || key_name;
    end if;
  end loop;

  select visita_id into target_visit
  from public.certificados
  where id = certificate_id;
  if target_visit is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
  select * into v from public.api_assigned_visit(target_visit);
  select * into c
  from public.certificados
  where id = certificate_id
  for update;
  if c.id is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
  if not public.visit_open_for_field_work(v) or c.estado_captura <> 'abierto' or c.estado <> 'borrador' then
    raise exception using errcode = 'check_violation', message = 'Certificate capture is closed';
  end if;

  if payload ? 'fecha_ejecucion' and payload->'fecha_ejecucion' is not null
     and (jsonb_typeof(payload->'fecha_ejecucion') <> 'string'
          or payload->>'fecha_ejecucion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or to_char(to_date(payload->>'fecha_ejecucion', 'YYYY-MM-DD'), 'YYYY-MM-DD')
               is distinct from payload->>'fecha_ejecucion') then
    raise exception using errcode = 'invalid_parameter_value', message = 'fecha_ejecucion must be a valid YYYY-MM-DD date';
  end if;
  if payload ? 'tecnico_ejecutor' and payload->'tecnico_ejecutor' is not null
     and (jsonb_typeof(payload->'tecnico_ejecutor') <> 'string'
          or btrim(payload->>'tecnico_ejecutor') = '') then
    raise exception using errcode = 'invalid_parameter_value', message = 'tecnico_ejecutor must be a non-empty string';
  end if;

  next_payload := jsonb_build_object(
    'fecha_ejecucion', case when payload ? 'fecha_ejecucion' then payload->'fecha_ejecucion' else to_jsonb(c.fecha_ejecucion) end,
    'tecnico_ejecutor', case when payload ? 'tecnico_ejecutor' then payload->'tecnico_ejecutor' else to_jsonb(c.tecnico_ejecutor) end,
    'datos_tecnicos', case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else c.datos_tecnicos end,
    'campos_personalizados', case when payload ? 'campos_personalizados' then payload->'campos_personalizados' else c.campos_personalizados end,
    'alcance_mantenimiento', case when payload ? 'alcance_mantenimiento' then payload->'alcance_mantenimiento' else c.alcance_mantenimiento end,
    'repuestos', case when payload ? 'repuestos' then payload->'repuestos' else c.repuestos end,
    'evidencia_fotografica', case when payload ? 'evidencia_fotografica' then payload->'evidencia_fotografica' else c.evidencia_fotografica end,
    'observaciones', case when payload ? 'observaciones' then payload->'observaciones' else to_jsonb(c.observaciones) end
  );
  validation := public.api_validate_certificate_payload(next_payload);
  custom_validation := public.api_validate_custom_certificate_fields(
    c.plantilla_snapshot,
    next_payload->'campos_personalizados'
  );
  if jsonb_array_length(validation->'invalid_fields') > 0
     or jsonb_array_length(custom_validation->'invalid_fields') > 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid canonical certificate fields: ' || ((validation->'invalid_fields') || (custom_validation->'invalid_fields'))::text;
  end if;

  update public.certificados set
    fecha_ejecucion = case when payload ? 'fecha_ejecucion' then (payload->>'fecha_ejecucion')::date else fecha_ejecucion end,
    tecnico_ejecutor = case when payload ? 'tecnico_ejecutor' then nullif(btrim(payload->>'tecnico_ejecutor'), '') else tecnico_ejecutor end,
    datos_tecnicos = case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else datos_tecnicos end,
    campos_personalizados = case when payload ? 'campos_personalizados' then payload->'campos_personalizados' else campos_personalizados end,
    alcance_mantenimiento = case when payload ? 'alcance_mantenimiento' then payload->'alcance_mantenimiento' else alcance_mantenimiento end,
    repuestos = case when payload ? 'repuestos' then payload->'repuestos' else repuestos end,
    evidencia_fotografica = case when payload ? 'evidencia_fotografica' then payload->'evidencia_fotografica' else evidencia_fotografica end,
    observaciones = case when payload ? 'observaciones' then payload->>'observaciones' else observaciones end,
    updated_at = now()
  where id = certificate_id
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

revoke all on function public.api_update_certificate_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_update_certificate_draft(uuid, jsonb) to service_role;

-- Base: 20261116120100.
create or replace function public.api_add_work_order_with_id(
  visit_id uuid,
  target_valvula uuid,
  target_work_order uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.visitas_servicio;
  target_yacimiento uuid;
  target_equipo uuid;
  owner_id uuid;
  provider uuid;
  o public.ordenes_trabajo;
begin
  select * into v from public.api_assigned_visit(visit_id);

  -- Reenvío de la misma alta: devuelve la orden ya creada.
  if target_work_order is not null then
    select * into o from public.ordenes_trabajo where id = target_work_order;
    if o.id is not null then
      if o.visita_id <> visit_id or o.valvula_id is distinct from target_valvula then
        raise exception using errcode = 'check_violation', message = 'The work order id is already used by another Orden de trabajo';
      end if;
      return public.field_work_order_result(o.id);
    end if;
  end if;

  if not public.visit_open_for_field_work(v) then
    raise exception using errcode = 'check_violation', message = 'Válvulas can be added only while the visit is in progress';
  end if;

  select p.yacimiento_id, x.equipo_id
  into target_yacimiento, target_equipo
  from public.valvulas x
  join public.equipos_unidades e on e.id = x.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where x.id = target_valvula;
  if target_yacimiento is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;

  select cliente_cuenta_id into owner_id
  from public.yacimientos
  where id = v.yacimiento_id;
  if not exists (
    select 1 from public.yacimientos
    where id = target_yacimiento and cliente_cuenta_id = owner_id
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'An added Válvula must belong to the same Cliente';
  end if;

  select taller_movil_id into provider
  from public.asignaciones_servicio
  where yacimiento_id = target_yacimiento and estado = 'activa';
  if provider is null or provider <> v.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'The Taller Móvil requires active Yacimiento access';
  end if;

  insert into public.ordenes_trabajo(id, visita_id, valvula_id)
  values (coalesce(target_work_order, gen_random_uuid()), visit_id, target_valvula)
  on conflict (visita_id, valvula_id) do update set valvula_id = excluded.valvula_id
  returning * into o;

  -- Una visita en «Requiere finalización» ya liberó sus equipos: aceptar un alta tardía no los
  -- vuelve a reservar.
  if v.estado = 'en_curso' then
    insert into public.visita_equipos(visita_id, equipo_id, ventana)
    values (visit_id, target_equipo, tstzrange(v.starts_at, v.ends_at, '[)'))
    on conflict (visita_id, equipo_id) do nothing;
  end if;

  return public.field_work_order_result(o.id);
end;
$$;

revoke all on function public.api_add_work_order_with_id(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_add_work_order_with_id(uuid, uuid, uuid) to service_role;

-- Base: 20261116110500.
create or replace function public.api_technician_create_valvula(
  visit_id uuid,
  target_valvula uuid,
  target_equipo uuid,
  target_work_order uuid,
  valve_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.visitas_servicio;
  target_yacimiento uuid;
  owner_id uuid;
  provider uuid;
  valve_row public.valvulas;
begin
  -- Solo el taller asignado (o el Administrador al aceptar un conflicto de esta visita).
  select * into v from public.api_assigned_visit(visit_id);
  if target_valvula is null or target_equipo is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A Válvula id and an Equipo are required';
  end if;
  if valve_data is null or jsonb_typeof(valve_data) <> 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Válvula data must be an object';
  end if;

  select * into valve_row from public.valvulas where id = target_valvula for update;
  if valve_row.id is not null then
    -- Reintento de la misma alta: no se vuelve a crear ni a revisar; solo se asegura la orden.
    if valve_row.equipo_id <> target_equipo then
      raise exception using errcode = 'check_violation', message = 'The Válvula id is already used by another Válvula';
    end if;
    return public.api_add_work_order_with_id(visit_id, target_valvula, target_work_order)
      || jsonb_build_object('valvula', to_jsonb(valve_row));
  end if;

  if not public.visit_open_for_field_work(v) then
    raise exception using errcode = 'insufficient_privilege', message = 'Válvulas can be created only while the visit is in progress';
  end if;

  -- El equipo tiene que existir: en campo no se crean equipos.
  select p.yacimiento_id into target_yacimiento
  from public.equipos_unidades e
  join public.plantas_locaciones p on p.id = e.planta_id
  where e.id = target_equipo;
  if target_yacimiento is null then
    raise exception using errcode = 'no_data_found', message = 'Equipo not found';
  end if;

  select cliente_cuenta_id into owner_id from public.yacimientos where id = v.yacimiento_id;
  if not exists (
    select 1 from public.yacimientos
    where id = target_yacimiento and cliente_cuenta_id = owner_id
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'A created Válvula must belong to the visit Cliente';
  end if;

  select taller_movil_id into provider
  from public.asignaciones_servicio
  where yacimiento_id = target_yacimiento and estado = 'activa';
  if provider is null or provider <> v.taller_movil_id then
    raise exception using errcode = 'insufficient_privilege', message = 'The Taller Móvil requires active Yacimiento access';
  end if;

  insert into public.valvulas(
    id, equipo_id, nombre, precinto, servicio, marca, numero_serie, modelo, tipo, pv,
    diametro_entrada, diametro_salida, rosca, presion_operacion, temperatura_operacion, notas
  ) values (
    target_valvula,
    target_equipo,
    public.require_asset_name(valve_data->>'nombre'),
    nullif(btrim(valve_data->>'precinto'), ''),
    nullif(btrim(valve_data->>'servicio'), ''),
    nullif(btrim(valve_data->>'marca'), ''),
    nullif(btrim(valve_data->>'numero_serie'), ''),
    nullif(btrim(valve_data->>'modelo'), ''),
    nullif(btrim(valve_data->>'tipo'), ''),
    nullif(btrim(valve_data->>'pv'), ''),
    nullif(btrim(valve_data->>'diametro_entrada'), ''),
    nullif(btrim(valve_data->>'diametro_salida'), ''),
    nullif(btrim(valve_data->>'rosca'), ''),
    public.field_valve_number(valve_data->>'presion_operacion'),
    public.field_valve_number(valve_data->>'temperatura_operacion'),
    nullif(btrim(valve_data->>'notas'), '')
  )
  returning * into valve_row;

  insert into public.valvula_revisiones(valvula_id, datos)
  values (valve_row.id, to_jsonb(valve_row));

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'jerarquia', target_yacimiento, valve_row.id, auth.uid(),
    jsonb_build_object(
      'event', 'created', 'kind', 'valvula', 'parent_id', target_equipo,
      'source', 'field', 'visit_id', visit_id
    )
  );

  return public.api_add_work_order_with_id(visit_id, target_valvula, target_work_order)
    || jsonb_build_object('valvula', to_jsonb(valve_row));
end;
$$;

revoke all on function public.api_technician_create_valvula(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_technician_create_valvula(uuid, uuid, uuid, uuid, jsonb) to service_role;

-- Base: 20261019141439.
create or replace function public.api_set_visit_parte_diario(target_visit uuid, pd_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
begin
  visit_row := public.api_assigned_visit(target_visit);
  if not public.visit_open_for_field_work(visit_row) then
    raise exception using errcode = 'check_violation', message = 'A Parte diario can only be changed while its visit is in progress';
  end if;
  if pd_code is null or pd_code !~ '^[A-Za-z0-9]+$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'A valid alphanumeric Parte diario code is required';
  end if;

  insert into public.partes_diarios(visita_id, codigo)
  values (target_visit, pd_code)
  on conflict (visita_id) do update
    set codigo = excluded.codigo, updated_at = now();
  return public.api_visit_parte_diario(target_visit);
end;
$$;

revoke all on function public.api_set_visit_parte_diario(uuid, text) from public, anon, authenticated;
grant execute on function public.api_set_visit_parte_diario(uuid, text) to service_role;

-- Base: 20261019141439.
create or replace function public.api_register_visit_parte_diario_image(
  target_visit uuid,
  pd_code text,
  target_image_id uuid,
  bucket_name text,
  asset_path text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  image public.imagenes_certificado;
  linked_image public.parte_diario_imagenes;
  expected_prefix text := 'visits/' || target_visit::text || '/parte-diario/';
begin
  visit_row := public.api_assigned_visit(target_visit);
  if not public.visit_open_for_field_work(visit_row) then
    raise exception using errcode = 'check_violation', message = 'Parte diario images can only be added while the visit is in progress';
  end if;
  if target_image_id is null or pd_code is null or pd_code !~ '^[A-Za-z0-9]+$'
    or bucket_name <> 'certificate-evidence'
    or asset_path is null
    or left(asset_path, length(expected_prefix)) <> expected_prefix
    or asset_path !~ ('^visits/' || target_visit::text || '/parte-diario/' || target_image_id::text || '\.(jpg|png|webp)$') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid Parte diario image reference';
  end if;
  if not exists (
    select 1 from public.partes_diarios
    where visita_id = target_visit and codigo = pd_code
  ) then
    raise exception using errcode = 'check_violation', message = 'The Parte diario code does not belong to this visit';
  end if;

  insert into public.imagenes_certificado(id, bucket, object_path, categoria)
  values (target_image_id, bucket_name, asset_path, 'parte_diario')
  on conflict (id) do nothing;
  select * into image from public.imagenes_certificado where id = target_image_id;
  if image.bucket <> bucket_name or image.object_path <> asset_path or image.categoria <> 'parte_diario' then
    raise exception using errcode = 'unique_violation', message = 'The image identity is already associated with another asset';
  end if;

  insert into public.parte_diario_imagenes(imagen_id, visita_id, codigo)
  values (target_image_id, target_visit, pd_code)
  on conflict (imagen_id) do nothing;
  select * into linked_image from public.parte_diario_imagenes where imagen_id = target_image_id;
  if linked_image.visita_id <> target_visit or linked_image.codigo <> pd_code then
    raise exception using errcode = 'unique_violation', message = 'The image is already linked to another Parte diario';
  end if;

  return jsonb_build_object('image_id', target_image_id, 'pd_code', pd_code);
end;
$$;

revoke all on function public.api_register_visit_parte_diario_image(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.api_register_visit_parte_diario_image(uuid, text, uuid, text, text) to service_role;

-- Base: 20261006130927.
create or replace function public.api_complete_visit(visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  if not public.visit_open_for_field_work(visit_row) then
    raise exception using errcode = 'check_violation', message = 'Only an in-progress visit can be completed';
  end if;

  -- Serialize against an in-flight draft edit before validating its final
  -- contents. The editor locks the certificate row and does not lock the visit.
  perform 1
  from public.certificados certificate
  where certificate.visita_id = visit_id
  order by certificate.id
  for update;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    where work_order.visita_id = visit_id
      and work_order.estado = 'pendiente'
  ) then
    raise exception using errcode = 'check_violation', message = 'Every work order must have an explicit outcome before visit completion';
  end if;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    left join public.certificados certificate
      on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = visit_id
      and work_order.estado = 'evaluada'
      and certificate.id is null
  ) then
    raise exception using errcode = 'check_violation', message = 'Every evaluated work order requires a complete certificate before visit completion';
  end if;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    join public.certificados certificate
      on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = visit_id
      and work_order.estado = 'no_evaluada'
  ) then
    raise exception using errcode = 'check_violation', message = 'An unevaluated work order cannot have a certificate';
  end if;

  if exists (
    select 1
    from public.certificados certificate
    where certificate.visita_id = visit_id
      and not coalesce((public.api_certificate_validation(certificate)->>'complete')::boolean, false)
  ) then
    raise exception using errcode = 'check_violation', message = 'Every evaluated work order requires a complete certificate before visit completion';
  end if;

  if not exists (
    select 1
    from public.firmas_visita signature
    where signature.visita_id = visit_id
      and signature.parte = 'tecnico'
  ) then
    raise exception using errcode = 'check_violation', message = 'A Técnico signature is required to complete a visit';
  end if;

  update public.visitas_servicio
  set estado = 'completada', updated_at = now()
  where id = visit_id;

  -- Each evaluated work order has exactly one editable draft.  A complete
  -- draft becomes pending when Cliente signature is not yet available.
  update public.certificados
  set estado_captura = 'cerrado', estado = 'pendiente', updated_at = now()
  where visita_id = visit_id
    and estado_captura = 'abierto';

  delete from public.visita_equipos where visita_id = visit_id;
  perform public.api_finalize_visit_certificates(visit_id);
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_complete_visit(uuid) from public, anon, authenticated;
grant execute on function public.api_complete_visit(uuid) to service_role;

commit;

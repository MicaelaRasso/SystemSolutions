begin;

-- A2 + A3b (#91): el técnico da de alta en campo una válvula que no está en el catálogo, con o sin
-- conexión. Decisión (a) de la usuaria (2026-11-16): mismos datos que usa el Administrador al crear
-- válvulas; no se crean equipos; la válvula queda definitiva, como si la hubiera creado el
-- Administrador; puede ser de otro yacimiento del mismo Cliente si el taller tiene acceso.
--
-- * `api_technician_create_valvula` crea en una transacción la válvula (con el UUID generado en el
--   dispositivo), su primera revisión y la orden de trabajo (vía `api_add_work_order_with_id`, de
--   20261116110000). Reintentar con el mismo UUID no duplica nada.
-- * `api_sync_visit_batch` y `api_resolve_sync_conflict` (últimas definiciones en 20261116110000)
--   suman la operación offline `create_valve`.

create or replace function public.field_valve_number(raw_value text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare normalized text := replace(btrim(coalesce(raw_value, '')), ',', '.');
begin
  if normalized = '' then
    return null;
  end if;
  if normalized !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Operating pressure and temperature must be numbers';
  end if;
  return normalized::numeric;
end;
$$;

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

  if v.estado <> 'en_curso' then
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

revoke all on function public.field_valve_number(text) from public, anon, authenticated;
revoke all on function public.api_technician_create_valvula(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.field_valve_number(text) to service_role;
grant execute on function public.api_technician_create_valvula(uuid, uuid, uuid, uuid, jsonb) to service_role;

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
  ack := jsonb_build_object('visit_id', target_visit, 'estado', ack_state, 'server_received_at', now(), 'server_acknowledged_at', now());
  return jsonb_build_object('visit_id', target_visit, 'operations', response, 'visit_acknowledgement', ack);
end;
$$;

revoke all on function public.api_sync_visit_batch(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_sync_visit_batch(uuid, jsonb, uuid) to service_role;

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

commit;

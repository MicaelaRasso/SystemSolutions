begin;

alter table public.conflictos_sync
  add column resolution_action text check (resolution_action in ('accepted', 'rejected', 'correction_authorized')),
  add column resolution_reason text,
  add column resolution_actor_cuenta_id uuid references public.cuentas(id),
  add column resolution_result jsonb not null default '{}'::jsonb;

alter table public.conflictos_sync
  add constraint conflictos_sync_resolution_fields
  check (
    (resolved_at is null and resolution_action is null and resolution_reason is null and resolution_actor_cuenta_id is null)
    or (resolved_at is not null and resolution_action is not null and resolution_reason is not null
      and btrim(resolution_reason) <> '' and resolution_actor_cuenta_id is not null)
  );

create or replace function public.prevent_sync_conflict_payload_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'check_violation', message = 'A synchronization conflict and its original payload are immutable';
  end if;
  if old.operation_id is distinct from new.operation_id
     or old.visita_id is distinct from new.visita_id
     or old.payload is distinct from new.payload
     or old.reason is distinct from new.reason
     or old.created_at is distinct from new.created_at then
    raise exception using errcode = 'check_violation', message = 'A synchronization conflict and its original payload are immutable';
  end if;
  if old.resolved_at is not null and (
       old.resolved_at is distinct from new.resolved_at
       or old.resolution_action is distinct from new.resolution_action
       or old.resolution_reason is distinct from new.resolution_reason
       or old.resolution_actor_cuenta_id is distinct from new.resolution_actor_cuenta_id
       or old.resolution_result is distinct from new.resolution_result
     ) then
    raise exception using errcode = 'check_violation', message = 'A synchronization conflict decision is immutable';
  end if;
  return new;
end;
$$;

create trigger conflictos_sync_preserve_original
before update or delete on public.conflictos_sync
for each row execute function public.prevent_sync_conflict_payload_mutation();

-- An administrator may temporarily apply an operation through the existing
-- Taller Móvil APIs only while the resolver is processing an unresolved
-- conflict for the same visit. Ordinary calls keep the assigned-provider gate.
create or replace function public.api_assigned_visit(target uuid)
returns public.visitas_servicio
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  provider_id uuid;
  conflict_override boolean;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = target for update;
  select taller_movil_id into provider_id
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  select exists (
    select 1
    from public.conflictos_sync conflict
    join public.cuentas actor on actor.id = auth.uid()
    where conflict.id::text = current_setting('app.sync_conflict_resolution_id', true)
      and conflict.visita_id = target
      and conflict.resolved_at is null
      and actor.rol in ('administrador_regular', 'super_administrador')
      and actor.activo
  ) into conflict_override;

  if visit_row.id is null or ((provider_id is null or provider_id <> visit_row.taller_movil_id) and not conflict_override) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can execute this visit';
  end if;
  return visit_row;
end;
$$;

create or replace function public.api_sync_conflict(target_conflict uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  conflict_row public.conflictos_sync;
  operation_row public.operaciones_sync;
  visit_row public.visitas_servicio;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can read synchronization conflicts';
  end if;

  select * into conflict_row from public.conflictos_sync where id = target_conflict;
  if conflict_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Synchronization conflict not found';
  end if;
  select * into operation_row from public.operaciones_sync where operation_id = conflict_row.operation_id;
  select * into visit_row from public.visitas_servicio where id = conflict_row.visita_id;
  return jsonb_build_object(
    'conflict', to_jsonb(conflict_row) || jsonb_build_object(
      'operation_kind', operation_row.kind,
      'operation_status', operation_row.estado,
      'operation_result', operation_row.result,
      'visit', to_jsonb(visit_row)
    )
  );
end;
$$;

create or replace function public.api_sync_conflicts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can read synchronization conflicts';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(public.api_sync_conflict(conflict.id)->'conflict' order by conflict.created_at desc, conflict.id)
      from public.conflictos_sync conflict
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_workshop_sync_conflict_outcomes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  perform public.require_authenticated_cuenta();
  select taller_movil_id into provider_id
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider_id is null then
    raise exception using errcode = 'insufficient_privilege', message = 'Only a Taller Móvil can read its synchronization conflict outcomes';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conflict_id', conflict.id,
        'operation_id', conflict.operation_id,
        'visit_id', conflict.visita_id,
        'operation_kind', operation.kind,
        'resolution_action', conflict.resolution_action,
        'resolution_reason', conflict.resolution_reason,
        'resolved_at', conflict.resolved_at,
        'result', conflict.resolution_result
      ) order by conflict.resolved_at desc, conflict.id)
      from public.conflictos_sync conflict
      join public.visitas_servicio visit on visit.id = conflict.visita_id
      join public.operaciones_sync operation on operation.operation_id = conflict.operation_id
      where visit.taller_movil_id = provider_id
        and conflict.resolved_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

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

revoke all on function public.prevent_sync_conflict_payload_mutation(),
  public.api_sync_conflict(uuid), public.api_sync_conflicts(),
  public.api_workshop_sync_conflict_outcomes(),
  public.api_resolve_sync_conflict(uuid, text, text, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sync_conflict(uuid), public.api_sync_conflicts(),
  public.api_workshop_sync_conflict_outcomes(),
  public.api_resolve_sync_conflict(uuid, text, text, uuid, uuid, timestamptz, timestamptz)
  to service_role;

commit;

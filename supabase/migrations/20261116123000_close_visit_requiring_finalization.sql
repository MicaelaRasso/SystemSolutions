begin;

-- E4 (#97), «Decisiones cerradas (2026-11-16)»: completar una visita en «Requiere finalización».
--
-- * El Técnico firma desde el panel: cualquier cuenta del Taller Móvil asignado (decisión (f):
--   cualquier técnico, incluido un reemplazante) puede cargar la firma del Técnico y la del Cliente
--   presencial (antes que la del Técnico) en una visita `requiere_finalizacion`. La firma es en
--   línea: las operaciones offline sobre una visita vencida quedan en conflicto (#96). Si con esa
--   firma la visita cumple las condiciones de cierre, se completa sola
--   (`complete_visit_requiring_finalization`); si no, queda para el Administrador.
-- * El Cliente firma desde el portal, como hoy: `panel_cliente` vale también en
--   `requiere_finalizacion` y la visita aparece en sus pendientes cuando tiene borradores completos.
-- * El Administrador la cierra con un motivo (`api_admin_close_visit_requiring_finalization`): la
--   visita pasa a completada y queda auditada (`visita_cierre_administrativo`, más el motivo en la
--   propia visita). Las válvulas sin evaluar (órdenes pendientes o evaluadas sin borrador) quedan
--   `no_evaluada` con el motivo y van a una visita de seguimiento de la misma solicitud
--   (`api_create_followup_visit`, ADR 0023), para la que se piden taller, inicio y fin estimado.
--   Exige resolver antes los conflictos de sincronización de la visita.
-- * Los borradores incompletos no se emiten: al cerrar, solo los completos pasan a pendientes de
--   firma y se finalizan si ya están las dos firmas; los incompletos quedan como borrador para que
--   el Administrador los resuelva. No se descarta nada.
-- * `enforce_visit_signatures_before_completion` exige la firma del Técnico también al completar
--   desde `requiere_finalizacion`, salvo en el cierre administrativo.
--
-- Funciones redefinidas (base = última definición): existing_visit_signature_result
--   (20261114000001); api_submit_visit_signature (20261116100000); api_cliente_pending_certificates
--   (20260926220000); enforce_visit_signatures_before_completion (20261019131157);
--   api_offline_working_set_for_device (20261116110000), que suma las visitas vencidas.
-- `api_offline_submit_signature` no cambia: el lote la alcanza solo con la visita en curso.

alter table public.visitas_servicio
  add column if not exists cierre_administrativo_motivo text,
  add column if not exists cierre_administrativo_por uuid references public.cuentas(id),
  add column if not exists cierre_administrativo_at timestamptz;

comment on column public.visitas_servicio.cierre_administrativo_motivo is
  'Motivo con el que un Administrador cerró la visita en «Requiere finalización» (E4).';

-- Base: 20261114000001. Admite el reintento de una firma en una visita vencida.
create or replace function public.existing_visit_signature_result(
  visit_row public.visitas_servicio,
  signing_party public.parte_firma_visita,
  actor uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  existing public.firmas_visita;
begin
  select * into existing
  from public.firmas_visita
  where visita_id = visit_row.id and parte = signing_party;
  if existing.id is null then
    return null;
  end if;
  if visit_row.estado not in ('en_curso', 'requiere_finalizacion', 'completada')
     or not (
       exists (
         select 1 from public.taller_cuentas
         where cuenta_id = actor and taller_movil_id = visit_row.taller_movil_id
       )
       or (
         signing_party = 'cliente'
         and exists (
           select 1 from public.yacimientos
           where id = visit_row.yacimiento_id and cliente_cuenta_id = actor
         )
       )
     ) then
    raise exception using errcode = '23514', message = 'A visit signature cannot be replaced';
  end if;
  return jsonb_build_object(
    'signature_id', existing.id,
    'image_id', existing.imagen_id,
    'finalized_certificates', '[]'::jsonb,
    'capture_method', existing.capture_method,
    'captured_at', existing.captured_at,
    'already_registered', true
  );
end;
$$;

revoke all on function public.existing_visit_signature_result(public.visitas_servicio, public.parte_firma_visita, uuid)
  from public, anon, authenticated, service_role;

-- Completa una visita vencida que ya cumple las condiciones de cierre de `api_complete_visit`
-- (resultados explícitos, borradores completos y firma del Técnico). Devuelve si la completó. No
-- finaliza certificados: lo hace quien la llama con `api_finalize_visit_certificates`.
create or replace function public.complete_visit_requiring_finalization(target_visit uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
begin
  select * into visit_row from public.visitas_servicio where id = target_visit for update;
  if visit_row.id is null or visit_row.estado <> 'requiere_finalizacion' then
    return false;
  end if;

  perform 1
  from public.certificados certificate
  where certificate.visita_id = target_visit
  order by certificate.id
  for update;

  if exists (
    select 1 from public.ordenes_trabajo work_order
    where work_order.visita_id = target_visit and work_order.estado = 'pendiente'
  ) or exists (
    select 1
    from public.ordenes_trabajo work_order
    left join public.certificados certificate on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = target_visit
      and work_order.estado = 'evaluada'
      and certificate.id is null
  ) or exists (
    select 1
    from public.ordenes_trabajo work_order
    join public.certificados certificate on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = target_visit
      and work_order.estado = 'no_evaluada'
  ) or exists (
    select 1 from public.certificados certificate
    where certificate.visita_id = target_visit
      and not coalesce((public.api_certificate_validation(certificate)->>'complete')::boolean, false)
  ) or not exists (
    select 1 from public.firmas_visita signature
    where signature.visita_id = target_visit and signature.parte = 'tecnico'
  ) then
    return false;
  end if;

  update public.visitas_servicio
  set estado = 'completada', updated_at = now()
  where id = target_visit;

  update public.certificados
  set estado_captura = 'cerrado', estado = 'pendiente', updated_at = now()
  where visita_id = target_visit
    and estado_captura = 'abierto';

  delete from public.visita_equipos where visita_id = target_visit;
  return true;
end;
$$;

revoke all on function public.complete_visit_requiring_finalization(uuid)
  from public, anon, authenticated, service_role;

-- Base: 20261116100000. Firma del Técnico, del Cliente presencial y del Cliente desde el portal en
-- una visita vencida; con la última firma necesaria, la visita se completa si está lista.
create or replace function public.api_submit_visit_signature(
  target_visit uuid,
  signing_party public.parte_firma_visita,
  signer_name text,
  bucket_name text,
  asset_path text,
  capture_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.visitas_servicio;
  image_id uuid;
  signature_id uuid;
  actor uuid := auth.uid();
  signer_account uuid;
  existing_result jsonb;
  visit_completed boolean := false;
begin
  perform public.require_authenticated_cuenta();
  select * into v from public.visitas_servicio where id = target_visit for update;
  if v.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if signer_name is null or btrim(signer_name) = '' then
    raise exception using errcode = 'invalid_parameter_value', message = 'A signer name is required';
  end if;
  if bucket_name <> 'certificate-signatures'
     or asset_path !~ ('^visits/' || target_visit::text || '/(tecnico|cliente)/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Signature storage reference is not authorized';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = bucket_name and o.name = asset_path
  ) then
    raise exception using errcode = 'no_data_found', message = 'Signature object was not uploaded through Storage';
  end if;
  existing_result := public.existing_visit_signature_result(v, signing_party, actor);
  if existing_result is not null then
    return existing_result;
  end if;

  if signing_party = 'tecnico' then
    if v.estado not in ('en_curso', 'requiere_finalizacion')
       or not exists (select 1 from public.taller_cuentas where cuenta_id = actor and taller_movil_id = v.taller_movil_id) then
      raise exception using errcode = 'insufficient_privilege', message = 'The Técnico is not assigned to this visit Taller Móvil';
    end if;
    if capture_method <> 'pwa_tecnico' then
      raise exception using errcode = 'invalid_parameter_value', message = 'Invalid Técnico capture method';
    end if;
  else
    if capture_method = 'panel_cliente' then
      if v.estado not in ('completada', 'requiere_finalizacion')
         or not exists (select 1 from public.yacimientos where id = v.yacimiento_id and cliente_cuenta_id = actor) then
        raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can upload a post-visit signature';
      end if;
      signer_account := actor;
    elsif capture_method = 'pwa_cliente_presencial' then
      if v.estado not in ('en_curso', 'requiere_finalizacion')
         or not exists (select 1 from public.taller_cuentas where cuenta_id = actor and taller_movil_id = v.taller_movil_id) then
        raise exception using errcode = 'insufficient_privilege', message = 'Only the assigned Taller Móvil can capture an in-person Cliente signature';
      end if;
    else
      raise exception using errcode = 'invalid_parameter_value', message = 'Invalid Cliente capture method';
    end if;
  end if;

  insert into public.imagenes_certificado(bucket, object_path, categoria)
  values (bucket_name, asset_path, 'firma_' || signing_party::text)
  returning id into image_id;
  insert into public.firmas_visita(
    visita_id, parte, nombre_firmante, cuenta_id, imagen_id,
    captured_at, capture_method, captured_by_cuenta_id
  )
  values (
    target_visit, signing_party, btrim(signer_name), signer_account, image_id,
    now(), capture_method, actor
  )
  returning id into signature_id;

  -- E4: con la firma que faltaba, una visita vencida que ya cumple las condiciones de cierre se
  -- completa sola; si no, queda para que el Administrador la cierre.
  if v.estado = 'requiere_finalizacion' then
    visit_completed := public.complete_visit_requiring_finalization(target_visit);
  end if;

  return jsonb_build_object(
    'signature_id', signature_id,
    'finalized_certificates', public.api_finalize_visit_certificates(target_visit),
    'visit_completed', visit_completed
  );
end;
$$;

revoke all on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text)
  to service_role;

-- Base: 20260926220000. Las visitas vencidas con borradores completos esperan la firma del Cliente.
create or replace function public.api_cliente_pending_certificates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_authenticated_cuenta();

  if not exists (
    select 1
    from public.cuentas
    where id = auth.uid()
      and rol = 'cliente'
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can read pending certificates';
  end if;

  select jsonb_build_object(
    'visits', coalesce(jsonb_agg(
      jsonb_build_object(
        'visit', to_jsonb(v),
        'yacimiento', to_jsonb(y),
        'work_orders', work_orders.items,
        'pending_certificates', pending.items,
        'pending_certificate_count', pending.item_count
      )
      order by v.starts_at, v.id
    ), '[]'::jsonb)
  )
  into result
  from public.visitas_servicio v
  join public.yacimientos y on y.id = v.yacimiento_id
  cross join lateral (
    select
      coalesce(jsonb_agg(to_jsonb(ot) order by ot.created_at, ot.id), '[]'::jsonb) as items
    from public.ordenes_trabajo ot
    where ot.visita_id = v.id
  ) work_orders
  cross join lateral (
    select
      coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb) as items,
      count(*)::integer as item_count
    from public.certificados c
    where c.visita_id = v.id
      and (
        (v.estado = 'completada' and c.estado_captura = 'cerrado' and c.estado = 'pendiente')
        -- E4: en una visita vencida, los borradores completos esperan la firma del Cliente.
        or (v.estado = 'requiere_finalizacion' and c.estado_captura = 'abierto' and c.estado = 'borrador')
      )
      and coalesce((public.api_certificate_validation(c)->>'complete')::boolean, false)
  ) pending
  where v.estado in ('completada', 'requiere_finalizacion')
    and y.cliente_cuenta_id = auth.uid()
    and public.can_access_yacimiento(y.id)
    and pending.item_count > 0
    and not exists (
      select 1
      from public.firmas_visita f
      where f.visita_id = v.id
        and f.parte = 'cliente'
    );

  return result;
end;
$$;

revoke all on function public.api_cliente_pending_certificates() from public, anon, authenticated;
grant execute on function public.api_cliente_pending_certificates() to service_role;

-- Base: 20261019131157. La firma del Técnico se exige también al completar una visita vencida,
-- salvo en el cierre administrativo (que puede cerrarla sin firmas).
create or replace function public.enforce_visit_signatures_before_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado in ('en_curso', 'requiere_finalizacion') and new.estado = 'completada'
     and not (
       old.estado = 'requiere_finalizacion'
       and current_setting('app.admin_close_visit_id', true) = new.id::text
     ) then
    if not exists (
      select 1 from public.firmas_visita signature
      where signature.visita_id = new.id and signature.parte = 'tecnico'
    ) then
      raise exception using errcode = 'check_violation',
        message = 'A Técnico signature is required to complete a visit';
    end if;
  end if;
  return new;
end;
$$;

-- Cierre administrativo de una visita en «Requiere finalización».
create or replace function public.api_admin_close_visit_requiring_finalization(
  visit_id uuid,
  action_reason text,
  provider_id uuid default null,
  visit_starts_at timestamptz default null,
  visit_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  reason text := btrim(coalesce(action_reason, ''));
  owner_id uuid;
  follow_up_valves uuid[];
  follow_up jsonb;
  follow_up_id uuid;
  finalized jsonb;
  incomplete_ids uuid[];
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'Only an active Administrador can close a visit that requires finalization';
  end if;
  if reason = '' or length(reason) > 1000 then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A closing reason of 1 to 1000 characters is required';
  end if;

  select * into visit_row from public.visitas_servicio where id = visit_id for update;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;

  -- Reintento del mismo cierre: devuelve el resultado sin volver a aplicarlo.
  if visit_row.estado = 'completada' and visit_row.cierre_administrativo_motivo = reason then
    select relacion_id into follow_up_id
    from public.historial_relaciones
    where datos->>'event' = 'follow_up_visit_scheduled'
      and datos->>'source_visit_id' = visit_id::text
    order by created_at desc
    limit 1;
    return public.api_visit(visit_id) || jsonb_build_object(
      'follow_up_visit_id', follow_up_id,
      'finalized_certificates', '[]'::jsonb,
      'incomplete_certificate_ids', coalesce((
        select jsonb_agg(c.id order by c.id) from public.certificados c
        where c.visita_id = visit_id and c.estado = 'borrador'
      ), '[]'::jsonb),
      'already_closed', true
    );
  end if;
  if visit_row.estado <> 'requiere_finalizacion' then
    raise exception using errcode = 'check_violation',
      message = 'Only a visit that requires finalization can be closed by an Administrador';
  end if;
  if exists (
    select 1 from public.conflictos_sync conflict
    where conflict.visita_id = visit_id and conflict.resolved_at is null
  ) then
    raise exception using errcode = 'check_violation',
      message = 'Resolve the synchronization conflicts of this visit before closing it';
  end if;

  -- Mismo orden de bloqueos que la edición de borradores: visita y después certificados.
  perform 1
  from public.certificados certificate
  where certificate.visita_id = visit_id
  order by certificate.id
  for update;

  -- Válvulas sin evaluar: órdenes sin resultado o evaluadas sin borrador.
  update public.ordenes_trabajo work_order
  set estado = 'no_evaluada', no_evaluada_razon = reason
  where work_order.visita_id = visit_id
    and (
      work_order.estado = 'pendiente'
      or (
        work_order.estado = 'evaluada'
        and not exists (
          select 1 from public.certificados certificate
          where certificate.orden_trabajo_id = work_order.id
        )
      )
    );

  -- Las que no estén ya en otra visita activa de la solicitud van a la visita de seguimiento.
  select array_agg(work_order.valvula_id order by work_order.created_at, work_order.id)
  into follow_up_valves
  from public.ordenes_trabajo work_order
  where work_order.visita_id = visit_id
    and work_order.estado = 'no_evaluada'
    and not exists (
      select 1
      from public.visitas_servicio active_visit
      join public.ordenes_trabajo active_order on active_order.visita_id = active_visit.id
      where active_visit.solicitud_id = visit_row.solicitud_id
        and active_visit.id <> visit_id
        and active_visit.estado in ('solicitada', 'programada', 'aceptada', 'en_curso', 'requiere_finalizacion')
        and active_order.valvula_id = work_order.valvula_id
    );
  if follow_up_valves is not null
    and (provider_id is null or visit_starts_at is null or visit_ends_at is null) then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'A follow-up visit for the unevaluated Válvulas requires a Taller Móvil and start/end times';
  end if;

  perform set_config('app.admin_close_visit_id', visit_id::text, true);
  update public.visitas_servicio
  set estado = 'completada',
      cierre_administrativo_motivo = reason,
      cierre_administrativo_por = auth.uid(),
      cierre_administrativo_at = now(),
      updated_at = now()
  where id = visit_id;
  perform set_config('app.admin_close_visit_id', '', true);

  -- Solo los borradores completos de órdenes evaluadas se cierran; los incompletos quedan como
  -- borrador para que el Administrador los resuelva.
  update public.certificados certificate
  set estado_captura = 'cerrado', estado = 'pendiente', updated_at = now()
  where certificate.visita_id = visit_id
    and certificate.estado_captura = 'abierto'
    and coalesce((public.api_certificate_validation(certificate)->>'complete')::boolean, false)
    and exists (
      select 1 from public.ordenes_trabajo work_order
      where work_order.id = certificate.orden_trabajo_id and work_order.estado = 'evaluada'
    );
  select array_agg(certificate.id order by certificate.id) into incomplete_ids
  from public.certificados certificate
  where certificate.visita_id = visit_id and certificate.estado = 'borrador';

  delete from public.visita_equipos where visita_id = visit_id;
  -- Se emiten solo los completos y firmados (Técnico y Cliente).
  finalized := public.api_finalize_visit_certificates(visit_id);

  if follow_up_valves is not null then
    follow_up := public.api_create_followup_visit(
      visit_row.solicitud_id, visit_id, follow_up_valves, provider_id, visit_starts_at, visit_ends_at
    );
    follow_up_id := (follow_up->'visit'->>'id')::uuid;
  end if;

  select cliente_cuenta_id into owner_id from public.yacimientos where id = visit_row.yacimiento_id;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values ('servicio', visit_row.yacimiento_id, visit_id, auth.uid(),
    jsonb_build_object('event', 'visit_closed_by_administrator', 'motivo', reason,
      'follow_up_visit_id', follow_up_id));
  perform public.record_audit_event(
    'visita_cierre_administrativo', 'visita_servicio', visit_id, 'exitoso',
    jsonb_build_object('estado_anterior', 'requiere_finalizacion', 'estado_nuevo', 'completada',
      'motivo', reason),
    jsonb_build_object('solicitud_id', visit_row.solicitud_id,
      'visita_seguimiento_id', follow_up_id,
      'valvulas_seguimiento', to_jsonb(coalesce(follow_up_valves, '{}'::uuid[])),
      'borradores_incompletos', to_jsonb(coalesce(incomplete_ids, '{}'::uuid[])),
      'certificados_finalizados', jsonb_array_length(coalesce(finalized, '[]'::jsonb))),
    null, null, owner_id, visit_row.yacimiento_id, visit_id, null
  );

  return public.api_visit(visit_id) || jsonb_build_object(
    'follow_up_visit_id', follow_up_id,
    'finalized_certificates', coalesce(finalized, '[]'::jsonb),
    'incomplete_certificate_ids', to_jsonb(coalesce(incomplete_ids, '{}'::uuid[])),
    'already_closed', false
  );
end;
$$;

revoke all on function public.api_admin_close_visit_requiring_finalization(uuid, text, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_admin_close_visit_requiring_finalization(uuid, text, uuid, timestamptz, timestamptz)
  to service_role;

-- Base: 20261116110000. Las visitas vencidas siguen en el panel del taller (sin límite de fecha)
-- hasta que se completan, para cargar las firmas que falten.
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
      and (v.estado in ('en_curso', 'requiere_finalizacion') or (v.estado = 'aceptada' and v.starts_at >= public.offline_working_set_window_start() and v.starts_at < now() + interval '2 days'))
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
              'certificate', to_jsonb(c),
              'valvula_nombre', val.nombre,
              'equipo_nombre', eq.nombre,
              'valvula', to_jsonb(val)
            ) order by ot.created_at, ot.id)
            from public.ordenes_trabajo ot
            left join public.certificados c on c.orden_trabajo_id = ot.id
            left join public.valvulas val on val.id = ot.valvula_id
            left join public.equipos_unidades eq on eq.id = val.equipo_id
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
          -- A3: catálogo de los yacimientos del mismo Cliente a los que el taller tiene acceso
          -- (incluye el de la visita), para buscar y dar de alta válvulas sin conexión.
          'client_yacimientos', coalesce((
            select jsonb_agg(public.api_yacimiento_tree(y.id) order by y.nombre, y.id)
            from public.yacimientos y
            join public.yacimientos visit_yacimiento on visit_yacimiento.id = v.yacimiento_id
            where y.cliente_cuenta_id = visit_yacimiento.cliente_cuenta_id
              and exists (
                select 1 from public.asignaciones_servicio access
                where access.yacimiento_id = y.id
                  and access.estado = 'activa'
                  and access.taller_movil_id = provider
              )
          ), '[]'::jsonb),
          'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(
            coalesce(v.replacement_catalog_version_id, latest_version)
          )
        ) order by v.starts_at, v.id
      )
      from public.visitas_servicio v
      where v.taller_movil_id = provider
        and (v.estado in ('en_curso', 'requiere_finalizacion') or (v.estado = 'aceptada' and v.starts_at >= public.offline_working_set_window_start() and v.starts_at < now() + interval '2 days'))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.api_offline_working_set_for_device(uuid) from public, anon, authenticated;
grant execute on function public.api_offline_working_set_for_device(uuid) to service_role;

commit;

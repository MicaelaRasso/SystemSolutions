begin;

-- Image metadata is intentionally separate from the certificate payload.  The
-- Edge Function owns the Storage upload and these tables only retain the
-- immutable reference that is needed by certificate consumers.
alter table public.clientes
  add column logo_imagen_id uuid references public.imagenes_certificado(id);

create table public.certificado_imagenes (
  certificado_id uuid not null references public.certificados(id) on delete restrict,
  imagen_id uuid not null references public.imagenes_certificado(id) on delete restrict,
  categoria text not null check (categoria in ('logo_cliente', 'valvula_desarmada', 'valvula_ensamblada_prueba', 'valvula_placa_precinto')),
  primary key (certificado_id, categoria),
  unique (certificado_id, imagen_id)
);

alter table public.certificado_imagenes enable row level security;

create or replace function public.api_start_certificate_draft(work_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_trabajo;
  v public.visitas_servicio;
  yid uuid;
  pid uuid;
  eid uuid;
  revision uuid;
  c public.certificados;
  valve_snapshot jsonb;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null or o.estado <> 'evaluada' then
    raise exception using errcode = 'check_violation', message = 'Only an evaluated work order can create a certificate draft';
  end if;

  select * into v from public.api_assigned_visit(o.visita_id);
  if v.estado <> 'en_curso' then
    raise exception using errcode = 'check_violation', message = 'Certificate drafts can be started only while the visit is in progress';
  end if;

  select * into c from public.certificados where orden_trabajo_id = o.id for update;
  if c.id is not null then
    return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
  end if;

  select p.yacimiento_id, p.id, e.id, to_jsonb(x)
    into yid, pid, eid, valve_snapshot
  from public.valvulas x
  join public.equipos_unidades e on e.id = x.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where x.id = o.valvula_id;

  if yid is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;

  insert into public.valvula_revisiones(valvula_id, datos)
  values (o.valvula_id, valve_snapshot)
  returning id into revision;

  insert into public.certificados(orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id, equipo_id, valvula_revision_id)
  values (o.id, o.visita_id, o.valvula_id, yid, pid, eid, revision)
  on conflict (orden_trabajo_id) do update set updated_at = public.certificados.updated_at
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

-- The capture snapshot is fixed when evaluation starts.  Finalization copies
-- that data into the certificate so later Válvula edits cannot change it.
create or replace function public.api_finalize_visit_certificates(target_visit uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.certificados;
  counter bigint;
  finalized jsonb := '[]'::jsonb;
  tech_exists boolean;
  client_exists boolean;
  snapshot jsonb;
begin
  select exists(select 1 from public.firmas_visita where visita_id = target_visit and parte = 'tecnico') into tech_exists;
  select exists(select 1 from public.firmas_visita where visita_id = target_visit and parte = 'cliente') into client_exists;
  if not tech_exists or not client_exists then
    return finalized;
  end if;

  for c in
    select * from public.certificados
    where visita_id = target_visit and estado_captura = 'cerrado' and estado = 'pendiente'
    for update
  loop
    if not ((public.api_certificate_validation(c)->>'complete')::boolean) then
      continue;
    end if;

    update public.contador_certificados
    set siguiente_numero = siguiente_numero + 1
    where id = true
    returning siguiente_numero - 1 into counter;

    select jsonb_build_object(
      'valvula', r.datos,
      'valvula_revision_id', r.id,
      'yacimiento_id', c.yacimiento_id,
      'planta_id', c.planta_id,
      'equipo_id', c.equipo_id,
      'captured_at', r.created_at
    ) into snapshot
    from public.valvula_revisiones r
    where r.id = c.valvula_revision_id;

    update public.certificados
    set estado = 'finalizado',
        numero = counter,
        finalized_at = now(),
        instantanea = snapshot,
        updated_at = now()
    where id = c.id
    returning * into c;

    finalized := finalized || jsonb_build_array(to_jsonb(c));
  end loop;
  return finalized;
end;
$$;

create or replace function public.api_certificate_asset_refs(certificate_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'bucket', i.bucket,
    'object_path', i.object_path,
    'categoria', ci.categoria
  ) order by ci.categoria), '[]'::jsonb)
  from public.certificado_imagenes ci
  join public.imagenes_certificado i on i.id = ci.imagen_id
  where ci.certificado_id = certificate_id;
$$;

create or replace function public.api_finalized_certificate(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.certificados;
  y public.yacimientos;
  p public.plantas_locaciones;
  e public.equipos_unidades;
  v public.valvulas;
  client_logo jsonb;
begin
  select * into c from public.certificados where id = certificate_id;
  if c.id is null or c.estado <> 'finalizado' then
    raise exception using errcode = 'no_data_found', message = 'Finalized certificate not found';
  end if;
  perform public.require_yacimiento_access(c.yacimiento_id);

  select * into y from public.yacimientos where id = c.yacimiento_id;
  select * into p from public.plantas_locaciones where id = c.planta_id;
  select * into e from public.equipos_unidades where id = c.equipo_id;
  select * into v from public.valvulas where id = c.valvula_id;
  select case when i.id is null then null else jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path) end
    into client_logo
  from public.clientes cl
  left join public.imagenes_certificado i on i.id = cl.logo_imagen_id
  where cl.cuenta_id = y.cliente_cuenta_id;

  return jsonb_build_object(
    'certificate', to_jsonb(c),
    'context', jsonb_build_object(
      'yacimiento', to_jsonb(y),
      'planta', to_jsonb(p),
      'equipo', to_jsonb(e),
      'valvula', to_jsonb(v)
    ),
    'snapshot', c.instantanea,
    'validity', jsonb_build_object(
      'execution_date', c.fecha_ejecucion,
      'valid_until', c.vigencia_hasta,
      'is_valid', current_date <= c.vigencia_hasta
    ),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'parte', f.parte,
        'nombre_firmante', f.nombre_firmante,
        'captured_at', f.captured_at,
        'image', jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path)
      ) order by f.parte)
      from public.firmas_visita f
      join public.imagenes_certificado i on i.id = f.imagen_id
      where f.visita_id = c.visita_id
    ), '[]'::jsonb),
    'images', public.api_certificate_asset_refs(c.id),
    'client_logo', client_logo
  );
end;
$$;

create or replace function public.api_valvula_certificates(target_valvula uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  yid uuid;
  current_id uuid;
  history jsonb;
begin
  select p.yacimiento_id into yid
  from public.valvulas v
  join public.equipos_unidades e on e.id = v.equipo_id
  join public.plantas_locaciones p on p.id = e.planta_id
  where v.id = target_valvula;
  if yid is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;
  perform public.require_yacimiento_access(yid);

  select c.id into current_id
  from public.certificados c
  where c.valvula_id = target_valvula
    and c.estado = 'finalizado'
    and current_date <= c.vigencia_hasta
  order by c.fecha_ejecucion desc, c.finalized_at desc, c.id desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'certificate', to_jsonb(c),
    'status', case
      when c.estado = 'pendiente' then 'pendiente'
      when c.id = current_id then 'vigente'
      else 'historico'
    end,
    'is_current', c.id = current_id,
    'validity', case when c.estado = 'finalizado' then jsonb_build_object(
      'execution_date', c.fecha_ejecucion,
      'valid_until', c.vigencia_hasta,
      'is_valid', current_date <= c.vigencia_hasta
    ) else null end
  ) order by c.fecha_ejecucion desc nulls last, c.created_at desc), '[]'::jsonb)
  into history
  from public.certificados c
  where c.valvula_id = target_valvula;

  return jsonb_build_object(
    'current_certificate_id', current_id,
    'certificates', history
  );
end;
$$;

-- Offline operations are acknowledged individually.  The original payload is
-- retained on conflict so an administrator can resolve it without data loss.
create type public.estado_operacion_sync as enum ('pendiente', 'sincronizada', 'conflicto');

create table public.operaciones_sync (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  visita_id uuid not null references public.visitas_servicio(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  estado public.estado_operacion_sync not null default 'pendiente',
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index operaciones_sync_visita_idx on public.operaciones_sync(visita_id, created_at);
alter table public.operaciones_sync enable row level security;

create table public.conflictos_sync (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique references public.operaciones_sync(operation_id) on delete cascade,
  visita_id uuid not null references public.visitas_servicio(id) on delete cascade,
  payload jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.conflictos_sync enable row level security;

create or replace function public.api_offline_working_set()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select taller_movil_id into provider from public.taller_cuentas where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = 'insufficient_privilege', message = 'Only a Taller Móvil can use the offline working set';
  end if;
  return jsonb_build_object('visits', coalesce((
    select jsonb_agg(public.api_visit(v.id) order by v.starts_at)
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and v.estado in ('aceptada', 'en_curso')
      and v.starts_at < now() + interval '2 days'
      and v.ends_at > now() - interval '1 day'
  ), '[]'::jsonb));
end;
$$;

create or replace function public.api_sync_visit_batch(target_visit uuid, operations jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  operation jsonb;
  op_id uuid;
  op_kind text;
  op_payload jsonb;
  stored public.operaciones_sync;
  api_result jsonb;
  response jsonb := '[]'::jsonb;
begin
  perform public.require_authenticated_cuenta();
  perform public.api_assigned_visit(target_visit);
  if jsonb_typeof(operations) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'operations must be an array';
  end if;

  for operation in select value from jsonb_array_elements(operations) loop
    begin
      op_id := (operation->>'operation_id')::uuid;
      op_kind := operation->>'kind';
      op_payload := coalesce(operation->'payload', '{}'::jsonb);
      if op_id is null or op_kind is null then
        raise exception using errcode = 'invalid_parameter_value', message = 'operation_id and kind are required';
      end if;
      if coalesce((operation->>'schema_version')::integer, 1) <> 1 then
        raise exception using errcode = 'check_violation', message = 'Unsupported offline operation schema version';
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(coalesce(operation->'dependencies', '[]'::jsonb)) dependency
        where not exists (
          select 1 from public.operaciones_sync os
          where os.operation_id = dependency::uuid and os.estado = 'sincronizada'
        )
      ) then
        raise exception using errcode = 'check_violation', message = 'An offline operation dependency is not synchronized';
      end if;

      select * into stored from public.operaciones_sync os where os.operation_id = op_id;
      if stored.id is not null then
        response := response || jsonb_build_array(jsonb_build_object(
          'operation_id', stored.operation_id,
          'estado', stored.estado,
          'result', stored.result,
          'error_code', stored.error_code,
          'error_message', stored.error_message
        ));
        continue;
      end if;

      insert into public.operaciones_sync(operation_id, visita_id, kind, payload)
      values (op_id, target_visit, op_kind, op_payload);

      begin
        if op_kind = 'work_order_outcome' then
          api_result := public.api_update_work_order(
            (op_payload->>'work_order_id')::uuid,
            (op_payload->>'outcome')::public.estado_orden_trabajo,
            op_payload->>'not_evaluated_reason'
          );
        elsif op_kind = 'start_certificate_draft' then
          api_result := public.api_start_certificate_draft((op_payload->>'work_order_id')::uuid);
        elsif op_kind = 'update_certificate_draft' then
          api_result := public.api_update_certificate_draft((op_payload->>'certificate_id')::uuid, op_payload->'data');
        elsif op_kind = 'submit_signature' then
          api_result := public.api_submit_visit_signature(
            target_visit,
            (op_payload->>'party')::public.parte_firma_visita,
            op_payload->>'signer_name',
            op_payload->>'bucket',
            op_payload->>'object_path'
          );
        elsif op_kind = 'complete_visit' then
          api_result := public.api_complete_visit(target_visit);
        else
          raise exception using errcode = 'invalid_parameter_value', message = 'Unsupported synchronization operation';
        end if;

        update public.operaciones_sync os
        set estado = 'sincronizada', result = api_result, acknowledged_at = now()
        where os.operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object('operation_id', op_id, 'estado', 'sincronizada', 'result', api_result));
      exception when others then
        insert into public.conflictos_sync(operation_id, visita_id, payload, reason)
        values (op_id, target_visit, op_payload, sqlerrm)
        on conflict (operation_id) do nothing;
        update public.operaciones_sync os
        set estado = 'conflicto', error_code = sqlstate, error_message = sqlerrm, acknowledged_at = now()
        where os.operation_id = op_id;
        response := response || jsonb_build_array(jsonb_build_object('operation_id', op_id, 'estado', 'conflicto', 'error_code', sqlstate, 'error_message', sqlerrm));
      end;
    exception when others then
      response := response || jsonb_build_array(jsonb_build_object('operation_id', operation->>'operation_id', 'estado', 'conflicto', 'error_code', sqlstate, 'error_message', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('visit_id', target_visit, 'operations', response);
end;
$$;

revoke all on function public.api_certificate_asset_refs(uuid), public.api_offline_working_set(), public.api_sync_visit_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_certificate_asset_refs(uuid), public.api_offline_working_set(), public.api_sync_visit_batch(uuid, jsonb) to authenticated;

commit;

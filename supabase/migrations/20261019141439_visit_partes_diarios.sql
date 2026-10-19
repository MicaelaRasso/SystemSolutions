begin;

create table public.partes_diarios (
  visita_id uuid primary key references public.visitas_servicio(id) on delete cascade,
  codigo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (visita_id, codigo),
  check (codigo ~ '^[A-Za-z0-9]+$')
);

create table public.parte_diario_imagenes (
  imagen_id uuid primary key references public.imagenes_certificado(id) on delete restrict,
  visita_id uuid not null,
  codigo text not null,
  created_at timestamptz not null default now(),
  foreign key (visita_id, codigo)
    references public.partes_diarios(visita_id, codigo)
    on update cascade on delete restrict
);

create index parte_diario_imagenes_visit_code_idx
  on public.parte_diario_imagenes(visita_id, codigo, created_at, imagen_id);

alter table public.partes_diarios enable row level security;
alter table public.parte_diario_imagenes enable row level security;
revoke all on public.partes_diarios, public.parte_diario_imagenes from public, anon, authenticated;
grant all on public.partes_diarios, public.parte_diario_imagenes to service_role;

create or replace function public.api_visit_parte_diario(target_visit uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  actor_role public.rol;
  pd public.partes_diarios;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = target_visit;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  select rol into actor_role from public.cuentas where id = auth.uid();
  if actor_role not in ('administrador_regular', 'super_administrador')
    and not public.can_access_yacimiento(visit_row.yacimiento_id)
    and not exists (
      select 1 from public.taller_cuentas
      where cuenta_id = auth.uid() and taller_movil_id = visit_row.taller_movil_id
    ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;

  select * into pd from public.partes_diarios where visita_id = target_visit;
  return jsonb_build_object(
    'visit_id', target_visit,
    'codigo', pd.codigo,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'bucket', i.bucket,
        'object_path', i.object_path,
        'categoria', i.categoria
      ) order by pdi.created_at, pdi.imagen_id)
      from public.parte_diario_imagenes pdi
      join public.imagenes_certificado i on i.id = pdi.imagen_id
      where pdi.visita_id = target_visit and pdi.codigo = pd.codigo
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_set_visit_parte_diario(target_visit uuid, pd_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
begin
  visit_row := public.api_assigned_visit(target_visit);
  if visit_row.estado <> 'en_curso' then
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
  if visit_row.estado <> 'en_curso' then
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
      'server_received_at', now(), 'server_acknowledged_at', now()
    )
  );
end;
$$;

create or replace function public.api_valvula_certificates_by_pd(target_valvula uuid, pd_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  raw_history jsonb;
  certificates jsonb;
  current_id uuid;
  normalized_code text := nullif(btrim(pd_code), '');
begin
  if normalized_code is not null and normalized_code !~ '^[A-Za-z0-9]+$' then
    raise exception using errcode = 'invalid_parameter_value', message = 'pd_code must be alphanumeric';
  end if;
  raw_history := public.api_valvula_certificates(target_valvula);

  select coalesce(jsonb_agg(
    jsonb_set(
      entry,
      '{certificate}',
      (entry->'certificate') || jsonb_build_object('pd', pd.codigo),
      true
    ) order by c.fecha_ejecucion desc nulls last, c.finalized_at desc nulls last, c.created_at desc, c.id desc
  ), '[]'::jsonb)
  into certificates
  from jsonb_array_elements(raw_history->'certificates') entry
  join public.certificados c on c.id = (entry->'certificate'->>'id')::uuid
  left join public.partes_diarios pd on pd.visita_id = c.visita_id
  where normalized_code is null or pd.codigo = normalized_code;

  current_id := nullif(raw_history->>'current_certificate_id', '')::uuid;
  if current_id is not null and not exists (
    select 1 from jsonb_array_elements(certificates) entry
    where entry->'certificate'->>'id' = current_id::text
  ) then
    current_id := null;
  end if;
  return jsonb_build_object('current_certificate_id', current_id, 'certificates', certificates);
end;
$$;

revoke all on function public.api_visit_parte_diario(uuid),
  public.api_set_visit_parte_diario(uuid, text),
  public.api_register_visit_parte_diario_image(uuid, text, uuid, text, text),
  public.api_sync_visit_part_diario_batch(uuid, jsonb, uuid),
  public.api_valvula_certificates_by_pd(uuid, text)
from public, anon, authenticated;
grant execute on function public.api_visit_parte_diario(uuid),
  public.api_set_visit_parte_diario(uuid, text),
  public.api_register_visit_parte_diario_image(uuid, text, uuid, text, text),
  public.api_sync_visit_part_diario_batch(uuid, jsonb, uuid),
  public.api_valvula_certificates_by_pd(uuid, text)
to service_role;

commit;

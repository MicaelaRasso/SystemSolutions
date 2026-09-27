begin;

-- Certificate capture is a fixed contract.  The JSON columns remain useful for
-- the template's repeatable sections, but the database now validates their
-- shape and rejects fields outside the contract before a draft is changed.
alter table public.certificados
  add column if not exists plantilla_version text not null default 'SYS_Certificado_Modelo1',
  add column if not exists contexto_captura jsonb not null default '{}'::jsonb,
  add column if not exists reemplaza_certificado_id uuid references public.certificados(id),
  add column if not exists motivo_reemplazo text;

create index if not exists certificados_reemplaza_idx
  on public.certificados(reemplaza_certificado_id)
  where reemplaza_certificado_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'certificados_plantilla_version_check'
      and conrelid = 'public.certificados'::regclass
  ) then
    alter table public.certificados
      add constraint certificados_plantilla_version_check
      check (btrim(plantilla_version) <> '');
  end if;
end;
$$;

insert into storage.buckets(id, name, public)
values ('certificate-signatures', 'certificate-signatures', false)
on conflict (id) do update set public = false;

alter table public.firmas_visita
  add column if not exists capture_method text not null default 'pwa_cliente_presencial',
  add column if not exists captured_by_cuenta_id uuid references public.cuentas(id);

update public.firmas_visita
set capture_method = case
  when parte = 'tecnico' then 'pwa_tecnico'
  else 'pwa_cliente_presencial'
end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firmas_visita_capture_method_check'
      and conrelid = 'public.firmas_visita'::regclass
  ) then
    alter table public.firmas_visita
      add constraint firmas_visita_capture_method_check
      check (capture_method in ('pwa_tecnico', 'pwa_cliente_presencial', 'panel_cliente'));
  end if;
end;
$$;

create index if not exists firmas_visita_visita_parte_idx
  on public.firmas_visita(visita_id, parte);

-- Storage metadata is an append-only reference.  The object itself must have
-- been uploaded by the Edge Function before this row can be registered.
create or replace function public.prevent_certificate_image_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'check_violation', message = 'Certificate image references are immutable';
  end if;
  if old.bucket is distinct from new.bucket
     or old.object_path is distinct from new.object_path
     or old.categoria is distinct from new.categoria then
    raise exception using errcode = 'check_violation', message = 'Certificate image references are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.require_uploaded_certificate_image()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = new.bucket and o.name = new.object_path
  ) then
    raise exception using errcode = 'no_data_found', message = 'Certificate image must be uploaded through the Edge Function first';
  end if;
  return new;
end;
$$;

drop trigger if exists certificado_imagenes_requires_storage_object on public.imagenes_certificado;
create trigger certificado_imagenes_requires_storage_object
before insert on public.imagenes_certificado
for each row execute function public.require_uploaded_certificate_image();

drop trigger if exists certificado_imagenes_append_only on public.imagenes_certificado;
create trigger certificado_imagenes_append_only
before update or delete on public.imagenes_certificado
for each row execute function public.prevent_certificate_image_mutation();

create or replace function public.api_technician_name_is_member(
  target_visit uuid,
  signer_name text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.visitas_servicio v
    join public.nominas_jornada n on n.taller_movil_id = v.taller_movil_id
    cross join lateral unnest(coalesce(n.persona_ids, '{}'::uuid[])) selected(persona_id)
    join public.personas p on p.id = selected.persona_id
    where v.id = target_visit
      and p.activo
      and lower(regexp_replace(btrim(signer_name), '[[:space:]]+', ' ', 'g')) in (
        lower(regexp_replace(btrim(p.nombre || ' ' || p.apellido), '[[:space:]]+', ' ', 'g')),
        lower(regexp_replace(btrim(p.apellido || ' ' || p.nombre), '[[:space:]]+', ' ', 'g'))
      )
  );
$$;

create or replace function public.api_validate_certificate_payload(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing_fields text[] := '{}';
  invalid_fields text[] := '{}';
  item jsonb;
  evidence_keys text[] := array['desarmada', 'ensamblada_prueba', 'placa_precinto'];
begin
  if jsonb_typeof(payload) <> 'object' then
    return jsonb_build_object(
      'complete', false,
      'missing_fields', jsonb_build_array(),
      'invalid_fields', jsonb_build_array('payload')
    );
  end if;

  if payload->'fecha_ejecucion' is null
     or payload->>'fecha_ejecucion' is null
     or btrim(payload->>'fecha_ejecucion') = '' then
    missing_fields := missing_fields || 'fecha_ejecucion';
  elsif payload->>'fecha_ejecucion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char(to_date(payload->>'fecha_ejecucion', 'YYYY-MM-DD'), 'YYYY-MM-DD')
          is distinct from payload->>'fecha_ejecucion' then
    invalid_fields := invalid_fields || 'fecha_ejecucion';
  end if;

  if payload->'tecnico_ejecutor' is null
     or payload->>'tecnico_ejecutor' is null
     or btrim(payload->>'tecnico_ejecutor') = '' then
    missing_fields := missing_fields || 'tecnico_ejecutor';
  elsif jsonb_typeof(payload->'tecnico_ejecutor') <> 'string' then
    invalid_fields := invalid_fields || 'tecnico_ejecutor';
  end if;

  if payload->'datos_tecnicos' is null
     or jsonb_typeof(payload->'datos_tecnicos') <> 'object' then
    invalid_fields := invalid_fields || 'datos_tecnicos';
  elsif payload->'datos_tecnicos' = '{}'::jsonb then
    missing_fields := missing_fields || 'datos_tecnicos';
  end if;

  if payload->'alcance_mantenimiento' is null
     or jsonb_typeof(payload->'alcance_mantenimiento') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(payload->'alcance_mantenimiento') value
       where jsonb_typeof(value) <> 'string'
     ) then
    invalid_fields := invalid_fields || 'alcance_mantenimiento';
  end if;

  if payload->'repuestos' is null
     or jsonb_typeof(payload->'repuestos') <> 'object'
     or jsonb_typeof(payload->'repuestos'->'catalog_version') <> 'string'
     or btrim(payload->'repuestos'->>'catalog_version') = ''
     or jsonb_typeof(payload->'repuestos'->'items') <> 'array'
     or exists (
       select 1 from jsonb_array_elements(payload->'repuestos'->'items') value
       where jsonb_typeof(value) not in ('string', 'object')
          or (jsonb_typeof(value) = 'object'
              and (jsonb_typeof(value->'id') <> 'string'
                   or jsonb_typeof(value->'label') <> 'string'))
     )
     or (payload->'repuestos' ? 'otros'
         and payload->'repuestos'->'otros' is not null
         and jsonb_typeof(payload->'repuestos'->'otros') <> 'string') then
    invalid_fields := invalid_fields || 'repuestos';
  end if;

  if payload->'evidencia_fotografica' is null
     or jsonb_typeof(payload->'evidencia_fotografica') <> 'object'
     or not (payload->'evidencia_fotografica' ?& evidence_keys) then
    invalid_fields := invalid_fields || 'evidencia_fotografica';
  else
    for item in select value from jsonb_each(payload->'evidencia_fotografica') loop
      if jsonb_typeof(item) not in ('null', 'object') then
        invalid_fields := invalid_fields || 'evidencia_fotografica';
        exit;
      end if;
    end loop;
  end if;

  if payload ? 'observaciones'
     and payload->'observaciones' is not null
     and jsonb_typeof(payload->'observaciones') <> 'null'
     and jsonb_typeof(payload->'observaciones') <> 'string' then
    invalid_fields := invalid_fields || 'observaciones';
  end if;

  return jsonb_build_object(
    'complete', cardinality(missing_fields) = 0 and cardinality(invalid_fields) = 0,
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;

create or replace function public.api_certificate_validation(c public.certificados)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  invalid_fields text[] := '{}';
begin
  result := public.api_validate_certificate_payload(jsonb_build_object(
    'fecha_ejecucion', c.fecha_ejecucion,
    'tecnico_ejecutor', c.tecnico_ejecutor,
    'datos_tecnicos', c.datos_tecnicos,
    'alcance_mantenimiento', c.alcance_mantenimiento,
    'repuestos', c.repuestos,
    'evidencia_fotografica', c.evidencia_fotografica,
    'observaciones', c.observaciones
  ));

  if c.tecnico_ejecutor is not null
     and btrim(c.tecnico_ejecutor) <> ''
     and not public.api_technician_name_is_member(c.visita_id, c.tecnico_ejecutor) then
    invalid_fields := invalid_fields || 'tecnico_ejecutor_no_asignado';
  end if;

  return jsonb_build_object(
    'complete', (result->>'complete')::boolean and cardinality(invalid_fields) = 0,
    'missing_fields', result->'missing_fields',
    'invalid_fields', (result->'invalid_fields') || to_jsonb(invalid_fields)
  );
end;
$$;

-- Capture the complete hierarchy at draft creation.  Later edits to the live
-- Válvula or its labels cannot rewrite a certificate's historical context.
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
  revision uuid;
  c public.certificados;
  context_snapshot jsonb;
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

  insert into public.valvula_revisiones(valvula_id, datos)
  values (x.id, to_jsonb(x))
  returning id into revision;

  insert into public.certificados(
    id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id,
    equipo_id, valvula_revision_id, contexto_captura
  )
  values (
    coalesce(target_certificate_id, gen_random_uuid()), o.id, o.visita_id, x.id,
    y.id, p.id, e.id, revision, context_snapshot
  )
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.api_start_certificate_draft(work_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.api_start_certificate_draft(work_order_id, null::uuid);
$$;

create or replace function public.api_update_certificate_draft(certificate_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  v public.visitas_servicio;
  next_payload jsonb;
  validation jsonb;
  key_name text;
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Certificate payload must be an object';
  end if;

  for key_name in select jsonb_object_keys(payload) loop
    if key_name not in (
      'fecha_ejecucion', 'tecnico_ejecutor', 'datos_tecnicos',
      'alcance_mantenimiento', 'repuestos', 'evidencia_fotografica', 'observaciones'
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Unsupported certificate field: ' || key_name;
    end if;
  end loop;

  select * into c from public.certificados where id = certificate_id for update;
  if c.id is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
  select * into v from public.visitas_servicio where id = c.visita_id;
  if v.estado <> 'en_curso' or c.estado_captura <> 'abierto' or c.estado <> 'borrador' then
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
  if payload ? 'tecnico_ejecutor' and payload->'tecnico_ejecutor' is not null
     and not public.api_technician_name_is_member(c.visita_id, payload->>'tecnico_ejecutor') then
    raise exception using errcode = 'insufficient_privilege', message = 'The Técnico is not assigned to the visit Taller Móvil';
  end if;

  next_payload := jsonb_build_object(
    'fecha_ejecucion', case when payload ? 'fecha_ejecucion' then payload->'fecha_ejecucion' else to_jsonb(c.fecha_ejecucion) end,
    'tecnico_ejecutor', case when payload ? 'tecnico_ejecutor' then payload->'tecnico_ejecutor' else to_jsonb(c.tecnico_ejecutor) end,
    'datos_tecnicos', case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else c.datos_tecnicos end,
    'alcance_mantenimiento', case when payload ? 'alcance_mantenimiento' then payload->'alcance_mantenimiento' else c.alcance_mantenimiento end,
    'repuestos', case when payload ? 'repuestos' then payload->'repuestos' else c.repuestos end,
    'evidencia_fotografica', case when payload ? 'evidencia_fotografica' then payload->'evidencia_fotografica' else c.evidencia_fotografica end,
    'observaciones', case when payload ? 'observaciones' then payload->'observaciones' else to_jsonb(c.observaciones) end
  );
  validation := public.api_validate_certificate_payload(next_payload);
  if jsonb_array_length(validation->'invalid_fields') > 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid canonical certificate fields: ' || (validation->'invalid_fields')::text;
  end if;

  update public.certificados set
    fecha_ejecucion = case when payload ? 'fecha_ejecucion' then (payload->>'fecha_ejecucion')::date else fecha_ejecucion end,
    tecnico_ejecutor = case when payload ? 'tecnico_ejecutor' then nullif(btrim(payload->>'tecnico_ejecutor'), '') else tecnico_ejecutor end,
    datos_tecnicos = case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else datos_tecnicos end,
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

-- Closed certificate data can never be reopened or edited.  The sole allowed
-- update after closure is the server-owned pending -> finalized transition.
create or replace function public.prevent_closed_certificate_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado_captura = 'cerrado' then
    if old.estado = 'pendiente'
       and new.estado = 'finalizado'
       and old.orden_trabajo_id = new.orden_trabajo_id
       and old.visita_id = new.visita_id
       and old.valvula_id = new.valvula_id
       and old.yacimiento_id = new.yacimiento_id
       and old.planta_id = new.planta_id
       and old.equipo_id = new.equipo_id
       and old.valvula_revision_id = new.valvula_revision_id
       and old.fecha_ejecucion is not distinct from new.fecha_ejecucion
       and old.tecnico_ejecutor is not distinct from new.tecnico_ejecutor
       and old.datos_tecnicos is not distinct from new.datos_tecnicos
       and old.alcance_mantenimiento is not distinct from new.alcance_mantenimiento
       and old.repuestos is not distinct from new.repuestos
       and old.evidencia_fotografica is not distinct from new.evidencia_fotografica
       and old.observaciones is not distinct from new.observaciones
       and old.contexto_captura is not distinct from new.contexto_captura
       and old.reemplaza_certificado_id is not distinct from new.reemplaza_certificado_id
       and old.plantilla_version is not distinct from new.plantilla_version then
      return new;
    end if;
    raise exception using errcode = 'check_violation', message = 'Closed certificate data is immutable; create a replacement certificate';
  end if;
  return new;
end;
$$;

drop trigger if exists certificados_closed_immutable on public.certificados;
create trigger certificados_closed_immutable
before update on public.certificados
for each row execute function public.prevent_closed_certificate_mutation();

-- Vigencia is derived only from Fecha de ejecución.  Client payloads never
-- write it, and finalized rows cannot have their validity changed later.
create or replace function public.set_certificate_validity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'finalizado' then
    if new.fecha_ejecucion is null then
      raise exception using errcode = 'check_violation', message = 'A finalized certificate requires an execution date';
    end if;
    new.vigencia_hasta := (new.fecha_ejecucion + interval '1 year')::date;
  else
    new.vigencia_hasta := null;
  end if;
  return new;
end;
$$;

drop trigger if exists certificados_validity_on_finalization on public.certificados;
drop trigger if exists certificados_validity_derived on public.certificados;
create trigger certificados_validity_derived
before insert or update on public.certificados
for each row execute function public.set_certificate_validity();

create or replace function public.api_finalize_visit_certificates(target_visit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  y public.yacimientos;
  p public.plantas_locaciones;
  e public.equipos_unidades;
  x public.valvulas;
  r public.valvula_revisiones;
  client_logo jsonb;
  counter bigint;
  finalized jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.firmas_visita where visita_id = target_visit and parte = 'tecnico')
     or not exists (select 1 from public.firmas_visita where visita_id = target_visit and parte = 'cliente') then
    return finalized;
  end if;

  select * into y from public.yacimientos where id = (select yacimiento_id from public.visitas_servicio where id = target_visit);
  select * into p from public.plantas_locaciones where id = (select planta_id from public.certificados where visita_id = target_visit limit 1);
  select * into e from public.equipos_unidades where id = (select equipo_id from public.certificados where visita_id = target_visit limit 1);
  select case when i.id is null then null else jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path) end
    into client_logo
  from public.clientes cl
  left join public.imagenes_certificado i on i.id = cl.logo_imagen_id
  where cl.cuenta_id = y.cliente_cuenta_id;

  -- The single counter row serializes all finalizations globally.
  perform 1 from public.contador_certificados where id = true for update;
  for c in
    select * from public.certificados
    where visita_id = target_visit and estado_captura = 'cerrado' and estado = 'pendiente'
    order by id
    for update
  loop
    if not ((public.api_certificate_validation(c)->>'complete')::boolean) then
      continue;
    end if;

    select * into r from public.valvula_revisiones where id = c.valvula_revision_id;
    select * into x from public.valvulas where id = c.valvula_id;
    select * into e from public.equipos_unidades where id = c.equipo_id;
    select * into p from public.plantas_locaciones where id = c.planta_id;
    select * into y from public.yacimientos where id = c.yacimiento_id;

    update public.contador_certificados
    set siguiente_numero = siguiente_numero + 1
    where id = true
    returning siguiente_numero - 1 into counter;

    update public.certificados
    set estado = 'finalizado',
        numero = counter,
        finalized_at = now(),
        instantanea = jsonb_build_object(
          'yacimiento', coalesce(c.contexto_captura->'yacimiento', to_jsonb(y)),
          'planta', coalesce(c.contexto_captura->'planta', to_jsonb(p)),
          'equipo', coalesce(c.contexto_captura->'equipo', to_jsonb(e)),
          'valvula', coalesce(c.contexto_captura->'valvula', r.datos, to_jsonb(x)),
          'valvula_revision_id', r.id,
          'captured_at', r.created_at,
          'client_logo', client_logo
        ),
        updated_at = now()
    where id = c.id
    returning * into c;

    finalized := finalized || jsonb_build_array(to_jsonb(c));
  end loop;
  return finalized;
end;
$$;

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
  if exists (select 1 from public.firmas_visita where visita_id = target_visit and parte = signing_party) then
    raise exception using errcode = 'check_violation', message = 'A visit signature cannot be replaced';
  end if;

  if signing_party = 'tecnico' then
    if v.estado <> 'en_curso'
       or not exists (select 1 from public.taller_cuentas where cuenta_id = actor and taller_movil_id = v.taller_movil_id)
       or not public.api_technician_name_is_member(target_visit, signer_name) then
      raise exception using errcode = 'insufficient_privilege', message = 'The Técnico is not assigned to this visit Taller Móvil';
    end if;
    if capture_method <> 'pwa_tecnico' then
      raise exception using errcode = 'invalid_parameter_value', message = 'Invalid Técnico capture method';
    end if;
  else
    if capture_method = 'panel_cliente' then
      if v.estado <> 'completada'
         or not exists (select 1 from public.yacimientos where id = v.yacimiento_id and cliente_cuenta_id = actor) then
        raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can upload a post-visit signature';
      end if;
      signer_account := actor;
    elsif capture_method = 'pwa_cliente_presencial' then
      if v.estado <> 'en_curso'
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

  return jsonb_build_object(
    'signature_id', signature_id,
    'finalized_certificates', public.api_finalize_visit_certificates(target_visit)
  );
end;
$$;

-- Offline synchronization uses the same registration rules.  Media bytes are
-- still uploaded by an Edge/storage helper before this RPC is replayed.
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
language sql
security definer
set search_path = public
as $$
  select public.api_submit_visit_signature(
    target_visit,
    signing_party,
    signer_name,
    bucket_name,
    asset_path,
    case when signing_party = 'tecnico' then 'pwa_tecnico' else 'pwa_cliente_presencial' end
  );
$$;

-- Preserve the offline/legacy five-argument seam, but make it use the same
-- authorized reference checks and provenance rules.
create or replace function public.api_submit_visit_signature(
  target_visit uuid,
  signing_party public.parte_firma_visita,
  signer_name text,
  bucket_name text,
  asset_path text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.api_submit_visit_signature(
    target_visit,
    signing_party,
    signer_name,
    bucket_name,
    asset_path,
    case when signing_party = 'tecnico' then 'pwa_tecnico' else 'pwa_cliente_presencial' end
  );
$$;

create or replace function public.api_finalized_certificate(certificate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.certificados;
  snapshot jsonb;
begin
  select * into c from public.certificados where id = certificate_id;
  if c.id is null or c.estado <> 'finalizado' then
    raise exception using errcode = 'no_data_found', message = 'Finalized certificate not found';
  end if;
  perform public.require_yacimiento_access(c.yacimiento_id);
  snapshot := coalesce(c.instantanea, c.contexto_captura);

  return jsonb_build_object(
    'certificate', to_jsonb(c),
    'context', jsonb_build_object(
      'yacimiento', snapshot->'yacimiento',
      'planta', snapshot->'planta',
      'equipo', snapshot->'equipo',
      'valvula', snapshot->'valvula'
    ),
    'snapshot', snapshot,
    'validity', jsonb_build_object(
      'execution_date', c.fecha_ejecucion,
      'valid_until', c.vigencia_hasta,
      'is_valid', c.vigencia_hasta is not null and current_date <= c.vigencia_hasta
    ),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'parte', f.parte,
        'nombre_firmante', f.nombre_firmante,
        'capture_method', f.capture_method,
        'captured_by_cuenta_id', f.captured_by_cuenta_id,
        'cuenta_id', f.cuenta_id,
        'captured_at', f.captured_at,
        'image', jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path)
      ) order by f.parte)
      from public.firmas_visita f
      join public.imagenes_certificado i on i.id = f.imagen_id
      where f.visita_id = c.visita_id
    ), '[]'::jsonb),
    'images', public.api_certificate_asset_refs(c.id),
    'client_logo', snapshot->'client_logo'
  );
end;
$$;

create or replace function public.api_valvula_certificates(target_valvula uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  yid uuid;
  current_id uuid;
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
    and c.vigencia_hasta is not null
    and current_date <= c.vigencia_hasta
  order by c.fecha_ejecucion desc, c.finalized_at desc, c.numero desc, c.id desc
  limit 1;

  return jsonb_build_object(
    'current_certificate_id', current_id,
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
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
          'is_valid', c.vigencia_hasta is not null and current_date <= c.vigencia_hasta
        ) else null end
      ) order by c.fecha_ejecucion desc nulls last, c.finalized_at desc nulls last, c.created_at desc, c.id desc)
      from public.certificados c
      where c.valvula_id = target_valvula
    ), '[]'::jsonb)
  );
end;
$$;

-- A correction/recalibration is a new work-order certificate lineage.  The
-- source remains closed and the new row follows the normal pending/finalized
-- rules of its own visit.
create or replace function public.api_create_certificate_replacement(
  source_certificate_id uuid,
  work_order_id uuid,
  reason text default 'correccion'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source public.certificados;
  target public.ordenes_trabajo;
  draft jsonb;
  replacement_id uuid;
begin
  select * into source from public.certificados where id = source_certificate_id for update;
  if source.id is null or source.estado_captura <> 'cerrado' then
    raise exception using errcode = 'check_violation', message = 'Only a closed certificate can be corrected or recalibrated';
  end if;
  select * into target from public.ordenes_trabajo where id = work_order_id for update;
  if target.id is null or target.valvula_id <> source.valvula_id or target.estado <> 'evaluada' then
    raise exception using errcode = 'check_violation', message = 'The replacement work order must evaluate the same Válvula';
  end if;
  if reason is null or btrim(reason) = '' then
    raise exception using errcode = 'invalid_parameter_value', message = 'A replacement reason is required';
  end if;

  draft := public.api_start_certificate_draft(work_order_id, gen_random_uuid());
  replacement_id := (draft->'certificate'->>'id')::uuid;
  update public.certificados
  set reemplaza_certificado_id = source.id,
      motivo_reemplazo = btrim(reason),
      updated_at = now()
  where id = replacement_id;
  select jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c))
    into draft
  from public.certificados c where c.id = replacement_id;
  return draft;
end;
$$;

-- This RPC is the only certificate image-reference registration path.  It is
-- intentionally service_role-only because the Edge gateway supplies auth.uid.
revoke all on function public.api_validate_certificate_payload(jsonb),
  public.api_certificate_validation(public.certificados),
  public.api_technician_name_is_member(uuid, text),
  public.api_start_certificate_draft(uuid),
  public.api_start_certificate_draft(uuid, uuid),
  public.api_update_certificate_draft(uuid, jsonb),
  public.api_finalize_visit_certificates(uuid),
  public.api_certificate_asset_refs(uuid),
  public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text),
  public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz),
  public.api_finalized_certificate(uuid),
  public.api_valvula_certificates(uuid),
  public.api_create_certificate_replacement(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.api_start_certificate_draft(uuid),
  public.api_start_certificate_draft(uuid, uuid),
  public.api_update_certificate_draft(uuid, jsonb),
  public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text),
  public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz),
  public.api_certificate_asset_refs(uuid),
  public.api_finalized_certificate(uuid),
  public.api_valvula_certificates(uuid),
  public.api_create_certificate_replacement(uuid, uuid, text)
to service_role;

commit;

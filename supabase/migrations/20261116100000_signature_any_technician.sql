-- F1: puede firmar cualquier técnico, incluido un reemplazante fuera de la nómina del día.
-- Se quita la validación del nombre contra la nómina (`api_technician_name_is_member`) de las
-- firmas (online y offline), de la edición del borrador y de la validación del certificado. El
-- Técnico sigue necesitando una cuenta del Taller Móvil asignado a la visita.
-- La función `api_technician_name_is_member` queda sin uso.

begin;

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
    if v.estado <> 'en_curso'
       or not exists (select 1 from public.taller_cuentas where cuenta_id = actor and taller_movil_id = v.taller_movil_id) then
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

-- Base: 20261006131500 (firma sin conexión). Solo cambia el caso de firma ya registrada.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  actor uuid := auth.uid();
  signature_id uuid;
  image_id uuid;
  canonical_method text;
  finalized jsonb;
  existing_result jsonb;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row
  from public.visitas_servicio
  where id = target_visit
  for update;
  if visit_row.id is null then
    raise exception using errcode = '02000', message = 'Visit not found';
  end if;
  if signer_name is null or btrim(signer_name) = '' then
    raise exception using errcode = '22023', message = 'A signer name is required';
  end if;
  if signing_party is null then
    raise exception using errcode = '22023', message = 'A signing party is required';
  end if;
  if bucket_name <> 'certificate-signatures'
     or asset_path !~ ('^visits/' || target_visit::text || '/' || signing_party::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$') then
    raise exception using errcode = '22023', message = 'Signature storage reference is not authorized';
  end if;
  if target_image_id is null
     or asset_path !~ ('^visits/' || target_visit::text || '/' || signing_party::text || '/' || target_image_id::text || '[.](jpg|jpeg|png|webp)$') then
    raise exception using errcode = '22023', message = 'Signature image identity does not match its storage path';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = bucket_name and name = asset_path
  ) then
    raise exception using errcode = '02000', message = 'Signature object was not uploaded through Storage';
  end if;
  existing_result := public.existing_visit_signature_result(visit_row, signing_party, actor);
  if existing_result is not null then
    return existing_result;
  end if;

  canonical_method := case
    when signing_party = 'tecnico' then 'pwa_tecnico'
    else 'pwa_cliente_presencial'
  end;
  if signing_party = 'tecnico' then
    if visit_row.estado <> 'en_curso'
       or not exists (
         select 1 from public.taller_cuentas
         where cuenta_id = actor and taller_movil_id = visit_row.taller_movil_id
       ) then
      raise exception using errcode = '42501', message = 'The Técnico is not assigned to this visit Taller Móvil';
    end if;
  else
    if visit_row.estado <> 'en_curso'
       or not exists (
         select 1 from public.taller_cuentas
         where cuenta_id = actor and taller_movil_id = visit_row.taller_movil_id
       ) then
      raise exception using errcode = '42501', message = 'Only the assigned Taller Móvil can capture an in-person Cliente signature';
    end if;
  end if;

  insert into public.imagenes_certificado(id, bucket, object_path, categoria)
  values (
    target_image_id,
    bucket_name,
    asset_path,
    'firma_' || signing_party::text
  )
  returning id into image_id;
  insert into public.firmas_visita(
    visita_id, parte, nombre_firmante, cuenta_id, imagen_id,
    captured_at, capture_method, captured_by_cuenta_id
  )
  values (
    target_visit, signing_party, btrim(signer_name), null, image_id,
    coalesce($7, now()), canonical_method, actor
  )
  returning id into signature_id;

  finalized := public.api_finalize_visit_certificates(target_visit);
  return jsonb_build_object(
    'signature_id', signature_id,
    'image_id', image_id,
    'finalized_certificates', finalized,
    'capture_method', canonical_method,
    'captured_at', coalesce($7, now())
  );
end;
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

create or replace function public.api_certificate_validation(c public.certificados)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  custom_result jsonb;
  test_result jsonb;
  invalid_fields text[] := '{}';
  missing_fields text[] := '{}';
begin
  result := public.api_validate_certificate_payload(jsonb_build_object(
    'fecha_ejecucion', c.fecha_ejecucion,
    'tecnico_ejecutor', c.tecnico_ejecutor,
    'datos_tecnicos', c.datos_tecnicos,
    'campos_personalizados', c.campos_personalizados,
    'alcance_mantenimiento', c.alcance_mantenimiento,
    'repuestos', c.repuestos,
    'evidencia_fotografica', c.evidencia_fotografica,
    'observaciones', c.observaciones
  ));
  custom_result := public.api_validate_custom_certificate_fields(c.plantilla_snapshot, c.campos_personalizados);
  test_result := public.api_certificate_test_validation(c.datos_tecnicos);
  missing_fields := array(select jsonb_array_elements_text(custom_result->'missing_fields'));
  missing_fields := missing_fields || array(select jsonb_array_elements_text(test_result->'missing_fields'));
  invalid_fields := array(select jsonb_array_elements_text(custom_result->'invalid_fields'));
  invalid_fields := invalid_fields || array(select jsonb_array_elements_text(test_result->'invalid_fields'));

  return jsonb_build_object(
    'complete', (result->>'complete')::boolean
      and cardinality(missing_fields) = 0
      and cardinality(invalid_fields) = 0,
    'missing_fields', (result->'missing_fields') || to_jsonb(missing_fields),
    'invalid_fields', (result->'invalid_fields') || to_jsonb(invalid_fields)
  );
end;
$$;

revoke all on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz),
  public.api_update_certificate_draft(uuid, jsonb),
  public.api_certificate_validation(public.certificados)
  from public, anon, authenticated;
grant execute on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz),
  public.api_update_certificate_draft(uuid, jsonb),
  public.api_certificate_validation(public.certificados)
  to service_role;

commit;

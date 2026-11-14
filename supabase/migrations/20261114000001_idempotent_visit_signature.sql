begin;

-- P1: registrar una firma de visita es idempotente.
--
-- Un reintento (sin conexión o en línea) de una firma cuya parte ya está registrada respondía
-- «A visit signature cannot be replaced»: la sincronización quedaba en conflicto y el cierre de la
-- visita se trababa. Ahora, si la visita ya tiene la firma de esa parte, el RPC devuelve la firma
-- registrada con la misma forma que un alta exitosa más `already_registered: true`, y no escribe
-- nada:
--   * nunca se reemplaza ni se modifica la firma guardada (firmante, imagen y hora quedan como
--     estaban); la imagen del reintento no se registra y la Edge Function puede borrarla;
--   * `finalized_certificates` vuelve vacío: el reintento no finaliza certificados;
--   * solo vale para quien podía firmar esa visita (la cuenta del Taller Móvil asignado, o el
--     Cliente dueño para su propia firma) y con la visita en curso o completada; en cualquier otro
--     caso se mantiene el error anterior.
-- Las validaciones de la referencia de Storage se mantienen antes de esta comprobación.

-- Devuelve la firma ya registrada de esa parte si el actor puede reintentarla, o null si no hay
-- firma. Uso interno de los RPC de firma (no es un endpoint).
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
  if visit_row.estado not in ('en_curso', 'completada')
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

-- Base: 20260926211000 (firma en línea). Solo cambia el caso de firma ya registrada.
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
       )
       or not public.api_technician_name_is_member(target_visit, signer_name) then
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

revoke all on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text, text),
  public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz)
  to service_role;

commit;

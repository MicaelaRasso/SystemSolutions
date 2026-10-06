begin;

-- Keep offline signature identity and provenance from the device payload while
-- applying the same visit, Taller Móvil, technician, and Storage checks as the
-- online signature route.
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
  if exists (
    select 1 from public.firmas_visita
    where visita_id = target_visit and parte = signing_party
  ) then
    raise exception using errcode = '23514', message = 'A visit signature cannot be replaced';
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

revoke all on function public.api_offline_submit_signature(
  uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.api_offline_submit_signature(
  uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz
) to service_role;

commit;

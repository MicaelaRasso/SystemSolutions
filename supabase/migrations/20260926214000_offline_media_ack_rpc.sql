begin;

-- A signature capture queues a small upload operation before the signature
-- operation. It has no certificate id yet, so acknowledge the uploaded object
-- without creating an unattached certificate image row. The dependent
-- submit_signature RPC creates the durable image/signature reference.
create or replace function public.api_register_offline_media(
  target_certificate uuid,
  target_media uuid,
  media_category text,
  bucket_name text,
  asset_path text,
  unavailable boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, storage
as $$
declare
  c public.certificados;
  image public.imagenes_certificado;
  evidence jsonb;
begin
  if target_certificate is null then
    if target_media is null or bucket_name is null or asset_path is null
       or not exists (
         select 1 from storage.objects
         where bucket_id = bucket_name and name = asset_path
       ) then
      raise exception using errcode = '02000', message = 'Offline media must be uploaded before acknowledgement';
    end if;
    return jsonb_build_object(
      'media_id', target_media,
      'image_id', target_media,
      'bucket', bucket_name,
      'object_path', asset_path
    );
  end if;

  select * into c from public.certificados where id = target_certificate for update;
  if c.id is null then
    raise exception using errcode = '02000', message = 'Certificate not found';
  end if;
  if c.estado_captura <> 'abierto' then
    raise exception using errcode = '23514', message = 'Certificate capture is closed';
  end if;
  if unavailable then
    evidence := c.evidencia_fotografica || jsonb_build_object(media_category, null);
  else
    if target_media is null or bucket_name is null or asset_path is null then
      raise exception using errcode = '22023', message = 'Offline evidence requires an uploaded media reference';
    end if;
    insert into public.imagenes_certificado(id, bucket, object_path, categoria)
    values (target_media, bucket_name, asset_path, media_category)
    on conflict (id) do nothing;
    select * into image from public.imagenes_certificado where id = target_media;
    if image.bucket <> bucket_name or image.object_path <> asset_path then
      raise exception using errcode = '23505', message = 'Offline media identity is already bound to another object';
    end if;
    evidence := c.evidencia_fotografica || jsonb_build_object(
      media_category,
      jsonb_build_object('image_id', image.id, 'bucket', image.bucket, 'object_path', image.object_path)
    );
  end if;
  update public.certificados
  set evidencia_fotografica = evidence, updated_at = now()
  where id = c.id returning * into c;
  return jsonb_build_object('certificate', to_jsonb(c), 'media_id', image.id);
end;
$$;

revoke all on function public.api_register_offline_media(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.api_register_offline_media(uuid, uuid, text, text, text, boolean)
  to service_role;

-- Keep the device field timestamp distinct from the server receipt while
-- reusing the hardened signature authorization and Storage checks.
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
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
  signature_id uuid;
begin
  result := public.api_submit_visit_signature(
    target_visit,
    signing_party,
    signer_name,
    bucket_name,
    asset_path,
    case when signing_party = 'tecnico' then 'pwa_tecnico' else 'pwa_cliente_presencial' end
  );
  signature_id := (result->>'signature_id')::uuid;
  if captured_at is not null then
    update public.firmas_visita f set captured_at = $7 where f.id = signature_id;
  end if;
  return result;
end;
$$;

revoke all on function public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_offline_submit_signature(uuid, public.parte_firma_visita, text, text, text, uuid, timestamptz)
  to service_role;

commit;

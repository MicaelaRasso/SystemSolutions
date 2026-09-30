begin;

select plan(8);

select is(
  (select public from storage.buckets where id = 'certificate-signatures'),
  false,
  'visit signatures remain in a private Storage bucket'
);
select is(
  (select file_size_limit from storage.buckets where id = 'certificate-signatures'),
  10485760::bigint,
  'Storage enforces the same 10 MiB signature limit as the Edge Function'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'certificate-signatures'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'Storage permits only supported raster signature images'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)',
    'execute'
  ),
  false,
  'Cliente browser sessions cannot bypass the Edge Function and call the signature RPC'
);
select is(
  has_function_privilege(
    'service_role',
    'public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)',
    'execute'
  ),
  true,
  'the authenticated Edge gateway can register visit signatures'
);
select like(
  pg_get_functiondef('public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)'::regprocedure),
  '%capture_method = ''panel_cliente''%',
  'post-visit Cliente signatures require the Cliente panel capture method'
);
select like(
  pg_get_functiondef('public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)'::regprocedure),
  '%capture_method = ''pwa_cliente_presencial''%',
  'Técnico-captured in-person Cliente signatures remain supported'
);
select like(
  pg_get_functiondef('public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)'::regprocedure),
  '%api_finalize_visit_certificates(target_visit)%',
  'the visit signature is applied to eligible certificates through the visit finalizer'
);

select * from finish();

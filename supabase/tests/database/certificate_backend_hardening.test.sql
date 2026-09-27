begin;

select plan(15);

select has_column('public', 'certificados', 'plantilla_version', 'certificates retain the canonical template version');
select has_column('public', 'certificados', 'contexto_captura', 'certificate context is captured before closure');
select has_column('public', 'certificados', 'reemplaza_certificado_id', 'corrections link to a prior immutable certificate');
select has_column('public', 'firmas_visita', 'capture_method', 'visit signatures retain capture method');
select has_column('public', 'firmas_visita', 'captured_by_cuenta_id', 'visit signatures retain capture actor provenance');

select has_function(
  'public',
  'api_validate_certificate_payload',
  array['jsonb']::text[],
  'canonical certificate payload validation is server-owned'
);
select has_function(
  'public',
  'api_create_certificate_replacement',
  array['uuid', 'uuid', 'text']::text[],
  'recalibration and correction create a new certificate lineage'
);
select has_function(
  'public',
  'api_submit_visit_signature',
  array['uuid', 'public.parte_firma_visita', 'text', 'text', 'text', 'text']::text[],
  'visit signature registration records capture provenance'
);

select is(
  (select public_value from (values (exists (
    select 1 from storage.buckets where id = 'certificate-signatures' and public = false
  ))) as bucket_check(public_value)),
  true,
  'certificate signatures use a private dedicated Storage bucket'
);

select is(
  has_function_privilege(
    'service_role',
    'public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)',
    'execute'
  ),
  true,
  'only the Edge gateway service role can register signatures'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.api_submit_visit_signature(uuid,public.parte_firma_visita,text,text,text,text)',
    'execute'
  ),
  false,
  'browser sessions cannot execute the signature RPC directly'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.api_update_certificate_draft(uuid,jsonb)',
    'execute'
  ),
  false,
  'browser sessions cannot execute the certificate draft RPC directly'
);

select is(
  (select count(*) from pg_trigger where tgname = 'certificados_closed_immutable') > 0,
  true,
  'closed certificate immutability is enforced by a trigger'
);
select is(
  (select count(*) from pg_trigger where tgname = 'certificado_imagenes_append_only') > 0,
  true,
  'certificate image references are append-only'
);
select is(
  (select count(*) from pg_trigger where tgname = 'certificado_imagenes_requires_storage_object') > 0,
  true,
  'certificate image references require a real Storage object'
);

select * from extensions.finish(true);

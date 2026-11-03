begin;

select plan(4);

-- Regresion: el formulario envia `otros: null` cuando el campo esta vacio. Un
-- `null` de JSON no es `NULL` de SQL, asi que el validador marcaba `repuestos`
-- como invalido y el borrador no se podia guardar.

select is(
  (public.api_validate_certificate_payload(
    '{"repuestos":{"catalog_version":"v1","items":[],"otros":null}}'::jsonb
  )->'invalid_fields') ? 'repuestos',
  false,
  'a JSON null in otros does not invalidate repuestos'
);

select is(
  (public.api_validate_certificate_payload(
    '{"repuestos":{"catalog_version":"v1","items":[]}}'::jsonb
  )->'invalid_fields') ? 'repuestos',
  false,
  'omitting otros does not invalidate repuestos'
);

select is(
  (public.api_validate_certificate_payload(
    '{"repuestos":{"catalog_version":"v1","items":[],"otros":"Junta especial"}}'::jsonb
  )->'invalid_fields') ? 'repuestos',
  false,
  'a text value in otros does not invalidate repuestos'
);

select is(
  (public.api_validate_certificate_payload(
    '{"repuestos":{"catalog_version":"v1","items":[],"otros":123}}'::jsonb
  )->'invalid_fields') ? 'repuestos',
  true,
  'a non-text value in otros still invalidates repuestos'
);

select * from extensions.finish(true);
rollback;

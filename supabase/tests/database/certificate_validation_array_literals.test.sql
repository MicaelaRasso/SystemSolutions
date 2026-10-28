begin;

select plan(7);

-- Regresion: `text[] || 'literal sin tipo'` fallaba con
-- `malformed array literal: "fecha_ejecucion"` al validar un borrador vacio.

select lives_ok(
  $$select public.api_validate_certificate_payload('{}'::jsonb)$$,
  'validating an empty payload reports problems instead of raising'
);

select is(
  (public.api_validate_certificate_payload('{}'::jsonb)->>'complete')::boolean,
  false,
  'an empty payload is not complete'
);

select is(
  (public.api_validate_certificate_payload('{}'::jsonb)->'missing_fields')
    ?& array['fecha_ejecucion', 'tecnico_ejecutor'],
  true,
  'an empty payload lists the execution date and technician as missing'
);

select is(
  (public.api_validate_certificate_payload('{"fecha_ejecucion":"31/12/2026"}'::jsonb)->'invalid_fields')
    ? 'fecha_ejecucion',
  true,
  'a malformed execution date is reported as invalid'
);

select is(
  (public.api_validate_certificate_payload('{"fecha_ejecucion":"31/12/2026"}'::jsonb)->'missing_fields')
    ? 'fecha_ejecucion',
  false,
  'a malformed execution date is not reported as missing'
);

select is(
  (public.api_validate_certificate_payload('{"campo_inexistente":1}'::jsonb)->'invalid_fields')
    ? 'unsupported_campo_inexistente',
  true,
  'an unsupported key is reported with its name'
);

select is(
  (public.api_certificate_test_validation('{"ensayos":{}}'::jsonb)->'missing_fields')
    ?& array['ensayos.sp_inicial', 'ensayos.sp_apertura', 'ensayos.presion_cierre', 'ensayos.patron'],
  true,
  'technical data with an empty tests object lists every test and the pattern as missing'
);

select * from extensions.finish(true);
rollback;

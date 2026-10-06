begin;

select plan(5);

select has_function(
  'public',
  'api_certificate_test_validation',
  array['jsonb']::text[],
  'certificate test validation is available to the server-side certificate flow'
);

select is(
  (public.api_certificate_test_validation('{"ensayos":{"sp_inicial":{},"sp_apertura":{},"presion_cierre":{},"patron":{}}}'::jsonb)
    -> 'invalid_fields') ?& array['ensayos.sp_inicial', 'ensayos.sp_apertura', 'ensayos.presion_cierre', 'ensayos.patron'],
  true,
  'empty test results and pattern objects are invalid rather than complete'
);

select is(
  (public.api_certificate_test_validation('{"ensayos":{}}'::jsonb)
    -> 'missing_fields') ?& array['ensayos.sp_inicial', 'ensayos.sp_apertura', 'ensayos.presion_cierre', 'ensayos.patron'],
  true,
  'all required tests and the pattern must be present'
);

select is(
  jsonb_array_length(public.api_certificate_test_validation('{"ensayos":{"sp_inicial":{"valor":1,"unidad":"bar"},"sp_apertura":{"valor":2,"unidad":"bar"},"presion_cierre":{"valor":3,"unidad":"bar"},"patron":{"id":"p1","label":"Patrón 1"}}}'::jsonb) -> 'invalid_fields'),
  0,
  'complete typed test results and reference pattern are valid'
);

select is(
  has_function_privilege('authenticated', 'public.api_certificate_test_validation(jsonb)', 'execute'),
  false,
  'the test validator is not directly executable by the browser role'
);

select * from extensions.finish(true);

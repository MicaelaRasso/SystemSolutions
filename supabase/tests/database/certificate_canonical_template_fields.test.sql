begin;

select plan(3);

-- D1: la plantilla sembrada por la migración declara `fecha_ejecucion` y `tecnico_ejecutor` como
-- campos obligatorios, pero son columnas propias del certificado (se validan en
-- api_certificate_validation). Como campos personalizados nunca llegan, y el cierre fallaba.
select is(
  public.api_validate_custom_certificate_fields(
    jsonb_build_object('campos', jsonb_build_array(
      jsonb_build_object('clave', 'fecha_ejecucion', 'obligatorio', true),
      jsonb_build_object('clave', 'tecnico_ejecutor', 'obligatorio', true),
      jsonb_build_object('clave', 'observaciones', 'obligatorio', false)
    )),
    '{}'::jsonb
  )->'missing_fields',
  '[]'::jsonb,
  'canonical certificate columns declared in the template are not required as custom fields'
);

select is(
  public.api_validate_custom_certificate_fields(
    jsonb_build_object('campos', jsonb_build_array(
      jsonb_build_object('clave', 'fecha_ejecucion', 'obligatorio', true),
      jsonb_build_object('clave', 'presion_linea', 'obligatorio', true)
    )),
    '{}'::jsonb
  )->'missing_fields',
  '["campo_personalizado_presion_linea"]'::jsonb,
  'a genuine required custom field is still reported as missing'
);

select is(
  public.api_validate_custom_certificate_fields(
    jsonb_build_object('campos', jsonb_build_array(
      jsonb_build_object('clave', 'presion_linea', 'obligatorio', true)
    )),
    '{"presion_linea": "12"}'::jsonb
  )->'missing_fields',
  '[]'::jsonb,
  'a filled required custom field passes'
);

select * from extensions.finish(true);
rollback;

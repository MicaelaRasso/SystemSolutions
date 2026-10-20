-- Corrige "malformed array literal" al validar un borrador de certificado.
--
-- En Postgres, `text[] || 'literal sin tipo'` resuelve el literal como `text[]`
-- (el operador asume que el literal desconocido tiene el tipo del otro operando)
-- y falla con `malformed array literal: "fecha_ejecucion"`. Las funciones de
-- validacion hacian `missing_fields := missing_fields || 'fecha_ejecucion'`,
-- asi que iniciar un borrador nuevo (que aun no tiene fecha ni tecnico) fallaba.
--
-- Esta migracion reemplaza la version vigente de cada funcion afectada, sin
-- cambiar nada mas que `|| 'literal'` por `|| 'literal'::text`. `create or
-- replace` conserva propietario y permisos, por eso no se vuelven a otorgar.
--
-- Funciones y migracion de origen de la version vigente:
--   api_validate_certificate_payload(jsonb)
--     20261003221209_canonical_certificate_payload_catalog_contract.sql
--   api_certificate_test_validation(jsonb)
--     20261005154526_certificate_capture_offline_validation.sql
--   api_certificate_validation(public.certificados)
--     20261005154526_certificate_capture_offline_validation.sql

begin;
create or replace function public.api_validate_certificate_payload(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing_fields text[] := '{}';
  invalid_fields text[] := '{}';
  item jsonb;
  key_name text;
  evidence_keys text[] := array['desarmada', 'ensamblada_prueba', 'placa_precinto'];
  allowed_keys text[] := array[
    'fecha_ejecucion', 'tecnico_ejecutor', 'datos_tecnicos',
    'campos_personalizados', 'alcance_mantenimiento', 'repuestos',
    'evidencia_fotografica', 'observaciones'
  ];
begin
  if jsonb_typeof(payload) <> 'object' then
    return jsonb_build_object(
      'complete', false,
      'missing_fields', jsonb_build_array(),
      'invalid_fields', jsonb_build_array('payload')
    );
  end if;

  for key_name in select jsonb_object_keys(payload) loop
    if not (key_name = any(allowed_keys)) then
      invalid_fields := invalid_fields || ('unsupported_' || key_name);
    end if;
  end loop;

  if payload->'fecha_ejecucion' is null
     or payload->>'fecha_ejecucion' is null
     or btrim(payload->>'fecha_ejecucion') = '' then
    missing_fields := missing_fields || 'fecha_ejecucion'::text;
  elsif jsonb_typeof(payload->'fecha_ejecucion') <> 'string'
     or payload->>'fecha_ejecucion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char(to_date(payload->>'fecha_ejecucion', 'YYYY-MM-DD'), 'YYYY-MM-DD')
          is distinct from payload->>'fecha_ejecucion' then
    invalid_fields := invalid_fields || 'fecha_ejecucion'::text;
  end if;

  if payload->'tecnico_ejecutor' is null
     or payload->>'tecnico_ejecutor' is null
     or btrim(payload->>'tecnico_ejecutor') = '' then
    missing_fields := missing_fields || 'tecnico_ejecutor'::text;
  elsif jsonb_typeof(payload->'tecnico_ejecutor') <> 'string' then
    invalid_fields := invalid_fields || 'tecnico_ejecutor'::text;
  end if;

  if payload->'datos_tecnicos' is null
     or jsonb_typeof(payload->'datos_tecnicos') <> 'object' then
    invalid_fields := invalid_fields || 'datos_tecnicos'::text;
  elsif payload->'datos_tecnicos' = '{}'::jsonb then
    missing_fields := missing_fields || 'datos_tecnicos'::text;
  end if;

  if payload ? 'campos_personalizados'
     and (payload->'campos_personalizados' is null
       or jsonb_typeof(payload->'campos_personalizados') <> 'object') then
    invalid_fields := invalid_fields || 'campos_personalizados'::text;
  end if;

  if payload->'alcance_mantenimiento' is null
     or jsonb_typeof(payload->'alcance_mantenimiento') <> 'array' then
    invalid_fields := invalid_fields || 'alcance_mantenimiento'::text;
  else
    for item in select value from jsonb_array_elements(payload->'alcance_mantenimiento') loop
      if jsonb_typeof(item) = 'string' then
        if btrim(item #>> '{}') = '' then
          invalid_fields := invalid_fields || 'alcance_mantenimiento'::text;
          exit;
        end if;
      elsif jsonb_typeof(item) <> 'object'
         or (select count(*) from jsonb_object_keys(item)) <> 2
         or not (item ?& array['id', 'label'])
         or jsonb_typeof(item->'id') <> 'string'
         or btrim(item->>'id') = ''
         or jsonb_typeof(item->'label') <> 'string'
         or btrim(item->>'label') = '' then
        invalid_fields := invalid_fields || 'alcance_mantenimiento'::text;
        exit;
      end if;
    end loop;
  end if;

  if payload->'repuestos' is null
     or jsonb_typeof(payload->'repuestos') <> 'object'
     or jsonb_typeof(payload->'repuestos'->'catalog_version') <> 'string'
     or btrim(payload->'repuestos'->>'catalog_version') = ''
     or jsonb_typeof(payload->'repuestos'->'items') <> 'array'
     or (payload->'repuestos' ? 'otros'
         and payload->'repuestos'->'otros' is not null
         and jsonb_typeof(payload->'repuestos'->'otros') <> 'string') then
    invalid_fields := invalid_fields || 'repuestos'::text;
  else
    for item in select value from jsonb_array_elements(payload->'repuestos'->'items') loop
      if jsonb_typeof(item) = 'string' then
        if btrim(item #>> '{}') = '' then
          invalid_fields := invalid_fields || 'repuestos'::text;
          exit;
        end if;
      elsif jsonb_typeof(item) <> 'object'
         or (select count(*) from jsonb_object_keys(item)) <> 2
         or not (item ?& array['id', 'label'])
         or jsonb_typeof(item->'id') <> 'string'
         or btrim(item->>'id') = ''
         or jsonb_typeof(item->'label') <> 'string'
         or btrim(item->>'label') = '' then
        invalid_fields := invalid_fields || 'repuestos'::text;
        exit;
      end if;
    end loop;
  end if;

  if payload->'evidencia_fotografica' is null
     or jsonb_typeof(payload->'evidencia_fotografica') <> 'object'
     or not (payload->'evidencia_fotografica' ?& evidence_keys) then
    invalid_fields := invalid_fields || 'evidencia_fotografica'::text;
  else
    for item in select value from jsonb_each(payload->'evidencia_fotografica') loop
      if jsonb_typeof(item) not in ('null', 'object') then
        invalid_fields := invalid_fields || 'evidencia_fotografica'::text;
        exit;
      end if;
    end loop;
  end if;

  if payload ? 'observaciones'
     and payload->'observaciones' is not null
     and jsonb_typeof(payload->'observaciones') <> 'null'
     and jsonb_typeof(payload->'observaciones') <> 'string' then
    invalid_fields := invalid_fields || 'observaciones'::text;
  end if;

  return jsonb_build_object(
    'complete', cardinality(missing_fields) = 0 and cardinality(invalid_fields) = 0,
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;
create or replace function public.api_certificate_test_validation(technical_data jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  tests jsonb := technical_data->'ensayos';
  test_key text;
  result jsonb;
  missing_fields text[] := '{}';
  invalid_fields text[] := '{}';
begin
  if jsonb_typeof(tests) <> 'object' then
    return jsonb_build_object(
      'missing_fields', jsonb_build_array('ensayos'),
      'invalid_fields', jsonb_build_array()
    );
  end if;

  foreach test_key in array array['sp_inicial', 'sp_apertura', 'presion_cierre'] loop
    result := tests->test_key;
    if result is null or jsonb_typeof(result) = 'null' then
      missing_fields := missing_fields || ('ensayos.' || test_key);
    elsif jsonb_typeof(result) is distinct from 'object'
       or jsonb_typeof(result->'valor') is distinct from 'number'
       or jsonb_typeof(result->'unidad') is distinct from 'string'
       or btrim(result->>'unidad') = '' then
      invalid_fields := invalid_fields || ('ensayos.' || test_key);
    end if;
  end loop;

  result := tests->'patron';
  if result is null or jsonb_typeof(result) = 'null' then
    missing_fields := missing_fields || 'ensayos.patron'::text;
  elsif jsonb_typeof(result) = 'string' then
    if btrim(result #>> '{}') = '' then
      invalid_fields := invalid_fields || 'ensayos.patron'::text;
    end if;
  elsif jsonb_typeof(result) is distinct from 'object'
     or jsonb_typeof(result->'id') is distinct from 'string'
     or btrim(result->>'id') = ''
     or jsonb_typeof(result->'label') is distinct from 'string'
     or btrim(result->>'label') = '' then
    invalid_fields := invalid_fields || 'ensayos.patron'::text;
  end if;

  return jsonb_build_object(
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
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

  if c.tecnico_ejecutor is not null
     and btrim(c.tecnico_ejecutor) <> ''
     and not public.api_technician_name_is_member(c.visita_id, c.tecnico_ejecutor) then
    invalid_fields := invalid_fields || 'tecnico_ejecutor_no_asignado'::text;
  end if;

  return jsonb_build_object(
    'complete', (result->>'complete')::boolean
      and cardinality(missing_fields) = 0
      and cardinality(invalid_fields) = 0,
    'missing_fields', (result->'missing_fields') || to_jsonb(missing_fields),
    'invalid_fields', (result->'invalid_fields') || to_jsonb(invalid_fields)
  );
end;
$$;
commit;

-- Permite `otros: null` en `repuestos` al validar un borrador de certificado.
--
-- El formulario envia `otros: null` cuando el campo esta vacio y el contrato lo
-- admite, pero un `null` de JSON no es `NULL` de SQL: `-> 'otros' is not null` da
-- verdadero y su tipo es 'null', no 'string'. El validador marcaba `repuestos`
-- como invalido y el borrador no se podia guardar. `observaciones` ya tenia esta
-- guarda; se agrega la misma para `otros`, sin cambiar nada mas.
--
-- Version de origen: 20261014130000_fix_certificate_validation_array_literals.sql.
-- `create or replace` conserva propietario y permisos.

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
         and jsonb_typeof(payload->'repuestos'->'otros') <> 'null'
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
commit;

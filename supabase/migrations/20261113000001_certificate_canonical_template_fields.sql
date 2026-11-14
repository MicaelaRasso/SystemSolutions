begin;

-- D1: la plantilla sembrada por 20261003221209 declara `fecha_ejecucion` y `tecnico_ejecutor`
-- como campos obligatorios, pero son columnas propias del certificado y ya se validan en
-- api_certificate_validation. Como campos personalizados nunca llegan, así que con esa plantilla
-- activa ninguna visita se podía completar. Las claves canónicas se omiten de la verificación de
-- campos personalizados (obligatorios y no definidos).
--
-- Además, el bucle de claves no definidas usaba el alias `field_definition`, que choca con la
-- variable PL/pgSQL del mismo nombre: con cualquier campo personalizado cargado la función fallaba
-- con «column reference "field_definition" is ambiguous».
create or replace function public.api_validate_custom_certificate_fields(
  template_snapshot jsonb,
  field_values jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  canonical_keys constant text[] := array['fecha_ejecucion', 'tecnico_ejecutor', 'observaciones'];
  missing_fields text[] := '{}';
  invalid_fields text[] := '{}';
  field_definition jsonb;
  key_name text;
begin
  if field_values is null or jsonb_typeof(field_values) <> 'object' then
    return jsonb_build_object(
      'missing_fields', jsonb_build_array(),
      'invalid_fields', jsonb_build_array('campos_personalizados')
    );
  end if;

  for key_name in select jsonb_object_keys(field_values) loop
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(template_snapshot->'campos', '[]'::jsonb)) as defined(value)
      where defined.value->>'clave' = key_name
    ) then
      invalid_fields := invalid_fields || ('campo_personalizado_no_definido_' || key_name);
    end if;
  end loop;

  for field_definition in
    select defined.value
    from jsonb_array_elements(coalesce(template_snapshot->'campos', '[]'::jsonb)) as defined(value)
    where defined.value->>'obligatorio' = 'true'
      and not (defined.value->>'clave' = any(canonical_keys))
  loop
    key_name := field_definition->>'clave';
    if field_values->key_name is null
       or field_values->key_name = 'null'::jsonb
       or (jsonb_typeof(field_values->key_name) = 'string' and btrim(field_values->>key_name) = '') then
      missing_fields := missing_fields || ('campo_personalizado_' || key_name);
    end if;
  end loop;

  return jsonb_build_object(
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;

revoke all on function public.api_validate_custom_certificate_fields(jsonb, jsonb)
  from public, anon, authenticated;

commit;

begin;

create table if not exists public.plantillas_certificado (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  estado text not null default 'borrador',
  campos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint plantillas_certificado_estado_check
    check (estado in ('borrador', 'activa', 'historica')),
  constraint plantillas_certificado_campos_array_check
    check (jsonb_typeof(campos) = 'array')
);

alter table public.plantillas_certificado enable row level security;

create unique index if not exists plantillas_certificado_one_active_idx
  on public.plantillas_certificado (estado)
  where estado = 'activa';

insert into public.plantillas_certificado(version, estado, campos)
values (
  'SYS_Certificado_Modelo1',
  'activa',
  jsonb_build_array(
    jsonb_build_object('clave', 'fecha_ejecucion', 'etiqueta', 'Fecha de ejecución', 'tipo', 'date', 'seccion', 'cabecera', 'orden', 10, 'obligatorio', true, 'opciones', '[]'::jsonb),
    jsonb_build_object('clave', 'tecnico_ejecutor', 'etiqueta', 'Ejecutó', 'tipo', 'text', 'seccion', 'ensayos', 'orden', 20, 'obligatorio', true, 'opciones', '[]'::jsonb),
    jsonb_build_object('clave', 'observaciones', 'etiqueta', 'Observaciones', 'tipo', 'textarea', 'seccion', 'observaciones', 'orden', 30, 'obligatorio', false, 'opciones', '[]'::jsonb)
  )
on conflict (version) do nothing;

-- Preserve any pre-existing template version names as historical metadata, then
-- bind every existing certificate to an immutable template snapshot.
insert into public.plantillas_certificado(version, estado, campos)
select distinct c.plantilla_version, 'historica', '[]'::jsonb
from public.certificados c
where not exists (
  select 1 from public.plantillas_certificado p where p.version = c.plantilla_version
);

alter table public.certificados
  add column if not exists plantilla_version_id uuid references public.plantillas_certificado(id),
  add column if not exists plantilla_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists campos_personalizados jsonb not null default '{}'::jsonb;

update public.certificados c
set plantilla_version_id = p.id,
    plantilla_snapshot = jsonb_build_object(
      'id', p.id,
      'version', p.version,
      'campos', p.campos
    )
from public.plantillas_certificado p
where p.version = c.plantilla_version
  and c.plantilla_version_id is null;

alter table public.certificados
  alter column plantilla_version_id set not null;

create or replace function public.prevent_certificate_template_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'check_violation', message = 'Certificate template versions are historical records and cannot be deleted';
  end if;

  if old.estado <> 'borrador'
     and (old.version is distinct from new.version
       or old.campos is distinct from new.campos) then
    raise exception using errcode = 'check_violation', message = 'Active and historical certificate templates are immutable; create a new version';
  end if;
  return new;
end;
$$;

drop trigger if exists plantillas_certificado_immutable on public.plantillas_certificado;
create trigger plantillas_certificado_immutable
before update or delete on public.plantillas_certificado
for each row execute function public.prevent_certificate_template_mutation();

create or replace function public.api_active_certificate_template()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result public.plantillas_certificado;
begin
  perform public.require_authenticated_cuenta();
  select * into result
  from public.plantillas_certificado
  where estado = 'activa';
  if result.id is null then
    raise exception using errcode = 'no_data_found', message = 'No active certificate template exists';
  end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_activate_certificate_template(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result public.plantillas_certificado;
begin
  perform public.api_require_admin();
  select * into result from public.plantillas_certificado where id = target for update;
  if result.id is null or result.estado <> 'borrador' then
    raise exception using errcode = 'check_violation', message = 'Only a draft certificate template can be activated';
  end if;

  update public.plantillas_certificado
  set estado = 'historica'
  where estado = 'activa';

  update public.plantillas_certificado
  set estado = 'activa', activated_at = now()
  where id = target
  returning * into result;

  return to_jsonb(result);
end;
$$;

create or replace function public.api_certificate_templates()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p)
  from public.plantillas_certificado p
  where public.api_actor_is_admin()
  order by case p.estado when 'activa' then 0 when 'borrador' then 1 else 2 end,
    p.created_at desc,
    p.version;
$$;

create or replace function public.api_create_certificate_template(
  template_version text,
  template_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.plantillas_certificado;
begin
  perform public.api_require_admin();
  if nullif(btrim(template_version), '') is null
     or jsonb_typeof(template_fields) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'A template version and field array are required';
  end if;
  perform public.validate_certificate_template_fields(template_fields);
  insert into public.plantillas_certificado(version, estado, campos)
  values (btrim(template_version), 'borrador', template_fields)
  returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_update_certificate_template(
  target uuid,
  template_version text,
  template_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.plantillas_certificado;
begin
  perform public.api_require_admin();
  if nullif(btrim(template_version), '') is null
     or jsonb_typeof(template_fields) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'A template version and field array are required';
  end if;
  perform public.validate_certificate_template_fields(template_fields);
  update public.plantillas_certificado
  set version = btrim(template_version), campos = template_fields
  where id = target and estado = 'borrador'
  returning * into result;
  if result.id is null then
    raise exception using errcode = 'check_violation', message = 'Only a draft certificate template can be edited';
  end if;
  return to_jsonb(result);
end;
$$;

revoke all on function public.api_active_certificate_template(), public.api_activate_certificate_template(uuid),
  public.api_certificate_templates(), public.api_create_certificate_template(text, jsonb),
  public.api_update_certificate_template(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.api_active_certificate_template() to authenticated, service_role;
grant execute on function public.api_activate_certificate_template(uuid), public.api_certificate_templates(),
  public.api_create_certificate_template(text, jsonb), public.api_update_certificate_template(uuid, text, jsonb)
  to service_role;

create or replace function public.validate_certificate_template_fields(template_fields jsonb)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  field_definition jsonb;
  option_definition jsonb;
begin
  if jsonb_typeof(template_fields) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Certificate template fields must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(template_fields) field_definition
    group by field_definition->>'clave'
    having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Certificate template field keys must be unique';
  end if;
  for field_definition in select value from jsonb_array_elements(template_fields) loop
    if jsonb_typeof(field_definition) is distinct from 'object'
       or nullif(btrim(field_definition->>'clave'), '') is null
       or nullif(btrim(field_definition->>'etiqueta'), '') is null
       or nullif(btrim(field_definition->>'seccion'), '') is null
       or field_definition->>'tipo' is null
       or field_definition->>'tipo' not in ('text', 'textarea', 'number', 'date', 'select', 'multiselect', 'boolean')
       or jsonb_typeof(field_definition->'orden') is distinct from 'number'
       or field_definition->>'orden' !~ '^[0-9]+$'
       or field_definition->>'obligatorio' is null
       or field_definition->>'obligatorio' not in ('true', 'false')
       or jsonb_typeof(field_definition->'opciones') is distinct from 'array' then
      raise exception using errcode = 'invalid_parameter_value', message = 'Invalid certificate template field definition';
    end if;
    for option_definition in select value from jsonb_array_elements(field_definition->'opciones') loop
      if jsonb_typeof(option_definition) is distinct from 'object'
         or nullif(btrim(option_definition->>'id'), '') is null
         or nullif(btrim(option_definition->>'label'), '') is null then
        raise exception using errcode = 'invalid_parameter_value', message = 'Invalid certificate template field option';
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.validate_certificate_template_fields(jsonb) from public, anon, authenticated;

-- The reference catalog is the initial active catalog. Administrators can
-- reorder or deactivate these values without changing any captured certificate.
insert into public.catalogo_opciones(lista, valor, orden)
select seed.lista, seed.valor, seed.orden
from (values
  ('unidad', 'Kg/Cm2', 0), ('unidad', 'psi', 1), ('unidad', 'BAR', 2),
  ('unidad', 'mmH2O', 3), ('unidad', 'Otro', 4),
  ('alcance', 'DESMONTAJE', 0), ('alcance', 'DESARME', 1), ('alcance', 'LIMPIEZA', 2),
  ('alcance', 'VERIFICAR INTERNOS', 3), ('alcance', 'RECTIF. ASIENTO', 4),
  ('alcance', 'RECTIF. OBTURADOR', 5), ('alcance', 'VERIFICAR O''RINGS', 6),
  ('alcance', 'PRUEBA SET', 7), ('alcance', 'CALIBRACION', 8), ('alcance', 'PINTADO', 9),
  ('alcance', 'PRECINTO/PLACA DATOS', 10),
  ('repuestos', 'KIT O''RING', 0), ('repuestos', 'JUNTAS INTERNO', 1), ('repuestos', 'ASIENTO', 2),
  ('repuestos', 'OBTURADOR', 3), ('repuestos', 'U''PACKING', 4), ('repuestos', 'RESORTE', 5),
  ('repuestos', 'BONETE', 6), ('repuestos', 'TUERCAS', 7), ('repuestos', 'ESPARRAGOS', 8),
  ('repuestos', 'JUNTAS PROCESO', 9)) as seed(lista, valor, orden)
where not exists (
  select 1 from public.catalogo_opciones current
  where current.lista = seed.lista and current.valor = seed.valor
);

insert into public.patrones_ensayo(nombre, nro_serie, vencimiento)
values
  ('KELLER LEO 1', '122330', (current_date + interval '1 year')::date),
  ('KELLER LEO 2', '116474', (current_date + interval '1 year')::date),
  ('KELLER LEO 2', '140286', (current_date + interval '1 year')::date),
  ('KELLER LEO 2', '140287', (current_date + interval '1 year')::date),
  ('WIKA', '1A03L5X9T33', (current_date + interval '1 year')::date),
  ('WIKA', '1A03L5XAS33', (current_date + interval '1 year')::date),
  ('FLUKE 717', '300G', (current_date + interval '1 year')::date),
  ('KELLER DRUCK', '22443', (current_date + interval '1 year')::date),
  ('WIKA', '1A03ALKI5IH', (current_date + interval '1 year')::date)
on conflict (nombre, nro_serie) do nothing;

create or replace function public.api_certificate_capture_catalogs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_authenticated_cuenta();
  return (select jsonb_build_object(
    'template', (select to_jsonb(p) from public.plantillas_certificado p where p.estado = 'activa'),
    'maintenance', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'alcance' and o.activo), '[]'::jsonb),
    'replacement_parts', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'repuestos' and o.activo), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.valor) order by o.orden, o.valor)
      from public.catalogo_opciones o where o.lista = 'unidad' and o.activo), '[]'::jsonb),
    'standards', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.nombre || ' · ' || p.nro_serie, 'nro_serie', p.nro_serie, 'vencimiento', p.vencimiento) order by p.nombre, p.nro_serie)
      from public.patrones_ensayo p where p.activo), '[]'::jsonb)
  ));
end;
$$;

revoke all on function public.api_certificate_capture_catalogs() from public, anon, authenticated;
grant execute on function public.api_certificate_capture_catalogs() to authenticated, service_role;

-- The certificate table already stores the template version and the
-- replacement catalog version. This migration makes the JSON contract explicit
-- for both maintenance and replacement options while continuing to accept
-- legacy string values from drafts created before the structured contract.
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
    missing_fields := missing_fields || 'fecha_ejecucion';
  elsif jsonb_typeof(payload->'fecha_ejecucion') <> 'string'
     or payload->>'fecha_ejecucion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or to_char(to_date(payload->>'fecha_ejecucion', 'YYYY-MM-DD'), 'YYYY-MM-DD')
          is distinct from payload->>'fecha_ejecucion' then
    invalid_fields := invalid_fields || 'fecha_ejecucion';
  end if;

  if payload->'tecnico_ejecutor' is null
     or payload->>'tecnico_ejecutor' is null
     or btrim(payload->>'tecnico_ejecutor') = '' then
    missing_fields := missing_fields || 'tecnico_ejecutor';
  elsif jsonb_typeof(payload->'tecnico_ejecutor') <> 'string' then
    invalid_fields := invalid_fields || 'tecnico_ejecutor';
  end if;

  if payload->'datos_tecnicos' is null
     or jsonb_typeof(payload->'datos_tecnicos') <> 'object' then
    invalid_fields := invalid_fields || 'datos_tecnicos';
  elsif payload->'datos_tecnicos' = '{}'::jsonb then
    missing_fields := missing_fields || 'datos_tecnicos';
  end if;

  if payload ? 'campos_personalizados'
     and (payload->'campos_personalizados' is null
       or jsonb_typeof(payload->'campos_personalizados') <> 'object') then
    invalid_fields := invalid_fields || 'campos_personalizados';
  end if;

  if payload->'alcance_mantenimiento' is null
     or jsonb_typeof(payload->'alcance_mantenimiento') <> 'array' then
    invalid_fields := invalid_fields || 'alcance_mantenimiento';
  else
    for item in select value from jsonb_array_elements(payload->'alcance_mantenimiento') loop
      if jsonb_typeof(item) = 'string' then
        if btrim(item #>> '{}') = '' then
          invalid_fields := invalid_fields || 'alcance_mantenimiento';
          exit;
        end if;
      elsif jsonb_typeof(item) <> 'object'
         or (select count(*) from jsonb_object_keys(item)) <> 2
         or not (item ?& array['id', 'label'])
         or jsonb_typeof(item->'id') <> 'string'
         or btrim(item->>'id') = ''
         or jsonb_typeof(item->'label') <> 'string'
         or btrim(item->>'label') = '' then
        invalid_fields := invalid_fields || 'alcance_mantenimiento';
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
    invalid_fields := invalid_fields || 'repuestos';
  else
    for item in select value from jsonb_array_elements(payload->'repuestos'->'items') loop
      if jsonb_typeof(item) = 'string' then
        if btrim(item #>> '{}') = '' then
          invalid_fields := invalid_fields || 'repuestos';
          exit;
        end if;
      elsif jsonb_typeof(item) <> 'object'
         or (select count(*) from jsonb_object_keys(item)) <> 2
         or not (item ?& array['id', 'label'])
         or jsonb_typeof(item->'id') <> 'string'
         or btrim(item->>'id') = ''
         or jsonb_typeof(item->'label') <> 'string'
         or btrim(item->>'label') = '' then
        invalid_fields := invalid_fields || 'repuestos';
        exit;
      end if;
    end loop;
  end if;

  if payload->'evidencia_fotografica' is null
     or jsonb_typeof(payload->'evidencia_fotografica') <> 'object'
     or not (payload->'evidencia_fotografica' ?& evidence_keys) then
    invalid_fields := invalid_fields || 'evidencia_fotografica';
  else
    for item in select value from jsonb_each(payload->'evidencia_fotografica') loop
      if jsonb_typeof(item) not in ('null', 'object') then
        invalid_fields := invalid_fields || 'evidencia_fotografica';
        exit;
      end if;
    end loop;
  end if;

  if payload ? 'observaciones'
     and payload->'observaciones' is not null
     and jsonb_typeof(payload->'observaciones') <> 'null'
     and jsonb_typeof(payload->'observaciones') <> 'string' then
    invalid_fields := invalid_fields || 'observaciones';
  end if;

  return jsonb_build_object(
    'complete', cardinality(missing_fields) = 0 and cardinality(invalid_fields) = 0,
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;

create or replace function public.api_validate_custom_certificate_fields(
  template_snapshot jsonb,
  values jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing_fields text[] := '{}';
  invalid_fields text[] := '{}';
  field_definition jsonb;
  key_name text;
begin
  if values is null or jsonb_typeof(values) <> 'object' then
    return jsonb_build_object(
      'missing_fields', jsonb_build_array(),
      'invalid_fields', jsonb_build_array('campos_personalizados')
    );
  end if;

  for key_name in select jsonb_object_keys(values) loop
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(template_snapshot->'campos', '[]'::jsonb)) field_definition
      where field_definition->>'clave' = key_name
    ) then
      invalid_fields := invalid_fields || ('campo_personalizado_no_definido_' || key_name);
    end if;
  end loop;

  for field_definition in
    select value
    from jsonb_array_elements(coalesce(template_snapshot->'campos', '[]'::jsonb)) value
    where value->>'obligatorio' = 'true'
  loop
    key_name := field_definition->>'clave';
    if values->key_name is null
       or values->key_name = 'null'::jsonb
       or (jsonb_typeof(values->key_name) = 'string' and btrim(values->>key_name) = '') then
      missing_fields := missing_fields || ('campo_personalizado_' || key_name);
    end if;
  end loop;

  return jsonb_build_object(
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;

revoke all on function public.api_validate_custom_certificate_fields(jsonb, jsonb) from public, anon, authenticated;

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
  missing_fields := array(select jsonb_array_elements_text(custom_result->'missing_fields'));
  invalid_fields := array(select jsonb_array_elements_text(custom_result->'invalid_fields'));

  if c.tecnico_ejecutor is not null
     and btrim(c.tecnico_ejecutor) <> ''
     and not public.api_technician_name_is_member(c.visita_id, c.tecnico_ejecutor) then
    invalid_fields := invalid_fields || 'tecnico_ejecutor_no_asignado';
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

-- Keep the update seam aligned with the canonical validator. The existing
-- function already rejects unknown patch keys and preserves closed rows; this
-- replacement additionally rejects any invalid canonical section before write.
create or replace function public.api_update_certificate_draft(certificate_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  v public.visitas_servicio;
  next_payload jsonb;
  validation jsonb;
  custom_validation jsonb;
  key_name text;
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Certificate payload must be an object';
  end if;

  for key_name in select jsonb_object_keys(payload) loop
    if key_name not in (
      'fecha_ejecucion', 'tecnico_ejecutor', 'datos_tecnicos',
      'campos_personalizados', 'alcance_mantenimiento', 'repuestos',
      'evidencia_fotografica', 'observaciones'
    ) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Unsupported certificate field: ' || key_name;
    end if;
  end loop;

  select * into c from public.certificados where id = certificate_id for update;
  if c.id is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
  select * into v from public.visitas_servicio where id = c.visita_id;
  if v.estado <> 'en_curso' or c.estado_captura <> 'abierto' or c.estado <> 'borrador' then
    raise exception using errcode = 'check_violation', message = 'Certificate capture is closed';
  end if;

  if payload ? 'fecha_ejecucion' and payload->'fecha_ejecucion' is not null
     and (jsonb_typeof(payload->'fecha_ejecucion') <> 'string'
          or payload->>'fecha_ejecucion' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or to_char(to_date(payload->>'fecha_ejecucion', 'YYYY-MM-DD'), 'YYYY-MM-DD')
               is distinct from payload->>'fecha_ejecucion') then
    raise exception using errcode = 'invalid_parameter_value', message = 'fecha_ejecucion must be a valid YYYY-MM-DD date';
  end if;
  if payload ? 'tecnico_ejecutor' and payload->'tecnico_ejecutor' is not null
     and (jsonb_typeof(payload->'tecnico_ejecutor') <> 'string'
          or btrim(payload->>'tecnico_ejecutor') = '') then
    raise exception using errcode = 'invalid_parameter_value', message = 'tecnico_ejecutor must be a non-empty string';
  end if;
  if payload ? 'tecnico_ejecutor' and payload->'tecnico_ejecutor' is not null
     and not public.api_technician_name_is_member(c.visita_id, payload->>'tecnico_ejecutor') then
    raise exception using errcode = 'insufficient_privilege', message = 'The Técnico is not assigned to the visit Taller Móvil';
  end if;

  next_payload := jsonb_build_object(
    'fecha_ejecucion', case when payload ? 'fecha_ejecucion' then payload->'fecha_ejecucion' else to_jsonb(c.fecha_ejecucion) end,
    'tecnico_ejecutor', case when payload ? 'tecnico_ejecutor' then payload->'tecnico_ejecutor' else to_jsonb(c.tecnico_ejecutor) end,
    'datos_tecnicos', case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else c.datos_tecnicos end,
    'campos_personalizados', case when payload ? 'campos_personalizados' then payload->'campos_personalizados' else c.campos_personalizados end,
    'alcance_mantenimiento', case when payload ? 'alcance_mantenimiento' then payload->'alcance_mantenimiento' else c.alcance_mantenimiento end,
    'repuestos', case when payload ? 'repuestos' then payload->'repuestos' else c.repuestos end,
    'evidencia_fotografica', case when payload ? 'evidencia_fotografica' then payload->'evidencia_fotografica' else c.evidencia_fotografica end,
    'observaciones', case when payload ? 'observaciones' then payload->'observaciones' else to_jsonb(c.observaciones) end
  );
  validation := public.api_validate_certificate_payload(next_payload);
  custom_validation := public.api_validate_custom_certificate_fields(
    c.plantilla_snapshot,
    next_payload->'campos_personalizados'
  );
  if jsonb_array_length(validation->'invalid_fields') > 0
     or jsonb_array_length(custom_validation->'invalid_fields') > 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid canonical certificate fields: ' || ((validation->'invalid_fields') || (custom_validation->'invalid_fields'))::text;
  end if;

  update public.certificados set
    fecha_ejecucion = case when payload ? 'fecha_ejecucion' then (payload->>'fecha_ejecucion')::date else fecha_ejecucion end,
    tecnico_ejecutor = case when payload ? 'tecnico_ejecutor' then nullif(btrim(payload->>'tecnico_ejecutor'), '') else tecnico_ejecutor end,
    datos_tecnicos = case when payload ? 'datos_tecnicos' then payload->'datos_tecnicos' else datos_tecnicos end,
    campos_personalizados = case when payload ? 'campos_personalizados' then payload->'campos_personalizados' else campos_personalizados end,
    alcance_mantenimiento = case when payload ? 'alcance_mantenimiento' then payload->'alcance_mantenimiento' else alcance_mantenimiento end,
    repuestos = case when payload ? 'repuestos' then payload->'repuestos' else repuestos end,
    evidencia_fotografica = case when payload ? 'evidencia_fotografica' then payload->'evidencia_fotografica' else evidencia_fotografica end,
    observaciones = case when payload ? 'observaciones' then payload->>'observaciones' else observaciones end,
    updated_at = now()
  where id = certificate_id
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.api_start_certificate_draft(
  work_order_id uuid,
  target_certificate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.ordenes_trabajo;
  v public.visitas_servicio;
  y public.yacimientos;
  p public.plantas_locaciones;
  e public.equipos_unidades;
  x public.valvulas;
  template_row public.plantillas_certificado;
  revision uuid;
  c public.certificados;
  context_snapshot jsonb;
  template_snapshot jsonb;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null or o.estado <> 'evaluada' then
    raise exception using errcode = 'check_violation', message = 'Only an evaluated work order can create a certificate draft';
  end if;

  select * into v from public.api_assigned_visit(o.visita_id);
  if v.estado <> 'en_curso' then
    raise exception using errcode = 'check_violation', message = 'Certificate drafts can be started only while the visit is in progress';
  end if;

  select * into c from public.certificados where orden_trabajo_id = o.id for update;
  if c.id is not null then
    return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
  end if;

  select * into template_row
  from public.plantillas_certificado
  where estado = 'activa'
  for share;
  if template_row.id is null then
    raise exception using errcode = 'check_violation', message = 'No active certificate template exists';
  end if;

  select * into x from public.valvulas where id = o.valvula_id;
  select * into e from public.equipos_unidades where id = x.equipo_id;
  select * into p from public.plantas_locaciones where id = e.planta_id;
  select * into y from public.yacimientos where id = p.yacimiento_id;
  if x.id is null then
    raise exception using errcode = 'no_data_found', message = 'Válvula not found';
  end if;

  context_snapshot := jsonb_build_object(
    'yacimiento', to_jsonb(y),
    'planta', to_jsonb(p),
    'equipo', to_jsonb(e),
    'valvula', to_jsonb(x)
  );
  template_snapshot := jsonb_build_object(
    'id', template_row.id,
    'version', template_row.version,
    'campos', template_row.campos
  );

  insert into public.valvula_revisiones(valvula_id, datos)
  values (x.id, to_jsonb(x))
  returning id into revision;

  insert into public.certificados(
    id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id,
    equipo_id, valvula_revision_id, contexto_captura, plantilla_version,
    plantilla_version_id, plantilla_snapshot
  )
  values (
    coalesce(target_certificate_id, gen_random_uuid()), o.id, o.visita_id, x.id,
    y.id, p.id, e.id, revision, context_snapshot, template_row.version,
    template_row.id, template_snapshot
  )
  returning * into c;

  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.prevent_closed_certificate_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.estado_captura = 'cerrado' then
    if old.estado = 'pendiente'
       and new.estado = 'finalizado'
       and old.orden_trabajo_id = new.orden_trabajo_id
       and old.visita_id = new.visita_id
       and old.valvula_id = new.valvula_id
       and old.yacimiento_id = new.yacimiento_id
       and old.planta_id = new.planta_id
       and old.equipo_id = new.equipo_id
       and old.valvula_revision_id = new.valvula_revision_id
       and old.fecha_ejecucion is not distinct from new.fecha_ejecucion
       and old.tecnico_ejecutor is not distinct from new.tecnico_ejecutor
       and old.datos_tecnicos is not distinct from new.datos_tecnicos
       and old.campos_personalizados is not distinct from new.campos_personalizados
       and old.alcance_mantenimiento is not distinct from new.alcance_mantenimiento
       and old.repuestos is not distinct from new.repuestos
       and old.evidencia_fotografica is not distinct from new.evidencia_fotografica
       and old.observaciones is not distinct from new.observaciones
       and old.contexto_captura is not distinct from new.contexto_captura
       and old.reemplaza_certificado_id is not distinct from new.reemplaza_certificado_id
       and old.plantilla_version is not distinct from new.plantilla_version
       and old.plantilla_version_id is not distinct from new.plantilla_version_id
       and old.plantilla_snapshot is not distinct from new.plantilla_snapshot then
      return new;
    end if;
    raise exception using errcode = 'check_violation', message = 'Closed certificate data is immutable; create a replacement certificate';
  end if;
  return new;
end;
$$;

drop trigger if exists certificados_closed_immutable on public.certificados;
create trigger certificados_closed_immutable
before update on public.certificados
for each row execute function public.prevent_closed_certificate_mutation();

-- Cache the capture schema and active catalog values with the field-work
-- working set so the same certificate form remains usable without a network.
create or replace function public.api_offline_working_set()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select taller_movil_id into provider
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = '42501', message = 'Only a Taller Móvil can use the offline working set';
  end if;

  return jsonb_build_object(
    'certificate_catalogs', public.api_certificate_capture_catalogs(),
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'visit', to_jsonb(v) || jsonb_build_object('sync_version', v.sync_version),
          'work_orders', coalesce((
            select jsonb_agg(
              to_jsonb(ot) || jsonb_build_object('sync_version', ot.sync_version)
              order by ot.created_at, ot.id
            )
            from public.ordenes_trabajo ot
            where ot.visita_id = v.id
          ), '[]'::jsonb),
          'context', public.api_yacimiento_tree(v.yacimiento_id),
          'assigned_technicians', coalesce((
            select jsonb_agg(to_jsonb(person) order by person.nombre, person.apellido)
            from public.personas person
            where person.id = any(coalesce((
              select staffing.persona_ids
              from public.nominas_jornada staffing
              where staffing.taller_movil_id = v.taller_movil_id
                and staffing.fecha = v.starts_at::date
              limit 1
            ), '{}'::uuid[]))
          ), '[]'::jsonb),
          'claim', (
            select jsonb_build_object(
              'device_id', claim.device_id,
              'claimed_at', claim.claimed_at,
              'last_seen_at', claim.last_seen_at
            )
            from public.dispositivos_visita claim
            where claim.visita_id = v.id
          )
        ) order by v.starts_at, v.id
      )
      from public.visitas_servicio v
      where v.taller_movil_id = provider
        and (
          v.estado = 'en_curso'
          or (v.estado = 'aceptada' and v.starts_at >= now() and v.starts_at < now() + interval '2 days')
        )
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.api_offline_working_set() to service_role, authenticated;

commit;

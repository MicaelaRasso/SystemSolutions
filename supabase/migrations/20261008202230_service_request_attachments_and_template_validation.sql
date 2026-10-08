begin;

-- Keep request files private and limit uploads to the formats and size accepted
-- by the administrative form.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 10485760,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Update only the administrative request metadata fields. Every stored file
-- reference must point at an object the Edge gateway uploaded to our private
-- attachments bucket.
create or replace function public.api_update_admin_service_request_metadata(
  request_id uuid,
  operation_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.solicitudes_servicio;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid()
      and rol in ('administrador_regular', 'super_administrador')
      and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can edit request metadata';
  end if;

  if jsonb_typeof(operation_metadata) is distinct from 'object' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Request metadata must be an object';
  end if;

  if operation_metadata ? 'adjuntos' and (
    jsonb_typeof(operation_metadata->'adjuntos') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(operation_metadata->'adjuntos') as attachment(value)
      where jsonb_typeof(attachment.value) is distinct from 'object'
        or attachment.value->>'bucket' is distinct from 'attachments'
        or coalesce(attachment.value->>'object_path', '') not like 'temporary/%'
        or nullif(attachment.value->>'nombre', '') is null
        or nullif(attachment.value->>'tipo', '') is null
        or not exists (
          select 1 from storage.objects object_row
          where object_row.bucket_id = 'attachments'
            and object_row.name = attachment.value->>'object_path'
        )
    )
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid request attachment reference';
  end if;

  update public.solicitudes_servicio
  set metadata = coalesce(metadata, '{}'::jsonb) || operation_metadata,
      updated_at = now()
  where id = request_id
  returning * into request_row;

  if request_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Service request not found';
  end if;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', request_row.yacimiento_id, request_row.id, auth.uid(),
    jsonb_build_object(
      'event', 'request_metadata_updated',
      'attachment_count', case
        when jsonb_typeof(operation_metadata->'adjuntos') = 'array'
          then jsonb_array_length(operation_metadata->'adjuntos')
        else 0
      end
    )
  );

  return public.api_service_request(request_row.id);
end;
$$;

revoke all on function public.api_update_admin_service_request_metadata(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_update_admin_service_request_metadata(uuid, jsonb)
  to service_role;

-- A Taller Móvil receives attachment references only for a visit currently
-- assigned to one of its accounts. The Edge Function signs the references.
create or replace function public.api_visit_request_attachments(visit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
  account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id;
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  select rol into account_role from public.cuentas where id = auth.uid() and activo;
  if account_role not in ('administrador_regular', 'super_administrador')
     and not (
       account_role = 'taller_movil'
       and exists (
         select 1 from public.taller_cuentas
         where cuenta_id = auth.uid()
           and taller_movil_id = visit_row.taller_movil_id
       )
     ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized to access visit attachments';
  end if;
  return coalesce((
    select s.metadata->'adjuntos'
    from public.solicitudes_servicio s
    where s.id = visit_row.solicitud_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.api_visit_request_attachments(uuid) from public, anon, authenticated;
grant execute on function public.api_visit_request_attachments(uuid) to service_role;

-- Rename the set-returning-function alias so it cannot collide with the
-- validator's PL/pgSQL variable of the same name.
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
    from jsonb_array_elements(template_fields) as field_item(value)
    group by field_item.value->>'clave'
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

commit;

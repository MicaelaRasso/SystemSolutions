begin;

-- Visit completion is the point where certificate capture closes.  Check the
-- whole visit first so no incomplete certificate can become immutable, and so
-- an unevaluated work order never produces a certificate.
create or replace function public.api_complete_visit(visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  visit_row public.visitas_servicio;
begin
  select * into visit_row from public.api_assigned_visit(visit_id);
  if visit_row.estado <> 'en_curso' then
    raise exception using errcode = 'check_violation', message = 'Only an in-progress visit can be completed';
  end if;

  -- Serialize against an in-flight draft edit before validating its final
  -- contents. The editor locks the certificate row and does not lock the visit.
  perform 1
  from public.certificados certificate
  where certificate.visita_id = visit_id
  order by certificate.id
  for update;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    where work_order.visita_id = visit_id
      and work_order.estado = 'pendiente'
  ) then
    raise exception using errcode = 'check_violation', message = 'Every work order must have an explicit outcome before visit completion';
  end if;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    left join public.certificados certificate
      on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = visit_id
      and work_order.estado = 'evaluada'
      and certificate.id is null
  ) then
    raise exception using errcode = 'check_violation', message = 'Every evaluated work order requires a complete certificate before visit completion';
  end if;

  if exists (
    select 1
    from public.ordenes_trabajo work_order
    join public.certificados certificate
      on certificate.orden_trabajo_id = work_order.id
    where work_order.visita_id = visit_id
      and work_order.estado = 'no_evaluada'
  ) then
    raise exception using errcode = 'check_violation', message = 'An unevaluated work order cannot have a certificate';
  end if;

  if exists (
    select 1
    from public.certificados certificate
    where certificate.visita_id = visit_id
      and not coalesce((public.api_certificate_validation(certificate)->>'complete')::boolean, false)
  ) then
    raise exception using errcode = 'check_violation', message = 'Every evaluated work order requires a complete certificate before visit completion';
  end if;

  if not exists (
    select 1
    from public.firmas_visita signature
    where signature.visita_id = visit_id
      and signature.parte = 'tecnico'
  ) then
    raise exception using errcode = 'check_violation', message = 'A Técnico signature is required to complete a visit';
  end if;

  update public.visitas_servicio
  set estado = 'completada', updated_at = now()
  where id = visit_id;

  -- Each evaluated work order has exactly one editable draft.  A complete
  -- draft becomes pending when Cliente signature is not yet available.
  update public.certificados
  set estado_captura = 'cerrado', estado = 'pendiente', updated_at = now()
  where visita_id = visit_id
    and estado_captura = 'abierto';

  delete from public.visita_equipos where visita_id = visit_id;
  perform public.api_finalize_visit_certificates(visit_id);
  return public.api_visit(visit_id);
end;
$$;

-- Draft edits and completion acquire the same locks in the same order:
-- Visita de servicio, then Certificado. Completion also locks each certificate
-- before validating it, which prevents an edit from slipping between the gate
-- and the close operation.
create or replace function public.api_update_certificate_draft(certificate_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  v public.visitas_servicio;
  target_visit uuid;
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

  select visita_id into target_visit
  from public.certificados
  where id = certificate_id;
  if target_visit is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
  select * into v from public.api_assigned_visit(target_visit);
  select * into c
  from public.certificados
  where id = certificate_id
  for update;
  if c.id is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate draft not found';
  end if;
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

commit;

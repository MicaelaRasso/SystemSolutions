begin;

-- The partial unique index prevents two active versions. This deferred check
-- also prevents a transaction from leaving the system with none.
create or replace function public.require_one_active_certificate_template()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.plantillas_certificado where estado = 'activa') <> 1 then
    raise exception using errcode = 'check_violation',
      message = 'Exactly one certificate template version must be active';
  end if;
  return null;
end;
$$;

create constraint trigger plantillas_certificado_exactly_one_active
after insert or update or delete on public.plantillas_certificado
deferrable initially deferred
for each row execute function public.require_one_active_certificate_template();

revoke all on function public.require_one_active_certificate_template() from public, anon, authenticated, service_role;

-- A draft can be saved incrementally, but it is not complete until every test
-- has a numeric result and a unit, and the reference pattern is identified.
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
    missing_fields := missing_fields || 'ensayos.patron';
  elsif jsonb_typeof(result) = 'string' then
    if btrim(result #>> '{}') = '' then
      invalid_fields := invalid_fields || 'ensayos.patron';
    end if;
  elsif jsonb_typeof(result) is distinct from 'object'
     or jsonb_typeof(result->'id') is distinct from 'string'
     or btrim(result->>'id') = ''
     or jsonb_typeof(result->'label') is distinct from 'string'
     or btrim(result->>'label') = '' then
    invalid_fields := invalid_fields || 'ensayos.patron';
  end if;

  return jsonb_build_object(
    'missing_fields', to_jsonb(missing_fields),
    'invalid_fields', to_jsonb(invalid_fields)
  );
end;
$$;

revoke all on function public.api_certificate_test_validation(jsonb) from public, anon, authenticated;
grant execute on function public.api_certificate_test_validation(jsonb) to service_role;

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

-- Include the current draft in the working set so reconnecting online once is
-- sufficient to resume that draft, its template snapshot, and its data offline.
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
              to_jsonb(ot) || jsonb_build_object(
                'sync_version', ot.sync_version,
                'certificate_id', c.id,
                'certificate', to_jsonb(c)
              ) order by ot.created_at, ot.id
            )
            from public.ordenes_trabajo ot
            left join public.certificados c on c.orden_trabajo_id = ot.id
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

revoke all on function public.api_offline_working_set() from public, anon, authenticated;
grant execute on function public.api_offline_working_set() to service_role;

commit;

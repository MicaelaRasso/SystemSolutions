begin;

-- D10: el certificado mostraba vacíos la orden de trabajo de la tarea y la nómina de la jornada.
-- La orden de trabajo vive en la metadata de la Solicitud de servicio y la nómina en
-- `nominas_jornada`; ninguna llegaba en la lectura del certificado finalizado.
--
-- La nómina se resuelve con la misma regla que la validación de la firma del Técnico
-- (`api_technician_name_is_member`): taller de la visita y fecha `starts_at::date`.
create or replace function public.certificate_visit_work_details(target_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orden_trabajo', nullif(btrim(s.metadata->>'orden_trabajo'), ''),
    'nomina', (
      select string_agg(btrim(p.nombre || ' ' || p.apellido), ', ' order by p.apellido, p.nombre)
      from public.nominas_jornada n
      cross join lateral unnest(coalesce(n.persona_ids, '{}'::uuid[])) selected(persona_id)
      join public.personas p on p.id = selected.persona_id
      where n.taller_movil_id = v.taller_movil_id
        and n.fecha = v.starts_at::date
    )
  )
  from public.visitas_servicio v
  join public.solicitudes_servicio s on s.id = v.solicitud_id
  where v.id = target_visit;
$$;

revoke all on function public.certificate_visit_work_details(uuid) from public, anon, authenticated;

-- Base: la definición de 20261102010000 (Parte Diario); solo se agregan `orden_trabajo` y `nomina`
-- al objeto `certificate`.
create or replace function public.api_finalized_certificate(certificate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.certificados;
  pd_codigo text;
begin
  select * into c from public.certificados where id = certificate_id;
  if c.id is null or c.estado <> 'finalizado'
     or not exists (select 1 from public.firmas_visita where visita_id = c.visita_id and parte = 'tecnico')
     or not exists (select 1 from public.firmas_visita where visita_id = c.visita_id and parte = 'cliente') then
    raise exception using errcode = 'no_data_found', message = 'Finalized certificate with required signatures not found';
  end if;
  perform public.require_yacimiento_access(c.yacimiento_id);

  select pd.codigo into pd_codigo
  from public.partes_diarios pd
  where pd.visita_id = c.visita_id;

  return jsonb_build_object(
    'certificate', to_jsonb(c)
      || jsonb_build_object('pd', pd_codigo)
      || coalesce(public.certificate_visit_work_details(c.visita_id), '{}'::jsonb),
    'context', jsonb_build_object(
      'yacimiento', coalesce(c.instantanea, c.contexto_captura)->'yacimiento',
      'planta', coalesce(c.instantanea, c.contexto_captura)->'planta',
      'equipo', coalesce(c.instantanea, c.contexto_captura)->'equipo',
      'valvula', coalesce(c.instantanea, c.contexto_captura)->'valvula'
    ),
    'snapshot', coalesce(c.instantanea, c.contexto_captura),
    'validity', jsonb_build_object(
      'execution_date', c.fecha_ejecucion,
      'valid_until', c.vigencia_hasta,
      'is_valid', c.vigencia_hasta is not null and current_date <= c.vigencia_hasta
    ),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'parte', f.parte,
        'nombre_firmante', f.nombre_firmante,
        'capture_method', f.capture_method,
        'captured_at', f.captured_at,
        'image', jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path)
      ) order by f.parte)
      from public.firmas_visita f
      join public.imagenes_certificado i on i.id = f.imagen_id
      where f.visita_id = c.visita_id
    ), '[]'::jsonb),
    'images', public.api_certificate_asset_refs(c.id),
    'client_logo', coalesce(c.instantanea, c.contexto_captura)->'client_logo'
  );
end;
$$;

commit;

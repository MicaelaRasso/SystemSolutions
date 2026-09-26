begin;

-- A generation row is metadata only. The ZIP is deliberately never written to
-- application storage, so a failed or abandoned download has no archive to
-- clean up.
create table if not exists public.registros_generacion_backup (
  id uuid primary key default gen_random_uuid(),
  actor_cuenta_id uuid not null references public.cuentas(id),
  scope text not null check (scope in ('complete', 'date_range')),
  from_date date,
  to_date date,
  business_timezone text not null default 'America/Argentina/Buenos_Aires',
  requested_at timestamptz not null default now(),
  snapshot_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'success', 'warning', 'failure')),
  record_count integer not null default 0,
  media_count integer not null default 0,
  archive_size_bytes bigint,
  archive_sha256 text,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  check ((scope = 'complete' and from_date is null and to_date is null) or
         (scope = 'date_range' and from_date is not null and to_date is not null and from_date <= to_date))
);

create index if not exists registros_generacion_backup_requested_idx
  on public.registros_generacion_backup(requested_at desc);
alter table public.registros_generacion_backup enable row level security;

create or replace function public.api_backup_require_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.cuentas
    where id = auth.uid()
      and rol = 'super_administrador'
      and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Súper Administrador can generate a Backup manual';
  end if;
end;
$$;

create or replace function public.api_prepare_backup_export(
  export_scope text,
  from_date date default null,
  to_date date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
declare
  generation public.registros_generacion_backup;
  snapshot_time timestamptz := statement_timestamp();
  lower_bound timestamptz;
  upper_bound timestamptz;
  records jsonb;
  media jsonb;
begin
  perform public.api_backup_require_super_admin();
  if export_scope not in ('complete', 'date_range') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Backup scope must be complete or date_range';
  end if;
  if export_scope = 'complete' and (from_date is not null or to_date is not null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'A complete backup cannot have date boundaries';
  end if;
  if export_scope = 'date_range' and (from_date is null or to_date is null or from_date > to_date) then
    raise exception using errcode = 'invalid_parameter_value', message = 'A date-range backup requires inclusive valid boundaries';
  end if;

  if export_scope = 'date_range' then
    lower_bound := from_date::timestamp at time zone 'America/Argentina/Buenos_Aires';
    upper_bound := (to_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  end if;

  insert into public.registros_generacion_backup(actor_cuenta_id, scope, from_date, to_date, snapshot_at)
  values (auth.uid(), export_scope, from_date, to_date, snapshot_time)
  returning * into generation;

  if export_scope = 'complete' then
    select jsonb_build_object(
      'cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cuentas row),
      'clientes', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.clientes row),
      'cliente_cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cliente_cuentas row),
      'cliente_accesos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cliente_accesos row),
      'talleres_moviles', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.talleres_moviles row),
      'taller_cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.taller_cuentas row),
      'personas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.personas row),
      'nominas_jornada', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.nominas_jornada row),
      'catalogo_opciones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.catalogo_opciones row),
      'patrones_ensayo', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.patrones_ensayo row),
      'yacimientos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.yacimientos row),
      'plantas_locaciones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.plantas_locaciones row),
      'equipos_unidades', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.equipos_unidades row),
      'valvulas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.valvulas row),
      'valvula_revisiones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.valvula_revisiones row),
      'historial_relaciones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.historial_relaciones row),
      'solicitudes_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.solicitudes_servicio row),
      'solicitud_valvulas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.solicitud_valvulas row),
      'asignaciones_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.asignaciones_servicio row),
      'visitas_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visitas_servicio row),
      'ordenes_trabajo', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.ordenes_trabajo row),
      'visita_equipos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visita_equipos row),
      'certificados', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.certificados row),
      'certificado_imagenes', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.certificado_imagenes row),
      'imagenes_certificado', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.imagenes_certificado row),
      'firmas_visita', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.firmas_visita row),
      'contador_certificados', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.contador_certificados row),
      'dispositivos_visita', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.dispositivos_visita row),
      'operaciones_sync', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.operaciones_sync row),
      'conflictos_sync', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.conflictos_sync row),
      'visitas_sync_ack', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visitas_sync_ack row),
      'registros_generacion_backup', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.registros_generacion_backup row)
    ) into records;

    select coalesce(jsonb_agg(to_jsonb(ref)), '[]'::jsonb) into media
    from (
      select i.id, 'certificate_image'::text as tipo, i.bucket, i.object_path, i.categoria,
        case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else null end as expected_size,
        o.updated_at as expected_updated_at
      from public.imagenes_certificado i
      left join storage.objects o on o.bucket_id = i.bucket and o.name = i.object_path
      union all
      select c.cuenta_id, 'client_logo'::text, c.logo_bucket, c.logo_path, 'logo',
        case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else null end,
        o.updated_at
      from public.clientes c
      left join storage.objects o on o.bucket_id = c.logo_bucket and o.name = c.logo_path
      where c.logo_bucket is not null and c.logo_path is not null
    ) ref;
  else
    with
      selected_visits as (
        select v.id
        from public.visitas_servicio v
        where v.created_at >= lower_bound and v.created_at < upper_bound
           or v.updated_at >= lower_bound and v.updated_at < upper_bound
           or v.starts_at >= lower_bound and v.starts_at < upper_bound
           or v.ends_at > lower_bound and v.ends_at < upper_bound
           or v.accepted_at >= lower_bound and v.accepted_at < upper_bound
           or v.rejected_at >= lower_bound and v.rejected_at < upper_bound
           or v.cancelled_at >= lower_bound and v.cancelled_at < upper_bound
           or exists (select 1 from public.historial_relaciones h where h.relacion_id = v.id and h.created_at >= lower_bound and h.created_at < upper_bound)
      ),
      selected_requests as (
        select s.id
        from public.solicitudes_servicio s
        where s.created_at >= lower_bound and s.created_at < upper_bound
           or s.updated_at >= lower_bound and s.updated_at < upper_bound
           or s.accepted_at >= lower_bound and s.accepted_at < upper_bound
           or exists (select 1 from public.solicitud_valvulas sv where sv.solicitud_id = s.id and sv.selected_at >= lower_bound and sv.selected_at < upper_bound)
           or exists (
             select 1
             from public.visitas_servicio v
             join selected_visits sv on sv.id = v.id
             where v.solicitud_id = s.id
           )
           or exists (select 1 from public.historial_relaciones h where h.relacion_id = s.id and h.created_at >= lower_bound and h.created_at < upper_bound)
      ),
      selected_orders as (
        select o.id
        from public.ordenes_trabajo o
        where o.created_at >= lower_bound and o.created_at < upper_bound
           or exists (select 1 from selected_visits v where v.id = o.visita_id)
      ),
      selected_certificates as (
        select c.id
        from public.certificados c
        where c.created_at >= lower_bound and c.created_at < upper_bound
           or c.updated_at >= lower_bound and c.updated_at < upper_bound
           or c.finalized_at >= lower_bound and c.finalized_at < upper_bound
           or c.fecha_ejecucion between from_date and to_date
           or exists (select 1 from selected_visits v where v.id = c.visita_id)
           or exists (select 1 from selected_orders o where o.id = c.orden_trabajo_id)
      ),
      selected_yacimientos as (
        select y.id from public.yacimientos y
        where y.created_at >= lower_bound and y.created_at < upper_bound
        union select v.yacimiento_id from public.visitas_servicio v join selected_visits sv on sv.id = v.id
        union select s.yacimiento_id from public.solicitudes_servicio s join selected_requests sr on sr.id = s.id
        union select c.yacimiento_id from public.certificados c join selected_certificates sc on sc.id = c.id
        union select h.yacimiento_id from public.historial_relaciones h where h.created_at >= lower_bound and h.created_at < upper_bound
        union select y.yacimiento_id from public.asignaciones_servicio y where y.started_at >= lower_bound and y.started_at < upper_bound or y.ended_at >= lower_bound and y.ended_at < upper_bound
      ),
      selected_plants as (
        select p.id from public.plantas_locaciones p join selected_yacimientos sy on sy.id = p.yacimiento_id
      ),
      selected_equipment as (
        select e.id from public.equipos_unidades e join selected_plants sp on sp.id = e.planta_id
      ),
      selected_valves as (
        select v.id from public.valvulas v join selected_equipment se on se.id = v.equipo_id
        union select c.valvula_id from public.certificados c join selected_certificates sc on sc.id = c.id
        union select o.valvula_id from public.ordenes_trabajo o join selected_orders so on so.id = o.id
      ),
      selected_assignments as (
        select a.id from public.asignaciones_servicio a
        where a.started_at >= lower_bound and a.started_at < upper_bound
           or a.ended_at >= lower_bound and a.ended_at < upper_bound
           or exists (select 1 from selected_requests sr where sr.id = a.solicitud_id)
           or exists (select 1 from selected_yacimientos sy where sy.id = a.yacimiento_id and (a.started_at >= lower_bound or a.ended_at is null))
      ),
      selected_images as (
        select ci.imagen_id as id from public.certificado_imagenes ci join selected_certificates sc on sc.id = ci.certificado_id
        union select f.imagen_id from public.firmas_visita f join selected_visits sv on sv.id = f.visita_id
      )
    select jsonb_build_object(
      'cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cuentas row where row.id = auth.uid() or row.id in (select y.cliente_cuenta_id from public.yacimientos y join selected_yacimientos sy on sy.id = y.id) or row.id in (select h.actor_cuenta_id from public.historial_relaciones h where h.created_at >= lower_bound and h.created_at < upper_bound) or row.id in (select s.cliente_cuenta_id from public.solicitudes_servicio s join selected_requests sr on sr.id = s.id) or row.id in (select f.cuenta_id from public.firmas_visita f join selected_visits sv on sv.id = f.visita_id where f.cuenta_id is not null)),
      'clientes', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.clientes row where row.cuenta_id in (select y.cliente_cuenta_id from public.yacimientos y join selected_yacimientos sy on sy.id = y.id)),
      'cliente_cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cliente_cuentas row where row.cliente_cuenta_id in (select y.cliente_cuenta_id from public.yacimientos y join selected_yacimientos sy on sy.id = y.id) or row.cuenta_id in (select c.id from public.cuentas c where c.id in (select h.actor_cuenta_id from public.historial_relaciones h where h.created_at >= lower_bound and h.created_at < upper_bound))),
      'cliente_accesos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.cliente_accesos row where row.cuenta_id in (select c.id from public.cuentas c where c.id in (select h.actor_cuenta_id from public.historial_relaciones h where h.created_at >= lower_bound and h.created_at < upper_bound))),
      'talleres_moviles', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.talleres_moviles row where row.id in (select v.taller_movil_id from public.visitas_servicio v join selected_visits sv on sv.id = v.id where v.taller_movil_id is not null) or row.id in (select a.taller_movil_id from public.asignaciones_servicio a join selected_assignments sa on sa.id = a.id)),
      'taller_cuentas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.taller_cuentas row where row.taller_movil_id in (select v.taller_movil_id from public.visitas_servicio v join selected_visits sv on sv.id = v.id where v.taller_movil_id is not null) or row.taller_movil_id in (select a.taller_movil_id from public.asignaciones_servicio a join selected_assignments sa on sa.id = a.id)),
      'personas', '[]'::jsonb,
      'nominas_jornada', '[]'::jsonb,
      'catalogo_opciones', '[]'::jsonb,
      'patrones_ensayo', '[]'::jsonb,
      'yacimientos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.yacimientos row join selected_yacimientos selected on selected.id = row.id),
      'plantas_locaciones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.plantas_locaciones row join selected_plants selected on selected.id = row.id),
      'equipos_unidades', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.equipos_unidades row join selected_equipment selected on selected.id = row.id),
      'valvulas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.valvulas row join selected_valves selected on selected.id = row.id),
      'valvula_revisiones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.valvula_revisiones row where row.created_at >= lower_bound and row.created_at < upper_bound or row.valvula_id in (select id from selected_valves)),
      'historial_relaciones', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.historial_relaciones row where row.created_at >= lower_bound and row.created_at < upper_bound or row.yacimiento_id in (select id from selected_yacimientos) and row.created_at >= lower_bound and row.created_at < upper_bound),
      'solicitudes_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.solicitudes_servicio row where row.id in (select id from selected_requests)),
      'solicitud_valvulas', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.solicitud_valvulas row where row.solicitud_id in (select id from selected_requests)),
      'asignaciones_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.asignaciones_servicio row where row.id in (select id from selected_assignments)),
      'visitas_servicio', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visitas_servicio row where row.id in (select id from selected_visits)),
      'ordenes_trabajo', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.ordenes_trabajo row where row.id in (select id from selected_orders)),
      'visita_equipos', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visita_equipos row where row.visita_id in (select id from selected_visits)),
      'certificados', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.certificados row where row.id in (select id from selected_certificates)),
      'certificado_imagenes', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.certificado_imagenes row where row.certificado_id in (select id from selected_certificates)),
      'imagenes_certificado', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.imagenes_certificado row where row.id in (select id from selected_images)),
      'firmas_visita', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.firmas_visita row where row.visita_id in (select id from selected_visits)),
      'contador_certificados', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.contador_certificados row where exists (select 1 from selected_certificates)),
      'dispositivos_visita', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.dispositivos_visita row where row.visita_id in (select id from selected_visits)),
      'operaciones_sync', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.operaciones_sync row where row.created_at >= lower_bound and row.created_at < upper_bound or row.server_received_at >= lower_bound and row.server_received_at < upper_bound or row.server_acknowledged_at >= lower_bound and row.server_acknowledged_at < upper_bound or row.visita_id in (select id from selected_visits)),
      'conflictos_sync', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.conflictos_sync row where row.created_at >= lower_bound and row.created_at < upper_bound or row.resolved_at >= lower_bound and row.resolved_at < upper_bound or row.visita_id in (select id from selected_visits)),
      'visitas_sync_ack', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.visitas_sync_ack row where row.server_received_at >= lower_bound and row.server_received_at < upper_bound or row.server_acknowledged_at >= lower_bound and row.server_acknowledged_at < upper_bound or row.visita_id in (select id from selected_visits)),
      'registros_generacion_backup', (select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) from public.registros_generacion_backup row where row.id = generation.id)
    ) into records;

    with
      selected_visits as (
        select v.id from public.visitas_servicio v where v.created_at >= lower_bound and v.created_at < upper_bound or v.updated_at >= lower_bound and v.updated_at < upper_bound or v.starts_at >= lower_bound and v.starts_at < upper_bound or v.ends_at > lower_bound and v.ends_at < upper_bound or v.accepted_at >= lower_bound and v.accepted_at < upper_bound or v.rejected_at >= lower_bound and v.rejected_at < upper_bound or v.cancelled_at >= lower_bound and v.cancelled_at < upper_bound
      ),
      selected_requests as (
        select s.id from public.solicitudes_servicio s where s.created_at >= lower_bound and s.created_at < upper_bound or s.updated_at >= lower_bound and s.updated_at < upper_bound or s.accepted_at >= lower_bound and s.accepted_at < upper_bound or exists (select 1 from public.solicitud_valvulas sv where sv.solicitud_id = s.id and sv.selected_at >= lower_bound and sv.selected_at < upper_bound)
      ),
      selected_certificates as (
        select c.id from public.certificados c where c.created_at >= lower_bound and c.created_at < upper_bound or c.updated_at >= lower_bound and c.updated_at < upper_bound or c.finalized_at >= lower_bound and c.finalized_at < upper_bound or c.fecha_ejecucion between from_date and to_date or c.visita_id in (select id from selected_visits)
      ),
      selected_yacimientos as (
        select y.id from public.yacimientos y where y.created_at >= lower_bound and y.created_at < upper_bound
        union select v.yacimiento_id from public.visitas_servicio v where v.id in (select id from selected_visits)
        union select s.yacimiento_id from public.solicitudes_servicio s where s.id in (select id from selected_requests)
        union select c.yacimiento_id from public.certificados c where c.id in (select id from selected_certificates)
        union select h.yacimiento_id from public.historial_relaciones h where h.created_at >= lower_bound and h.created_at < upper_bound
      )
    select coalesce(jsonb_agg(to_jsonb(ref)), '[]'::jsonb) into media
    from (
      select i.id, 'certificate_image'::text as tipo, i.bucket, i.object_path, i.categoria,
        case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else null end as expected_size,
        o.updated_at as expected_updated_at
      from public.imagenes_certificado i
      join public.certificado_imagenes ci on ci.imagen_id = i.id
      left join storage.objects o on o.bucket_id = i.bucket and o.name = i.object_path
      where ci.certificado_id in (select id from selected_certificates)
      union all
      select c.cuenta_id, 'client_logo'::text, c.logo_bucket, c.logo_path, 'logo',
        case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else null end,
        o.updated_at
      from public.clientes c
      join public.yacimientos y on y.cliente_cuenta_id = c.cuenta_id
      join selected_yacimientos sy on sy.id = y.id
      left join storage.objects o on o.bucket_id = c.logo_bucket and o.name = c.logo_path
      where c.logo_bucket is not null and c.logo_path is not null
    ) ref;
  end if;

  return jsonb_build_object(
    'generation', jsonb_build_object(
      'id', generation.id,
      'scope', generation.scope,
      'from_date', generation.from_date,
      'to_date', generation.to_date,
      'business_timezone', generation.business_timezone,
      'snapshot_at', generation.snapshot_at
    ),
    'records', records,
    'media', media,
    'excluded', jsonb_build_array('auth.users', 'storage.objects', 'secrets', 'credentials', 'infrastructure configuration', 'generated certificate PDFs')
  );
end;
$$;

create or replace function public.api_record_backup_export_result(
  generation_id uuid,
  export_status text,
  record_count integer,
  media_count integer,
  archive_size_bytes bigint,
  archive_sha256 text,
  warnings jsonb,
  error_code text default null,
  error_message text default null
)
returns public.registros_generacion_backup
language plpgsql
volatile
security definer
set search_path = public
as $$
declare result public.registros_generacion_backup;
begin
  perform public.api_backup_require_super_admin();
  if export_status not in ('success', 'warning', 'failure') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Unknown backup export status';
  end if;
  if jsonb_typeof(coalesce(warnings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'invalid_parameter_value', message = 'Backup warnings must be an array';
  end if;
  update public.registros_generacion_backup
  set status = export_status,
      record_count = greatest(coalesce($3, 0), 0),
      media_count = greatest(coalesce($4, 0), 0),
      archive_size_bytes = $5,
      archive_sha256 = nullif(btrim($6), ''),
      warnings = coalesce($7, '[]'::jsonb),
      error_code = nullif(btrim($8), ''),
      error_message = nullif(btrim($9), '')
  where id = $1 and actor_cuenta_id = auth.uid() and status = 'pending'
  returning * into result;
  if result.id is null then
    raise exception using errcode = 'no_data_found', message = 'Backup generation attempt not found or already finalized';
  end if;
  return result;
end;
$$;

revoke all on function public.api_backup_require_super_admin() from public, anon, authenticated;
revoke all on function public.api_prepare_backup_export(text, date, date) from public, anon, authenticated;
revoke all on function public.api_record_backup_export_result(uuid, text, integer, integer, bigint, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.api_backup_require_super_admin(), public.api_prepare_backup_export(text, date, date), public.api_record_backup_export_result(uuid, text, integer, integer, bigint, text, jsonb, text, text) to service_role;

commit;

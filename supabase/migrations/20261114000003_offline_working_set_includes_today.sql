begin;

-- P4: el working set de campo exigía `starts_at >= now()` para las visitas aceptadas, así que una
-- visita de hoy cuyo horario ya pasó (el técnico llega a las 10 a una visita de las 08 a 09)
-- desaparecía de /taller y no se podía iniciar. Ahora entran las aceptadas desde el inicio del día
-- de hoy en hora argentina y hasta dentro de dos días; las de días anteriores siguen fuera (hay que
-- reprogramarlas). Los cuerpos son los de 20261005154526 y 20261102000000; solo cambia la ventana.

-- Inicio del día actual en Argentina, como timestamptz.
create or replace function public.offline_working_set_window_start()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
    at time zone 'America/Argentina/Buenos_Aires'
$$;

revoke all on function public.offline_working_set_window_start() from public, anon, authenticated;
grant execute on function public.offline_working_set_window_start() to service_role;

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
          or (v.estado = 'aceptada' and v.starts_at >= public.offline_working_set_window_start() and v.starts_at < now() + interval '2 days')
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.api_offline_working_set() from public, anon, authenticated;
grant execute on function public.api_offline_working_set() to service_role;

create or replace function public.api_offline_working_set_for_device(target_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  provider uuid;
  latest_version uuid;
  visit_row public.visitas_servicio;
  visit_version uuid;
begin
  perform public.require_authenticated_cuenta();
  if target_device is null then
    raise exception using errcode = '22023', message = 'A device id is required';
  end if;
  select taller_movil_id into provider
  from public.taller_cuentas
  where cuenta_id = auth.uid();
  if provider is null then
    raise exception using errcode = '42501', message = 'Only a Taller Móvil can use the offline working set';
  end if;
  select current_version_id into latest_version from public.replacement_catalog_state where singleton;

  for visit_row in
    select v.*
    from public.visitas_servicio v
    where v.taller_movil_id = provider
      and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= public.offline_working_set_window_start() and v.starts_at < now() + interval '2 days'))
  loop
    visit_version := coalesce(visit_row.replacement_catalog_version_id, latest_version);
    insert into public.visit_catalog_downloads(visit_id, device_id, replacement_catalog_version_id, downloaded_at)
    values (visit_row.id, target_device, visit_version, clock_timestamp())
    on conflict (visit_id, device_id) do update
      set replacement_catalog_version_id = excluded.replacement_catalog_version_id,
          downloaded_at = excluded.downloaded_at;
  end loop;

  return jsonb_build_object(
    'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(latest_version),
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'visit', to_jsonb(v) || jsonb_build_object('sync_version', v.sync_version),
          'work_orders', coalesce((
            select jsonb_agg(to_jsonb(ot) || jsonb_build_object(
              'sync_version', ot.sync_version,
              'certificate_id', c.id,
              'certificate', to_jsonb(c),
              'valvula_nombre', val.nombre,
              'equipo_nombre', eq.nombre,
              'valvula', to_jsonb(val)
            ) order by ot.created_at, ot.id)
            from public.ordenes_trabajo ot
            left join public.certificados c on c.orden_trabajo_id = ot.id
            left join public.valvulas val on val.id = ot.valvula_id
            left join public.equipos_unidades eq on eq.id = val.equipo_id
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
            select jsonb_build_object('device_id', claim.device_id, 'claimed_at', claim.claimed_at, 'last_seen_at', claim.last_seen_at)
            from public.dispositivos_visita claim where claim.visita_id = v.id
          ),
          'certificate_catalogs', public.api_certificate_capture_catalogs_for_version(
            coalesce(v.replacement_catalog_version_id, latest_version)
          )
        ) order by v.starts_at, v.id
      )
      from public.visitas_servicio v
      where v.taller_movil_id = provider
        and (v.estado = 'en_curso' or (v.estado = 'aceptada' and v.starts_at >= public.offline_working_set_window_start() and v.starts_at < now() + interval '2 days'))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.api_offline_working_set_for_device(uuid) from public, anon, authenticated;
grant execute on function public.api_offline_working_set_for_device(uuid) to service_role;

commit;

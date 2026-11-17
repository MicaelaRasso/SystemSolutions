begin;

-- E2 (#95), decisión (e) de la usuaria (corregida el 2026-11-17): la visita tiene un fin estimado
-- (`ends_at`) que no la cierra; solo el técnico la completa. Como red de seguridad, una visita que
-- sigue en curso a las 23:59 (hora de Argentina) del día en que el técnico la inició pasa, por un
-- job de pg_cron, a «Requiere finalización» (`requiere_finalizacion`, 20261116120000).
--
-- * `close_expired_visits(reference_time)` toma las visitas `en_curso` cuyo día de inicio
--   (`started_at`, o `starts_at` en las iniciadas antes de 20261116120100; ver
--   `visit_start_day_end`) termina dentro del minuto siguiente a `reference_time` o ya terminó: a
--   las 23:59 AR cierra las del día y, en corridas posteriores, las de días anteriores que hayan
--   quedado. Las pasa a `requiere_finalizacion`, libera `visita_equipos` (el equipo queda libre y
--   el taller ya no tiene una visita en curso, así que puede iniciar otra) y deja historial y
--   auditoría. No toca firmas, órdenes de trabajo ni borradores: las firmas faltantes quedan
--   pendientes. Una visita que no se inició no se cierra sola (aunque haya pasado su fin
--   estimado). Es idempotente.
-- * `audit_visit_transition` (base 20261114000008) registra el cambio como
--   `visita_requiere_finalizacion`: un evento por visita cerrada, sin actor (lo hace el job).
-- * El job `cerrar-visitas-vencidas` corre a las 02:59 UTC (= 23:59 AR, sin horario de verano).
--   Solo se programa si la extensión pg_cron ya está habilitada: la migración no la activa (en
--   Supabase local puede no estarlo y en producción la habilita la usuaria). Después de habilitarla
--   se programa con `select public.schedule_close_expired_visits();` (ver ADR 0024 y
--   correcciones.md).

create or replace function public.audit_visit_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  action_name text;
  device_event_at timestamptz;
begin
  select cliente_cuenta_id into owner_id from public.yacimientos where id = new.yacimiento_id;
  if tg_op = 'INSERT' then
    action_name := 'visita_programada';
  elsif old.rejected_at is distinct from new.rejected_at and new.rejected_at is not null then
    action_name := 'visita_rechazada';
  elsif old.estado is distinct from new.estado then
    action_name := case new.estado
      when 'aceptada' then 'visita_aceptada'
      when 'en_curso' then 'visita_iniciada'
      when 'requiere_finalizacion' then 'visita_requiere_finalizacion'
      when 'completada' then 'visita_completada'
      when 'cancelada' then 'visita_cancelada'
      when 'programada' then 'visita_reprogramada'
      else 'visita_estado_actualizado' end;
    if new.estado = 'completada' then
      select os.device_timestamp
        into device_event_at
      from public.operaciones_sync os
      where os.visita_id = new.id
        and os.kind = 'complete_visit'
        and os.device_timestamp is not null
      order by os.server_received_at desc nulls last, os.created_at desc
      limit 1;
    end if;
  elsif old.taller_movil_id is distinct from new.taller_movil_id then
    action_name := case when old.taller_movil_id is null then 'visita_asignada' when new.taller_movil_id is null then 'visita_desasignada' else 'visita_reasignada' end;
  elsif old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at then
    action_name := 'visita_reprogramada';
  else
    return new;
  end if;
  perform public.record_audit_event(action_name, 'visita_servicio', new.id, 'exitoso',
    jsonb_build_object('estado_anterior', case when tg_op = 'UPDATE' then old.estado else null end,
      'estado_nuevo', new.estado, 'inicio_anterior', case when tg_op = 'UPDATE' then old.starts_at else null end,
      'inicio_nuevo', new.starts_at, 'fin_anterior', case when tg_op = 'UPDATE' then old.ends_at else null end,
      'fin_nuevo', new.ends_at, 'iniciada_en', new.started_at),
    jsonb_build_object('taller_movil_anterior', case when tg_op = 'UPDATE' then old.taller_movil_id else null end,
      'taller_movil_id', new.taller_movil_id, 'solicitud_id', new.solicitud_id),
    device_event_at, null, owner_id, new.yacimiento_id, new.id, null);
  return new;
end;
$$;

revoke all on function public.audit_visit_transition() from public, anon, authenticated;
grant execute on function public.audit_visit_transition() to service_role;

-- Fin del día (hora de Argentina) en que empezó la visita: 00:00 AR del día siguiente, es decir
-- después de las 23:59:59.999… Argentina no tiene horario de verano, pero se calcula con la zona.
create or replace function public.visit_start_day_end(inicio timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = public
as $$
  select ((inicio at time zone 'America/Argentina/Buenos_Aires')::date + 1)::timestamp
    at time zone 'America/Argentina/Buenos_Aires'
$$;

revoke all on function public.visit_start_day_end(timestamptz) from public, anon, authenticated;
grant execute on function public.visit_start_day_end(timestamptz) to service_role;

create or replace function public.close_expired_visits(reference_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired public.visitas_servicio;
  closed_count integer := 0;
begin
  if reference_time is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A reference time is required';
  end if;

  for expired in
    select v.*
    from public.visitas_servicio v
    where v.estado = 'en_curso'
      and public.visit_start_day_end(coalesce(v.started_at, v.starts_at)) <= reference_time + interval '1 minute'
    order by coalesce(v.started_at, v.starts_at), v.id
    for update skip locked
  loop
    update public.visitas_servicio
    set estado = 'requiere_finalizacion', updated_at = now()
    where id = expired.id and estado = 'en_curso';
    if not found then
      continue;
    end if;

    -- El equipo y el taller quedan libres para otras visitas.
    delete from public.visita_equipos where visita_id = expired.id;

    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
    values ('servicio', expired.yacimiento_id, expired.id, null,
      jsonb_build_object('event', 'visit_requires_finalization', 'estado_anterior', 'en_curso',
        'iniciada_en', coalesce(expired.started_at, expired.starts_at),
        'vencio_en', public.visit_start_day_end(coalesce(expired.started_at, expired.starts_at))));
    closed_count := closed_count + 1;
  end loop;

  return closed_count;
end;
$$;

revoke all on function public.close_expired_visits(timestamptz) from public, anon, authenticated;
grant execute on function public.close_expired_visits(timestamptz) to service_role;

-- Programa (o reprograma) el job si pg_cron está habilitado. Devuelve qué hizo. Se usa en esta
-- migración y, en producción, después de habilitar la extensión.
create or replace function public.schedule_close_expired_visits()
returns text
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    return 'pg_cron no está habilitado: el cierre automático de visitas no quedó programado';
  end if;
  -- SQL dinámico: el esquema `cron` solo existe con la extensión habilitada.
  execute $sql$
    select cron.schedule(
      'cerrar-visitas-vencidas',
      '59 2 * * *',
      'select public.close_expired_visits()'
    )
  $sql$;
  return 'cerrar-visitas-vencidas programado a las 02:59 UTC (23:59 AR)';
end;
$$;

revoke all on function public.schedule_close_expired_visits() from public, anon, authenticated, service_role;

do $$
begin
  raise notice '%', public.schedule_close_expired_visits();
end;
$$;

commit;

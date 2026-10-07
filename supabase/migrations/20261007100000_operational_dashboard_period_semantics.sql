begin;

-- Dashboard periods are business dates in Argentina. Keep timestamp filters
-- independent of the database session timezone, and use the same calendar
-- when computing the rolling certificate-expiry window.
create or replace function public.api_admin_metrics(period_from date, period_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
  period_start timestamptz;
  period_end timestamptz;
  argentina_today date;
begin
  perform public.api_audit_require_admin();
  if period_from is null or period_to is null or period_from > period_to then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid period';
  end if;

  period_start := period_from::timestamp at time zone 'America/Argentina/Buenos_Aires';
  period_end := (period_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  argentina_today := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  select jsonb_build_object(
    'from', period_from,
    'to', period_to,
    'finalized_certificates', (
      select count(*) from public.certificados c
      where c.estado = 'finalizado'
        and c.finalized_at >= period_start and c.finalized_at < period_end
    ),
    'completed_visits', (
      select count(*) from public.visitas_servicio v
      where v.estado = 'completada'
        and v.updated_at >= period_start and v.updated_at < period_end
    ),
    -- Pending certificates are an outstanding-work total, not a finalized
    -- certificate metric and not limited to the selected activity period.
    'pending_certificates', (
      select count(*) from public.certificados c where c.estado = 'pendiente'
    ),
    -- Expiration is a rolling 30-day window beginning on today's Argentina
    -- calendar date, inclusive of both today and the thirtieth day.
    'expiring_certificates', (
      select count(*) from public.certificados c
      where c.estado = 'finalizado'
        and c.vigencia_hasta >= argentina_today
        and c.vigencia_hasta <= argentina_today + 30
    ),
    'unassigned_visits', (
      select count(*) from public.visitas_servicio v
      where v.taller_movil_id is null
        and v.estado not in ('cancelada', 'completada')
        and v.starts_at >= period_start and v.starts_at < period_end
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.api_admin_metrics(date, date) from public, anon, authenticated;
grant execute on function public.api_admin_metrics(date, date) to service_role;

commit;

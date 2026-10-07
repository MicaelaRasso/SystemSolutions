begin;

-- Audit exports share the list filters and visibility rules, but return the
-- complete matching set instead of only one 100-row page.
create or replace function public.api_audit_export(
  from_date date default null, to_date date default null, actor_filter uuid default null,
  action_filter text default null, target_type_filter text default null, outcome_filter text default null,
  client_filter uuid default null, yacimiento_filter uuid default null, visit_filter uuid default null,
  certificate_filter uuid default null, limit_count integer default 100, offset_count integer default 0
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  actor_role public.rol;
  result jsonb;
begin
  actor_role := public.api_audit_require_admin();
  if actor_role <> 'super_administrador' then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the Súper Administrador can export audit data';
  end if;
  if from_date is not null and to_date is not null and from_date > to_date then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid date range';
  end if;
  if outcome_filter is not null and outcome_filter not in ('exitoso', 'fallido') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid outcome filter';
  end if;

  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(matched) order by matched.recibida_en desc, matched.id desc), '[]'::jsonb),
    'total', count(*), 'limit', count(*), 'offset', 0, 'has_more', false
  ) into result
  from (
    select a.*, c.rol as actor_rol, coalesce(u.email, '') as actor_email,
      y.nombre as yacimiento_nombre, count(*) over () as total_count
    from public.registros_auditoria a
    left join public.cuentas c on c.id = a.actor_cuenta_id
    left join auth.users u on u.id = a.actor_cuenta_id
    left join public.yacimientos y on y.id = a.yacimiento_id
    where (from_date is null or a.recibida_en >= from_date::timestamptz)
      and (to_date is null or a.recibida_en < (to_date + 1)::timestamptz)
      and (actor_filter is null or a.actor_cuenta_id = actor_filter)
      and (action_filter is null or a.accion = action_filter)
      and (target_type_filter is null or a.tipo_objetivo = target_type_filter)
      and (outcome_filter is null or a.resultado = outcome_filter)
      and (client_filter is null or a.cliente_cuenta_id = client_filter)
      and (yacimiento_filter is null or a.yacimiento_id = yacimiento_filter)
      and (visit_filter is null or a.visita_id = visit_filter)
      and (certificate_filter is null or a.certificado_id = certificate_filter)
  ) matched;

  perform public.record_audit_event(
    'auditoria_exportada', 'registro_auditoria', null, 'exitoso',
    jsonb_build_object(
      'from', from_date, 'to', to_date, 'actor_id', actor_filter,
      'action', action_filter, 'target_type', target_type_filter, 'outcome', outcome_filter
    ),
    jsonb_build_object(
      'client_id', client_filter, 'yacimiento_id', yacimiento_filter,
      'visit_id', visit_filter, 'certificate_id', certificate_filter,
      'exported_count', result->'total'
    )
  );
  return result;
end;
$$;

alter function public.api_audit_export(date,date,uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer) volatile;

commit;

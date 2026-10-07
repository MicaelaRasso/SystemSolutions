begin;

-- Replace the original placeholder filters with searchable hierarchy and
-- visit-signature filters. Signature state is visit-scoped because both
-- signatures are captured once per Visita de servicio.
drop function public.api_admin_certificate_history(uuid, uuid, uuid, uuid, text, date, text, integer, integer);

create function public.api_admin_certificate_history(
  client_filter uuid default null,
  yacimiento_filter uuid default null,
  plant_filter uuid default null,
  valve_filter uuid default null,
  state_filter text default null,
  signature_state_filter text default null,
  valid_until_filter date default null,
  search_text text default null,
  limit_count integer default 100,
  offset_count integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; normalized_search text := nullif(btrim(search_text), '');
begin
  perform public.api_audit_require_admin();
  if limit_count < 1 or limit_count > 100 or offset_count < 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid pagination';
  end if;
  if state_filter is not null and state_filter not in ('borrador', 'pendiente', 'finalizado') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid certificate state';
  end if;
  if signature_state_filter is not null and signature_state_filter not in ('none', 'partial', 'complete') then
    raise exception using errcode = 'invalid_parameter_value', message = 'Invalid signature state';
  end if;

  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb),
    'total', coalesce(max(x.total_count), 0), 'limit', limit_count, 'offset', offset_count
  ) into result
  from (
    select c.*, y.cliente_cuenta_id, y.nombre as yacimiento_nombre,
      p.nombre as planta_nombre, v.nombre as valvula_nombre,
      coalesce(sig.signature_count, 0) as firma_count,
      case when coalesce(sig.signature_count, 0) = 0 then 'none'
        when sig.signature_count = 1 then 'partial' else 'complete' end as signature_state,
      coalesce(u.email, '') as cliente_email,
      count(*) over () as total_count
    from public.certificados c
    join public.yacimientos y on y.id = c.yacimiento_id
    join public.plantas_locaciones p on p.id = c.planta_id
    join public.valvulas v on v.id = c.valvula_id
    left join auth.users u on u.id = y.cliente_cuenta_id
    left join lateral (
      select count(*)::integer as signature_count
      from public.firmas_visita f where f.visita_id = c.visita_id
    ) sig on true
    where (client_filter is null or y.cliente_cuenta_id = client_filter)
      and (yacimiento_filter is null or c.yacimiento_id = yacimiento_filter)
      and (plant_filter is null or c.planta_id = plant_filter)
      and (valve_filter is null or c.valvula_id = valve_filter)
      and (state_filter is null or c.estado::text = state_filter)
      and (signature_state_filter is null or
        case when coalesce(sig.signature_count, 0) = 0 then 'none'
          when sig.signature_count = 1 then 'partial' else 'complete' end = signature_state_filter)
      and (valid_until_filter is null or c.vigencia_hasta = valid_until_filter)
      and (normalized_search is null or c.id::text ilike '%' || normalized_search || '%'
        or y.cliente_cuenta_id::text ilike '%' || normalized_search || '%'
        or coalesce(u.email, '') ilike '%' || normalized_search || '%'
        or y.nombre ilike '%' || normalized_search || '%'
        or p.nombre ilike '%' || normalized_search || '%'
        or v.nombre ilike '%' || normalized_search || '%')
    order by c.created_at desc, c.id desc limit limit_count offset offset_count
  ) x;
  return coalesce(result, jsonb_build_object('items', '[]', 'total', 0, 'limit', limit_count, 'offset', offset_count));
end;
$$;

create or replace function public.api_admin_certificate(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb; target_valve uuid; target_visit uuid;
begin
  perform public.api_audit_require_admin();
  select c.valvula_id, c.visita_id into target_valve, target_visit
  from public.certificados c where c.id = certificate_id;
  if target_valve is null then
    raise exception using errcode = 'no_data_found', message = 'Certificate not found';
  end if;
  select jsonb_build_object(
    'certificate', to_jsonb(c),
    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at asc, h.id asc)
      from public.certificados h where h.valvula_id = target_valve
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.recibida_en desc, a.id desc)
      from public.registros_auditoria a
      where a.certificado_id = certificate_id
        or (a.visita_id = target_visit and a.accion in (
          'visita_programada', 'visita_reprogramada', 'visita_aceptada', 'visita_iniciada',
          'visita_completada', 'visita_cancelada', 'firma_visita_registrada'
        ))
    ), '[]'::jsonb)
  ) into result from public.certificados c where c.id = certificate_id;
  return result;
end;
$$;

revoke all on function public.api_admin_certificate_history(uuid, uuid, uuid, uuid, text, text, date, text, integer, integer),
  public.api_admin_certificate(uuid) from public, anon, authenticated;
grant execute on function public.api_admin_certificate_history(uuid, uuid, uuid, uuid, text, text, date, text, integer, integer),
  public.api_admin_certificate(uuid) to service_role;

commit;

begin;

-- The Cliente signature panel receives a server-owned pending set.  It must not
-- derive certificate eligibility from the broader operation/work-order read.
create or replace function public.api_cliente_pending_certificates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_authenticated_cuenta();

  if not exists (
    select 1
    from public.cuentas
    where id = auth.uid()
      and rol = 'cliente'
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can read pending certificates';
  end if;

  select jsonb_build_object(
    'visits', coalesce(jsonb_agg(
      jsonb_build_object(
        'visit', to_jsonb(v),
        'yacimiento', to_jsonb(y),
        'work_orders', work_orders.items,
        'pending_certificates', pending.items,
        'pending_certificate_count', pending.item_count
      )
      order by v.starts_at, v.id
    ), '[]'::jsonb)
  )
  into result
  from public.visitas_servicio v
  join public.yacimientos y on y.id = v.yacimiento_id
  cross join lateral (
    select
      coalesce(jsonb_agg(to_jsonb(ot) order by ot.created_at, ot.id), '[]'::jsonb) as items
    from public.ordenes_trabajo ot
    where ot.visita_id = v.id
  ) work_orders
  cross join lateral (
    select
      coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb) as items,
      count(*)::integer as item_count
    from public.certificados c
    where c.visita_id = v.id
      and c.estado_captura = 'cerrado'
      and c.estado = 'pendiente'
      and coalesce((public.api_certificate_validation(c)->>'complete')::boolean, false)
  ) pending
  where v.estado = 'completada'
    and y.cliente_cuenta_id = auth.uid()
    and public.can_access_yacimiento(y.id)
    and pending.item_count > 0
    and not exists (
      select 1
      from public.firmas_visita f
      where f.visita_id = v.id
        and f.parte = 'cliente'
    );

  return result;
end;
$$;

revoke all on function public.api_cliente_pending_certificates() from public, anon, authenticated;
grant execute on function public.api_cliente_pending_certificates() to service_role;

commit;

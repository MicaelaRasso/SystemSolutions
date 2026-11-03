begin;

-- OperationSummary includes orden_trabajo from solicitudes_servicio.metadata so that
-- agenda, cronograma and task views can display the commercial work order identifier
-- without reading full request details or falling back to raw internal database UUIDs.
create or replace function public.operation_summary(target_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', v.id,
    'solicitud_id', v.solicitud_id,
    'numero_solicitud', s.numero_solicitud,
    'estado', v.estado::text,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'cliente', jsonb_build_object(
      'id', s.cliente_cuenta_id,
      'nombre', coalesce(nullif(c.razon_social, ''), c.nombre)
    ),
    'yacimiento', jsonb_build_object(
      'id', v.yacimiento_id,
      'nombre', y.nombre
    ),
    'taller_movil', case
      when t.id is null then null
      else jsonb_build_object('id', t.id, 'nombre', t.nombre)
    end,
    'ordenes', (
      select jsonb_build_object(
        'total', count(*),
        'pendientes', count(*) filter (where ot.estado = 'pendiente'),
        'evaluadas', count(*) filter (where ot.estado = 'evaluada'),
        'no_evaluadas', count(*) filter (where ot.estado = 'no_evaluada')
      )
      from public.ordenes_trabajo ot
      where ot.visita_id = v.id
    ),
    'contacto', coalesce(s.metadata->>'contacto', ''),
    'telefono', coalesce(s.metadata->>'telefono', ''),
    'detalle', coalesce(s.metadata->>'detalle', ''),
    'tipo', coalesce(nullif(s.metadata->>'tipo', ''), 'Certificación'),
    'pd_rto', s.metadata->>'pd_rto',
    'orden_trabajo', s.metadata->>'orden_trabajo',
    'plantas', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre, p.id)
      from public.plantas_locaciones p
      where p.id in (
        select e.planta_id
        from public.ordenes_trabajo ot
        join public.valvulas va on va.id = ot.valvula_id
        join public.equipos_unidades e on e.id = va.equipo_id
        where ot.visita_id = v.id
      )
    ), '[]'::jsonb)
  )
  from public.visitas_servicio v
  join public.solicitudes_servicio s on s.id = v.solicitud_id
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = v.yacimiento_id
  left join public.talleres_moviles t on t.id = v.taller_movil_id
  where v.id = target_visit;
$$;
revoke all on function public.operation_summary(uuid) from public, anon, authenticated, service_role;

commit;


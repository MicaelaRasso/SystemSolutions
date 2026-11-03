begin;

-- 1. When an Administrador creates a new Equipo/Unidad directly inside the "Nueva tarea"
--    cascade, that Equipo starts with 0 Válvulas. Ensure api_admin_create_service_request
--    provisions an initial Válvula for any selected Equipo in target_yacimiento that has
--    none yet, so administrative task creation succeeds without leaving the form.
create or replace function public.api_admin_create_service_request(
  target_client uuid,
  target_yacimiento uuid,
  selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.solicitudes_servicio;
  selection jsonb;
  selection_id uuid;
begin
  perform public.require_authenticated_cuenta();

  if not exists (
    select 1
    from public.cuentas actor
    where actor.id = auth.uid()
      and actor.rol in ('administrador_regular', 'super_administrador')
      and actor.activo
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only an active Administrador can create a service request';
  end if;

  if not exists (
    select 1
    from public.cuentas client_account
    join public.clientes client on client.cuenta_id = client_account.id
    where client_account.id = target_client
      and client_account.rol = 'cliente'
      and client_account.activo
      and client.activo
  ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'Cliente not found';
  end if;

  if not exists (
    select 1
    from public.yacimientos y
    where y.id = target_yacimiento
      and y.cliente_cuenta_id = target_client
  ) then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'The selected Cliente does not own the Yacimiento';
  end if;

  if jsonb_typeof(selections) = 'array' then
    for selection in select value from jsonb_array_elements(selections) loop
      if selection->>'kind' = 'equipo' then
        begin
          selection_id := (selection->>'id')::uuid;
        exception when invalid_text_representation then
          selection_id := null;
        end;
        if selection_id is not null
          and exists (
            select 1
            from public.equipos_unidades e
            join public.plantas_locaciones p on p.id = e.planta_id
            where e.id = selection_id
              and p.yacimiento_id = target_yacimiento
          )
          and not exists (
            select 1
            from public.valvulas v
            where v.equipo_id = selection_id
          )
        then
          insert into public.valvulas(equipo_id, nombre)
          values (selection_id, 'Válvula 1');
        end if;
      end if;
    end loop;
  end if;

  insert into public.solicitudes_servicio(yacimiento_id, cliente_cuenta_id)
  values (target_yacimiento, target_client)
  returning * into result;

  perform public.api_replace_service_selection(result.id, target_yacimiento, selections);

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'servicio', target_yacimiento, result.id, auth.uid(),
    jsonb_build_object('event', 'request_created', 'origin', 'administrator')
  );

  return public.api_service_request(result.id);
end;
$$;

revoke all on function public.api_admin_create_service_request(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_admin_create_service_request(uuid, uuid, jsonb)
  to service_role;

-- 2. Include detalle, tipo, and pd_rto from solicitudes_servicio.metadata in
--    operation_summary so Agenda cards and TareaSheet have contact, phone, and
--    the detail field below it immediately.
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


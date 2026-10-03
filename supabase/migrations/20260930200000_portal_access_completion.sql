begin;

-- Additional Cliente accounts retain their existing hierarchy scope while the
-- principal account remains the owner of the records.
create or replace function public.can_access_yacimiento(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.yacimientos y
    join public.cuentas c on c.id = auth.uid()
    where y.id = target
      and c.activo
      and (
        c.rol in ('administrador_regular', 'super_administrador')
        or y.cliente_cuenta_id = c.id
        or (
          c.rol = 'cliente'
          and exists (
            select 1
            from public.cliente_cuentas cc
            where cc.cliente_cuenta_id = y.cliente_cuenta_id
              and cc.cuenta_id = c.id
          )
          and (
            not exists (select 1 from public.cliente_accesos ca where ca.cuenta_id = c.id)
            or exists (
              select 1
              from public.cliente_accesos ca
              left join public.plantas_locaciones p on ca.nivel = 'planta' and p.id = ca.ref_id
              left join public.equipos_unidades e on ca.nivel = 'equipo' and e.id = ca.ref_id
              where ca.cuenta_id = c.id
                and (
                  (ca.nivel = 'yacimiento' and ca.ref_id = y.id)
                  or (ca.nivel = 'planta' and p.yacimiento_id = y.id)
                  or (ca.nivel = 'equipo' and e.planta_id in (
                    select p2.id from public.plantas_locaciones p2 where p2.yacimiento_id = y.id
                  ))
                )
            )
          )
        )
        or exists (
          select 1
          from public.asignaciones_servicio a
          join public.taller_cuentas tc on tc.taller_movil_id = a.taller_movil_id
          where a.yacimiento_id = y.id
            and a.estado = 'activa'
            and tc.cuenta_id = c.id
        )
      )
  )
$$;

-- The profile read is available to its owner (including an internal linked
-- account) and to Administradores. Profile mutation remains administrative.
create or replace function public.api_client(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  client_id uuid := coalesce(
    (select cc.cliente_cuenta_id from public.cliente_cuentas cc where cc.cuenta_id = target),
    target
  );
  actor_is_admin boolean := public.api_actor_is_admin();
begin
  if actor_is_admin then
    select row into result
    from public.api_client_rows() row
    where (row->>'id')::uuid = client_id;
  elsif exists (
    select 1 from public.cuentas c
    where c.id = auth.uid()
      and c.activo
      and c.rol = 'cliente'
      and (
        c.id = client_id
        or exists (
          select 1 from public.cliente_cuentas cc
          where cc.cliente_cuenta_id = client_id and cc.cuenta_id = c.id
        )
      )
  ) then
    select jsonb_build_object(
      'id', c.cuenta_id,
      'razon_social', coalesce(nullif(c.razon_social, ''), c.nombre),
      'nombre', c.nombre,
      'cuit', coalesce(c.cuit, ''),
      'contacto', coalesce(c.contacto, ''),
      'telefono', coalesce(c.telefono, ''),
      'email', coalesce(c.email, ''),
      'direccion', coalesce(c.direccion, ''),
      'logo_url', case when c.logo_bucket is null or c.logo_path is null then null else jsonb_build_object('bucket', c.logo_bucket, 'path', c.logo_path) end,
      'aviso_vencimiento', c.aviso_vencimiento,
      'activo', c.activo,
      'creado_en', c.created_at,
      'yacimientos', (select count(*) from public.yacimientos y where y.cliente_cuenta_id = c.cuenta_id),
      'valvulas', (select count(*) from public.valvulas v join public.equipos_unidades e on e.id = v.equipo_id join public.plantas_locaciones p on p.id = e.planta_id join public.yacimientos y on y.id = p.yacimiento_id where y.cliente_cuenta_id = c.cuenta_id),
      'usuarios', (select count(*) from public.cuentas a where a.id = c.cuenta_id or exists (select 1 from public.cliente_cuentas cc where cc.cliente_cuenta_id = c.cuenta_id and cc.cuenta_id = a.id))
    ) into result
    from public.clientes c
    where c.cuenta_id = client_id;
  else
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;

  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  return result;
end;
$$;

create or replace function public.api_client_me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.api_client(auth.uid())
$$;

-- Administrators keep their correction path; a Cliente may change only the
-- logo belonging to its own principal profile.
create or replace function public.api_set_client_logo(target uuid, bucket_name text, object_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare client_id uuid := coalesce(
  (select cc.cliente_cuenta_id from public.cliente_cuentas cc where cc.cuenta_id = target),
  target
);
begin
  if public.api_actor_is_admin() then
    null;
  elsif not exists (
    select 1 from public.cuentas c
    where c.id = auth.uid() and c.rol = 'cliente' and c.activo
      and (c.id = client_id or exists (
        select 1 from public.cliente_cuentas cc
        where cc.cliente_cuenta_id = client_id and cc.cuenta_id = c.id
      ))
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente or an Administrador can change a Cliente logo';
  end if;

  update public.clientes
  set logo_bucket = bucket_name, logo_path = object_path
  where cuenta_id = client_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  return public.api_client(client_id);
end;
$$;

create or replace function public.api_set_own_client_logo(object_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  actor_id uuid := auth.uid();
  actor_namespace_prefix text := 'clients/' || actor_id::text || '/';
  client_id uuid := coalesce(
    (select cc.cliente_cuenta_id from public.cliente_cuentas cc where cc.cuenta_id = actor_id),
    actor_id
  );
  client_namespace_prefix text := 'clients/' || client_id::text || '/';
  namespace_prefix text;
begin
  if actor_id is null or not exists (
    select 1 from public.cuentas where id = actor_id and rol = 'cliente' and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Cliente can change its logo';
  end if;
  namespace_prefix := case
    when actor_id = client_id then actor_namespace_prefix
    else client_namespace_prefix
  end;
  if object_path is null
     or left(object_path, length(namespace_prefix)) <> namespace_prefix
     or not exists (select 1 from storage.objects where bucket_id = 'client-logos' and name = object_path) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Logo object is not authorized';
  end if;
  update public.clientes
  set logo_bucket = 'client-logos', logo_path = object_path
  where cuenta_id = client_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  return public.api_client(client_id);
end;
$$;

-- Portal and administrative consumers share the canonical visit projection.
create or replace function public.api_visit(visit_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare visit_row public.visitas_servicio; account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select * into visit_row from public.visitas_servicio where id = visit_id;
  select rol into account_role from public.cuentas where id = auth.uid();
  if visit_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'Visit not found';
  end if;
  if account_role not in ('administrador_regular', 'super_administrador')
    and not public.can_access_yacimiento(visit_row.yacimiento_id)
    and not exists (select 1 from public.taller_cuentas where cuenta_id = auth.uid() and taller_movil_id = visit_row.taller_movil_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
  return jsonb_build_object(
    'visit', to_jsonb(visit_row),
    'work_orders', coalesce((select jsonb_agg(jsonb_build_object('id', ot.id, 'valvula_id', ot.valvula_id) order by ot.created_at) from public.ordenes_trabajo ot where ot.visita_id = visit_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.api_visits()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select rol into account_role from public.cuentas where id = auth.uid();
  if account_role in ('administrador_regular', 'super_administrador') then
    return query select public.api_visit(v.id) from public.visitas_servicio v order by v.starts_at;
  elsif account_role = 'cliente' then
    return query select public.api_visit(v.id) from public.visitas_servicio v where public.can_access_yacimiento(v.yacimiento_id) order by v.starts_at;
  elsif account_role = 'taller_movil' then
    return query select public.api_visit(v.id) from public.visitas_servicio v join public.taller_cuentas tc on tc.taller_movil_id = v.taller_movil_id where tc.cuenta_id = auth.uid() order by v.starts_at;
  end if;
end;
$$;

-- A download is permitted only for a closed, finalized certificate with both
-- immutable visit-level signatures. Pending/history reads stay available via
-- api_valvula_certificates, but never cross this download boundary.
create or replace function public.api_finalized_certificate(certificate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.certificados;
begin
  select * into c from public.certificados where id = certificate_id;
  if c.id is null or c.estado <> 'finalizado'
     or not exists (select 1 from public.firmas_visita where visita_id = c.visita_id and parte = 'tecnico')
     or not exists (select 1 from public.firmas_visita where visita_id = c.visita_id and parte = 'cliente') then
    raise exception using errcode = 'no_data_found', message = 'Finalized certificate with required signatures not found';
  end if;
  perform public.require_yacimiento_access(c.yacimiento_id);
  return jsonb_build_object(
    'certificate', to_jsonb(c),
    'context', jsonb_build_object('yacimiento', coalesce(c.instantanea, c.contexto_captura)->'yacimiento', 'planta', coalesce(c.instantanea, c.contexto_captura)->'planta', 'equipo', coalesce(c.instantanea, c.contexto_captura)->'equipo', 'valvula', coalesce(c.instantanea, c.contexto_captura)->'valvula'),
    'snapshot', coalesce(c.instantanea, c.contexto_captura),
    'validity', jsonb_build_object('execution_date', c.fecha_ejecucion, 'valid_until', c.vigencia_hasta, 'is_valid', c.vigencia_hasta is not null and current_date <= c.vigencia_hasta),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('parte', f.parte, 'nombre_firmante', f.nombre_firmante, 'capture_method', f.capture_method, 'captured_at', f.captured_at, 'image', jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path)) order by f.parte) from public.firmas_visita f join public.imagenes_certificado i on i.id = f.imagen_id where f.visita_id = c.visita_id), '[]'::jsonb),
    'images', public.api_certificate_asset_refs(c.id),
    'client_logo', coalesce(c.instantanea, c.contexto_captura)->'client_logo'
  );
end;
$$;

create or replace function public.api_cliente_certificate_export(certificate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.certificados; account_role public.rol;
begin
  perform public.require_authenticated_cuenta();
  select rol into account_role from public.cuentas where id = auth.uid();
  if account_role <> 'cliente' then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente can use the portal certificate download';
  end if;
  select * into c from public.certificados where id = certificate_id;
  if c.id is null or not public.can_access_yacimiento(c.yacimiento_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'Certificate is outside the Cliente scope';
  end if;
  return public.api_finalized_certificate(certificate_id);
end;
$$;

revoke all on function public.api_client_me(), public.api_cliente_certificate_export(uuid) from public, anon, authenticated;
grant execute on function public.api_client_me(), public.api_cliente_certificate_export(uuid),
  public.api_client(uuid), public.api_set_client_logo(uuid, text, text),
  public.api_set_own_client_logo(text), public.api_visit(uuid), public.api_visits(),
  public.api_finalized_certificate(uuid) to service_role;

commit;

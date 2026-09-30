begin;

-- The Cliente principal can read its own profile through asset-access while
-- profile mutations and cross-Cliente reads remain administrator-only.
create or replace function public.api_client(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if exists (
    select 1 from public.cuentas
    where id = auth.uid() and activo
      and rol in ('administrador_regular', 'super_administrador')
  ) then
    select row into result from public.api_client_rows() row where (row->>'id')::uuid = target;
  elsif exists (
    select 1 from public.cuentas
    where id = auth.uid() and activo and rol = 'cliente' and id = target
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
    where c.cuenta_id = target;
  else
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;

  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  return result;
end;
$$;

revoke all on function public.api_client(uuid) from public, anon, authenticated;
grant execute on function public.api_client(uuid) to service_role;

commit;

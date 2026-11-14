begin;

-- P5: al crear un Cliente, el panel lleva directo a cargar su estructura, pero el Cliente invitado
-- queda con la cuenta pendiente de activación (cuentas.estado = 'pendiente', activo = false) y el
-- alta del yacimiento respondía «The target account is not an active Cliente». Igual que en S3
-- (20261112000001), se acepta la cuenta pendiente; la deshabilitada se sigue rechazando.
-- Base: la definición de 20260930170000 (sin otros cambios). `create or replace` conserva los
-- permisos de la función.
create or replace function public.api_create_yacimiento_for_actor(
  target_client uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.yacimientos;
begin
  perform public.api_require_hierarchy_administrator();
  if target_client is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A Cliente is required to create a Yacimiento';
  end if;
  if not exists (
    select 1 from public.cuentas c
    join public.clientes client on client.cuenta_id = c.id
    where c.id = target_client
      and c.rol = 'cliente'
      and (c.activo or c.estado = 'pendiente')
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'The target account is not an active Cliente';
  end if;

  insert into public.yacimientos(cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (
    target_client,
    public.require_asset_name(asset_name),
    public.require_nonblank(asset_provincia, 'Provincia'),
    public.require_nonblank(asset_operadora, 'Operadora'),
    public.require_nonblank(asset_contratista, 'Contratista')
  )
  returning * into result;

  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos)
  values (
    'jerarquia', result.id, result.id, auth.uid(),
    jsonb_build_object('event', 'created', 'kind', 'yacimiento', 'cliente_cuenta_id', target_client)
  );
  return result;
end;
$$;

commit;

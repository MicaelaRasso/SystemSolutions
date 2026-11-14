begin;

-- N3 (RN-06): el portal ocultaba los certificados vencidos, pero la descarga del Cliente
-- (`GET certificates/:id/download`) los seguía entregando. Ahora la exportación del Cliente rechaza
-- un certificado cuya vigencia ya terminó. El Administrador sigue leyéndolo por
-- `api_finalized_certificate` (RN-05). Base: 20260930200000 (sin otros cambios).
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
  if c.vigencia_hasta is not null and c.vigencia_hasta < current_date then
    raise exception using errcode = 'insufficient_privilege', message = 'An expired certificate cannot be downloaded by the Cliente';
  end if;
  return public.api_finalized_certificate(certificate_id);
end;
$$;

revoke all on function public.api_cliente_certificate_export(uuid) from public, anon, authenticated;
grant execute on function public.api_cliente_certificate_export(uuid) to service_role;

commit;

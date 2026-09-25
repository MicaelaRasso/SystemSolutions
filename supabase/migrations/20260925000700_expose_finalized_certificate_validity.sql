begin;

alter table public.certificados add column vigencia_hasta date;
create or replace function public.set_certificate_validity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.estado='finalizado' and old.estado is distinct from 'finalizado' then
    if new.fecha_ejecucion is null then raise exception using errcode='check_violation', message='A finalized certificate requires an execution date'; end if;
    new.vigencia_hasta := (new.fecha_ejecucion + interval '1 year')::date;
  end if;
  return new;
end;
$$;
create trigger certificados_validity_on_finalization before update of estado on public.certificados for each row execute function public.set_certificate_validity();

create or replace function public.api_finalized_certificate(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.certificados;
begin
  select * into c from public.certificados where id=certificate_id;
  if c.id is null or c.estado<>'finalizado' then raise exception using errcode='no_data_found', message='Finalized certificate not found'; end if;
  perform public.require_yacimiento_access(c.yacimiento_id);
  return jsonb_build_object('certificate',to_jsonb(c),'validity',jsonb_build_object('execution_date',c.fecha_ejecucion,'valid_until',c.vigencia_hasta,'is_valid',(current_date<=c.vigencia_hasta)),
    'signatures',coalesce((select jsonb_agg(to_jsonb(f)) from public.firmas_visita f where f.visita_id=c.visita_id),'[]'::jsonb));
end;
$$;
create or replace function public.api_valvula_certificates(target_valvula uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare yid uuid;
begin
  select p.yacimiento_id into yid from public.valvulas v join public.equipos_unidades e on e.id=v.equipo_id join public.plantas_locaciones p on p.id=e.planta_id where v.id=target_valvula;
  if yid is null then raise exception using errcode='no_data_found', message='Válvula not found'; end if;
  perform public.require_yacimiento_access(yid);
  return jsonb_build_object('certificates',coalesce((select jsonb_agg(jsonb_build_object('certificate',to_jsonb(c),'is_current',c.id=(select c2.id from public.certificados c2 where c2.valvula_id=target_valvula and c2.estado='finalizado' and current_date<=c2.vigencia_hasta order by c2.fecha_ejecucion desc,c2.finalized_at desc limit 1)) order by c.fecha_ejecucion desc nulls last,c.created_at desc) from public.certificados c where c.valvula_id=target_valvula),'[]'::jsonb));
end;
$$;
revoke all on function public.api_finalized_certificate(uuid), public.api_valvula_certificates(uuid) from public, anon, authenticated;
grant execute on function public.api_finalized_certificate(uuid), public.api_valvula_certificates(uuid) to authenticated;
commit;

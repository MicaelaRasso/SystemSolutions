begin;

create type public.estado_captura_certificado as enum ('abierto', 'cerrado');
create type public.estado_certificado as enum ('borrador', 'pendiente', 'finalizado');

create table public.valvula_revisiones (
  id uuid primary key default gen_random_uuid(),
  valvula_id uuid not null references public.valvulas(id),
  datos jsonb not null,
  created_at timestamptz not null default now()
);

create table public.certificados (
  id uuid primary key default gen_random_uuid(),
  orden_trabajo_id uuid not null unique references public.ordenes_trabajo(id),
  visita_id uuid not null references public.visitas_servicio(id),
  valvula_id uuid not null references public.valvulas(id),
  yacimiento_id uuid not null references public.yacimientos(id),
  planta_id uuid not null references public.plantas_locaciones(id),
  equipo_id uuid not null references public.equipos_unidades(id),
  valvula_revision_id uuid not null references public.valvula_revisiones(id),
  estado_captura public.estado_captura_certificado not null default 'abierto',
  estado public.estado_certificado not null default 'borrador',
  fecha_ejecucion date,
  tecnico_ejecutor text,
  datos_tecnicos jsonb not null default '{}'::jsonb,
  alcance_mantenimiento jsonb not null default '[]'::jsonb,
  repuestos jsonb not null default '{"catalog_version":"SYS_Certificado_Modelo1","items":[],"otros":null}'::jsonb,
  evidencia_fotografica jsonb not null default '{"desarmada":null,"ensamblada_prueba":null,"placa_precinto":null}'::jsonb,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((estado_captura = 'abierto' and estado = 'borrador') or estado_captura = 'cerrado')
);

alter table public.valvula_revisiones enable row level security;
alter table public.certificados enable row level security;
create index certificados_valvula_idx on public.certificados(valvula_id);

create or replace function public.api_certificate_validation(c public.certificados)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('complete', cardinality(array_remove(array[
    case when c.fecha_ejecucion is null then 'missing_execution_date' end,
    case when c.tecnico_ejecutor is null or btrim(c.tecnico_ejecutor) = '' then 'missing_executor' end,
    case when c.datos_tecnicos = '{}'::jsonb then 'missing_test_information' end
  ], null)) = 0, 'missing_fields', to_jsonb(array_remove(array[
    case when c.fecha_ejecucion is null then 'missing_execution_date' end,
    case when c.tecnico_ejecutor is null or btrim(c.tecnico_ejecutor) = '' then 'missing_executor' end,
    case when c.datos_tecnicos = '{}'::jsonb then 'missing_test_information' end
  ], null)));
$$;

create or replace function public.api_start_certificate_draft(work_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.ordenes_trabajo; v public.visitas_servicio; yid uuid; pid uuid; eid uuid; revision uuid; c public.certificados;
begin
  select * into o from public.ordenes_trabajo where id = work_order_id for update;
  if o.id is null or o.estado <> 'evaluada' then raise exception using errcode = 'check_violation', message = 'Only an evaluated work order can create a certificate draft'; end if;
  select * into v from public.api_assigned_visit(o.visita_id);
  if v.estado <> 'en_curso' then raise exception using errcode = 'check_violation', message = 'Certificate drafts can be started only while the visit is in progress'; end if;
  select p.yacimiento_id, p.id, e.id into yid, pid, eid from public.valvulas x join public.equipos_unidades e on e.id=x.equipo_id join public.plantas_locaciones p on p.id=e.planta_id where x.id=o.valvula_id;
  insert into public.valvula_revisiones(valvula_id, datos) select o.valvula_id, jsonb_build_object('tag', x.nombre) from public.valvulas x where x.id=o.valvula_id returning id into revision;
  insert into public.certificados(orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id, equipo_id, valvula_revision_id)
  values (o.id, o.visita_id, o.valvula_id, yid, pid, eid, revision)
  on conflict (orden_trabajo_id) do update set updated_at = public.certificados.updated_at
  returning * into c;
  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.api_update_certificate_draft(certificate_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.certificados; v public.visitas_servicio;
begin
  select * into c from public.certificados where id = certificate_id for update;
  if c.id is null then raise exception using errcode = 'no_data_found', message = 'Certificate draft not found'; end if;
  select * into v from public.api_assigned_visit(c.visita_id);
  if v.estado <> 'en_curso' or c.estado_captura <> 'abierto' then raise exception using errcode = 'check_violation', message = 'Certificate capture is closed'; end if;
  update public.certificados set
    fecha_ejecucion = coalesce((payload->>'fecha_ejecucion')::date, fecha_ejecucion),
    tecnico_ejecutor = coalesce(payload->>'tecnico_ejecutor', tecnico_ejecutor),
    datos_tecnicos = coalesce(payload->'datos_tecnicos', datos_tecnicos),
    alcance_mantenimiento = coalesce(payload->'alcance_mantenimiento', alcance_mantenimiento),
    repuestos = coalesce(payload->'repuestos', repuestos),
    evidencia_fotografica = coalesce(payload->'evidencia_fotografica', evidencia_fotografica),
    observaciones = coalesce(payload->>'observaciones', observaciones), updated_at = now()
  where id = certificate_id returning * into c;
  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

create or replace function public.api_certificate_draft(certificate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.certificados;
begin
  select * into c from public.certificados where id = certificate_id;
  if c.id is null then raise exception using errcode = 'no_data_found', message = 'Certificate not found'; end if;
  perform public.require_yacimiento_access(c.yacimiento_id);
  return jsonb_build_object('certificate', to_jsonb(c), 'validation', public.api_certificate_validation(c));
end;
$$;

revoke all on function public.api_certificate_validation(public.certificados), public.api_start_certificate_draft(uuid), public.api_update_certificate_draft(uuid, jsonb), public.api_certificate_draft(uuid) from public, anon, authenticated;
grant execute on function public.api_start_certificate_draft(uuid), public.api_update_certificate_draft(uuid, jsonb), public.api_certificate_draft(uuid) to authenticated;

commit;

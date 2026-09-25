begin;

create type public.parte_firma_visita as enum ('tecnico', 'cliente');
create table public.imagenes_certificado (
  id uuid primary key default gen_random_uuid(), bucket text not null, object_path text not null unique, categoria text not null,
  created_at timestamptz not null default now()
);
create table public.firmas_visita (
  id uuid primary key default gen_random_uuid(), visita_id uuid not null references public.visitas_servicio(id), parte public.parte_firma_visita not null,
  nombre_firmante text not null, cuenta_id uuid references public.cuentas(id), imagen_id uuid not null references public.imagenes_certificado(id),
  captured_at timestamptz not null default now(), unique(visita_id, parte)
);
create table public.contador_certificados (id boolean primary key default true check (id), siguiente_numero bigint not null default 1);
insert into public.contador_certificados(id) values (true) on conflict do nothing;
alter table public.certificados add column numero bigint unique, add column instantanea jsonb, add column finalized_at timestamptz;
alter table public.imagenes_certificado enable row level security;
alter table public.firmas_visita enable row level security;

create or replace function public.api_finalize_visit_certificates(target_visit uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.certificados; counter bigint; tech_exists boolean; client_exists boolean; finalized jsonb := '[]'::jsonb;
begin
  select exists(select 1 from public.firmas_visita where visita_id=target_visit and parte='tecnico') into tech_exists;
  select exists(select 1 from public.firmas_visita where visita_id=target_visit and parte='cliente') into client_exists;
  if not tech_exists or not client_exists then return finalized; end if;
  for c in select * from public.certificados where visita_id=target_visit and estado_captura='cerrado' and estado='pendiente' for update loop
    if not ((public.api_certificate_validation(c)->>'complete')::boolean) then continue; end if;
    update public.contador_certificados set siguiente_numero=siguiente_numero+1 where id=true returning siguiente_numero-1 into counter;
    update public.certificados set estado='finalizado', numero=counter, finalized_at=now(),
      instantanea=jsonb_build_object('valvula_revision_id', valvula_revision_id, 'datos', datos_tecnicos, 'repuestos', repuestos, 'evidencia', evidencia_fotografica)
    where id=c.id returning * into c;
    finalized := finalized || jsonb_build_array(to_jsonb(c));
  end loop;
  return finalized;
end;
$$;

create or replace function public.api_submit_visit_signature(target_visit uuid, signing_party public.parte_firma_visita, signer_name text, bucket_name text, asset_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio; image_id uuid; signature_id uuid; provider uuid;
begin
  perform public.require_authenticated_cuenta();
  select * into v from public.visitas_servicio where id=target_visit for update;
  if v.id is null or signer_name is null or btrim(signer_name)='' or bucket_name is null or asset_path is null then raise exception using errcode='invalid_parameter_value', message='A signature image and signer name are required'; end if;
  if signing_party='tecnico' then
    select taller_movil_id into provider from public.taller_cuentas where cuenta_id=auth.uid();
    if provider is null or provider<>v.taller_movil_id then raise exception using errcode='insufficient_privilege', message='Only an assigned Técnico can sign this visit'; end if;
  elsif not exists(select 1 from public.yacimientos y where y.id=v.yacimiento_id and y.cliente_cuenta_id=auth.uid()) then
    raise exception using errcode='insufficient_privilege', message='Only the owning Cliente can sign this visit';
  end if;
  insert into public.imagenes_certificado(bucket,object_path,categoria) values(bucket_name,asset_path,'firma_'||signing_party::text) returning id into image_id;
  insert into public.firmas_visita(visita_id,parte,nombre_firmante,cuenta_id,imagen_id) values(target_visit,signing_party,btrim(signer_name),auth.uid(),image_id) returning id into signature_id;
  return jsonb_build_object('signature_id',signature_id,'finalized_certificates',public.api_finalize_visit_certificates(target_visit));
exception when unique_violation then raise exception using errcode='check_violation', message='A visit signature cannot be replaced';
end;
$$;

create or replace function public.api_complete_visit(visit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitas_servicio;
begin
  select * into v from public.api_assigned_visit(visit_id);
  if v.estado <> 'en_curso' then raise exception using errcode='check_violation', message='Only an in-progress visit can be completed'; end if;
  if not exists(select 1 from public.firmas_visita where visita_id=visit_id and parte='tecnico') then raise exception using errcode='check_violation', message='A Técnico signature is required to complete a visit'; end if;
  update public.visitas_servicio set estado='completada', updated_at=now() where id=visit_id;
  update public.certificados set estado_captura='cerrado', estado='pendiente', updated_at=now() where visita_id=visit_id and estado_captura='abierto';
  delete from public.visita_equipos where visita_id=visit_id;
  perform public.api_finalize_visit_certificates(visit_id);
  return public.api_visit(visit_id);
end;
$$;

revoke all on function public.api_finalize_visit_certificates(uuid), public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text) from public, anon, authenticated;
grant execute on function public.api_submit_visit_signature(uuid, public.parte_firma_visita, text, text, text) to authenticated;
commit;

begin;

-- An authorization is a durable link between the historical certificate and
-- the new, ordinary service lifecycle. The replacement certificate is created
-- only when the assigned Taller Móvil starts evaluating the new work order.
create table public.correcciones_certificado (
  id uuid primary key default gen_random_uuid(),
  certificado_origen_id uuid not null references public.certificados(id),
  solicitud_id uuid not null unique references public.solicitudes_servicio(id),
  visita_id uuid not null unique references public.visitas_servicio(id),
  orden_trabajo_id uuid not null unique references public.ordenes_trabajo(id),
  autorizado_por uuid not null references public.cuentas(id),
  motivo text not null check (btrim(motivo) <> ''),
  autorizada_en timestamptz not null default now()
);

create index correcciones_certificado_origen_idx
  on public.correcciones_certificado(certificado_origen_id, autorizada_en desc);
alter table public.correcciones_certificado enable row level security;
revoke all on public.correcciones_certificado from public, anon, authenticated;

create or replace function public.prevent_correction_authorization_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception using errcode = 'check_violation', message = 'Certificate correction authorization is immutable';
end;
$$;
create trigger correcciones_certificado_append_only
before update or delete on public.correcciones_certificado for each row
execute function public.prevent_correction_authorization_mutation();

create or replace function public.api_authorize_certificate_correction(
  source_certificate_id uuid,
  provider_id uuid,
  visit_starts_at timestamptz,
  visit_ends_at timestamptz,
  action_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  source public.certificados;
  owner_id uuid;
  request_id uuid;
  new_visit_id uuid;
  new_order_id uuid;
  authorization_id uuid;
begin
  perform public.require_authenticated_cuenta();
  if not exists (
    select 1 from public.cuentas
    where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can authorize a certificate correction';
  end if;
  if nullif(btrim(action_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'A correction reason is required';
  end if;

  select * into source from public.certificados where id = source_certificate_id;
  if source.id is null or source.estado_captura <> 'cerrado' then
    raise exception using errcode = 'check_violation', message = 'Only a closed certificate can be corrected';
  end if;
  select cliente_cuenta_id into owner_id from public.yacimientos where id = source.yacimiento_id;

  request_id := (public.api_admin_create_service_request(
    owner_id, source.yacimiento_id,
    jsonb_build_array(jsonb_build_object('kind', 'valvula', 'id', source.valvula_id))
  )->'request'->>'id')::uuid;
  new_visit_id := (public.api_schedule_visit(
    request_id, provider_id, visit_starts_at, visit_ends_at
  )->'visit'->>'id')::uuid;
  select id into strict new_order_id from public.ordenes_trabajo where visita_id = new_visit_id;

  insert into public.correcciones_certificado(
    certificado_origen_id, solicitud_id, visita_id, orden_trabajo_id,
    autorizado_por, motivo
  ) values (
    source.id, request_id, new_visit_id, new_order_id, auth.uid(), btrim(action_reason)
  ) returning id into authorization_id;

  perform public.record_audit_event(
    'certificado_correccion_autorizada', 'certificado', source.id, 'exitoso',
    jsonb_build_object('motivo', btrim(action_reason)),
    jsonb_build_object('correccion_id', authorization_id, 'solicitud_id', request_id,
      'visita_id', new_visit_id, 'orden_trabajo_id', new_order_id),
    null, null, owner_id, source.yacimiento_id, new_visit_id, source.id
  );
  return jsonb_build_object(
    'correction_id', authorization_id, 'source_certificate_id', source.id,
    'request_id', request_id, 'visit_id', new_visit_id, 'work_order_id', new_order_id,
    'reason', btrim(action_reason)
  );
end;
$$;

-- Link the draft to its authorized source at creation. This keeps the normal
-- visit, signature, and finalization paths in force for corrections.
create or replace function public.link_authorized_certificate_correction()
returns trigger language plpgsql security definer set search_path = public as $$
declare authorization public.correcciones_certificado;
begin
  select * into authorization from public.correcciones_certificado
  where orden_trabajo_id = new.orden_trabajo_id;
  if authorization.id is not null then
    if new.visita_id <> authorization.visita_id or
       new.valvula_id <> (select valvula_id from public.certificados where id = authorization.certificado_origen_id) then
      raise exception using errcode = 'check_violation', message = 'Correction certificate must keep its authorized visit and Válvula';
    end if;
    new.reemplaza_certificado_id := authorization.certificado_origen_id;
    new.motivo_reemplazo := authorization.motivo;
  end if;
  return new;
end;
$$;

create trigger certificados_link_authorized_correction
before insert on public.certificados for each row
execute function public.link_authorized_certificate_correction();

-- The legacy low-level replacement RPC must not authorize an arbitrary
-- certificate/work-order pairing. Authorization happens through the command
-- above before the replacement work order can be evaluated.
create or replace function public.api_create_certificate_replacement(
  source_certificate_id uuid, work_order_id uuid, reason text default 'correccion'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare authorization public.correcciones_certificado;
begin
  select * into authorization from public.correcciones_certificado
  where orden_trabajo_id = work_order_id
    and certificado_origen_id = source_certificate_id;
  if authorization.id is null or btrim(coalesce(reason, '')) <> authorization.motivo then
    raise exception using errcode = 'insufficient_privilege', message = 'Certificate correction must be authorized by an Administrador';
  end if;
  return public.api_start_certificate_draft(work_order_id, gen_random_uuid());
end;
$$;

revoke all on function public.api_authorize_certificate_correction(uuid, uuid, timestamptz, timestamptz, text),
  public.link_authorized_certificate_correction(),
  public.prevent_correction_authorization_mutation(),
  public.api_create_certificate_replacement(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_authorize_certificate_correction(uuid, uuid, timestamptz, timestamptz, text),
  public.api_create_certificate_replacement(uuid, uuid, text) to service_role;

commit;

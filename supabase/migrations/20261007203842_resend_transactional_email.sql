begin;

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('certificate_expiry', 'pending_signature')),
  certificate_id uuid references public.certificados(id),
  visit_id uuid references public.visitas_servicio(id),
  client_id uuid not null references public.cuentas(id),
  recipient_email text,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','smtp_accepted','failed','uncertain','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz default now(),
  last_error text,
  smtp_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((notification_type = 'certificate_expiry' and certificate_id is not null and visit_id is null)
      or (notification_type = 'pending_signature' and visit_id is not null and certificate_id is null))
);

create unique index email_delivery_certificate_once_idx
  on public.email_deliveries(certificate_id) where notification_type = 'certificate_expiry';
create unique index email_delivery_visit_once_idx
  on public.email_deliveries(visit_id) where notification_type = 'pending_signature';
create index email_deliveries_queue_idx on public.email_deliveries(next_attempt_at, created_at)
  where status = 'queued';
create index email_deliveries_admin_idx on public.email_deliveries(created_at desc, id desc);
alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from public, anon, authenticated;
grant select, insert, update on public.email_deliveries to service_role;

create or replace function public.enqueue_pending_signature_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_visit uuid;
  client_id uuid;
  destination text;
  deposit_name text;
  affected_plants jsonb;
begin
  for target_visit in
    select distinct n.visita_id
    from new_certificates n
    join public.visitas_servicio v on v.id = n.visita_id and v.estado = 'completada'
    where n.estado = 'pendiente'
  loop
    if exists (select 1 from public.firmas_visita f where f.visita_id = target_visit and f.parte = 'cliente') then
      continue;
    end if;
    if not exists (select 1 from public.certificados c where c.visita_id = target_visit and c.estado = 'pendiente') then
      continue;
    end if;

    select y.cliente_cuenta_id, y.nombre into client_id, deposit_name
    from public.visitas_servicio v join public.yacimientos y on y.id = v.yacimiento_id
    where v.id = target_visit;
    select u.email into destination from auth.users u where u.id = client_id;
    select coalesce(jsonb_agg(distinct p.nombre order by p.nombre), '[]'::jsonb)
      into affected_plants
    from public.certificados c
    join public.plantas_locaciones p on p.id = c.planta_id
    where c.visita_id = target_visit and c.estado = 'pendiente';

    insert into public.email_deliveries(
      notification_type, visit_id, client_id, recipient_email, subject, payload,
      status, next_attempt_at, last_error
    ) values (
      'pending_signature', target_visit, client_id, destination,
      'Certificados pendientes de firma — ' || coalesce(deposit_name, 'System Solutions'),
      jsonb_build_object('yacimiento', deposit_name, 'plantas', affected_plants,
        'portal_url', '/portal/certificados'),
      case when destination is null then 'failed' else 'queued' end,
      case when destination is null then null else now() end,
      case when destination is null then 'No email address is registered for the Cliente account' else null end
    ) on conflict (visit_id) where notification_type = 'pending_signature' do nothing;
  end loop;
  return null;
end;
$$;

create trigger certificate_pending_signature_email
  after update on public.certificados
  referencing new table as new_certificates
  for each statement execute function public.enqueue_pending_signature_email();

create or replace function public.api_enqueue_expiring_certificate_emails()
returns integer language plpgsql security definer set search_path = public as $$
declare
  inserted_count integer;
  argentina_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt', true), '')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise insufficient_privilege using message = 'Service role required';
  end if;

  insert into public.email_deliveries(
    notification_type, certificate_id, client_id, recipient_email, subject,
    payload, status, next_attempt_at, last_error
  )
  select 'certificate_expiry', c.id, y.cliente_cuenta_id, u.email,
    'Próximo vencimiento de certificado — ' || y.nombre,
    jsonb_build_object('numero', c.numero, 'vigencia_hasta', c.vigencia_hasta,
      'yacimiento', y.nombre, 'planta', p.nombre, 'portal_url', '/portal/certificados'),
    case when u.email is null then 'failed' else 'queued' end,
    case when u.email is null then null else now() end,
    case when u.email is null then 'No email address is registered for the Cliente account' else null end
  from public.certificados c
  join public.yacimientos y on y.id = c.yacimiento_id
  join public.plantas_locaciones p on p.id = c.planta_id
  join public.clientes cl on cl.cuenta_id = y.cliente_cuenta_id and cl.aviso_vencimiento
  left join auth.users u on u.id = y.cliente_cuenta_id
  where c.estado = 'finalizado'
    and c.vigencia_hasta <= argentina_today + 30
    and c.vigencia_hasta >= argentina_today
  on conflict (certificate_id) where notification_type = 'certificate_expiry' do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.api_claim_email_deliveries(batch_size integer default 20)
returns setof public.email_deliveries language plpgsql security definer set search_path = public as $$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt', true), '')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise insufficient_privilege using message = 'Service role required';
  end if;
  update public.email_deliveries
  set status = 'uncertain', next_attempt_at = null,
      last_error = 'Worker stopped before recording the SMTP outcome; review before retrying', updated_at = now()
  where status = 'sending' and updated_at < now() - interval '10 minutes';
  return query
  with candidates as (
    select d.id from public.email_deliveries d
    where d.status = 'queued' and d.next_attempt_at <= now()
    order by case when d.notification_type = 'pending_signature' then 0 else 1 end,
      d.next_attempt_at, d.created_at
    for update skip locked limit greatest(1, least(batch_size, 100))
  )
  update public.email_deliveries d
  set status = 'sending', attempt_count = d.attempt_count + 1,
      next_attempt_at = null, updated_at = now()
  from candidates c where d.id = c.id
  returning d.*;
end;
$$;

create or replace function public.api_record_email_delivery_result(
  delivery_id uuid, delivery_status text, response_text text default null,
  error_text text default null, retryable boolean default false
)
returns public.email_deliveries language plpgsql security definer set search_path = public as $$
declare d public.email_deliveries;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt', true), '')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise insufficient_privilege using message = 'Service role required';
  end if;
  if delivery_status not in ('smtp_accepted', 'failed', 'uncertain') then
    raise invalid_parameter_value using message = 'Unsupported delivery result';
  end if;
  update public.email_deliveries
  set status = case when delivery_status = 'failed' and retryable and attempt_count < 5 then 'queued' else delivery_status end,
      smtp_response = left(response_text, 2000), last_error = left(error_text, 2000),
      next_attempt_at = case when delivery_status = 'failed' and retryable and attempt_count < 5
        then now() + make_interval(secs => least(3600, 60 * power(2, greatest(attempt_count - 1, 0))::integer))
        else null end,
      updated_at = now()
  where id = delivery_id and status = 'sending'
  returning * into d;
  if d.id is null then raise no_data_found using message = 'Sending email delivery not found'; end if;
  return d;
end;
$$;

create or replace function public.api_email_deliveries(
  requested_status text default null, requested_type text default null,
  limit_count integer default 50, offset_count integer default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid; rows jsonb; total_count integer;
begin
  perform public.require_systemsolutions_edge_gateway();
  actor := auth.uid();
  if not exists(select 1 from public.cuentas where id = actor and rol = 'super_administrador' and estado = 'activa') then
    raise insufficient_privilege using message = 'Súper Administrador role required';
  end if;
  select count(*) into total_count from public.email_deliveries d
    where (requested_status is null or d.status = requested_status)
      and (requested_type is null or d.notification_type = requested_type);
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc), '[]'::jsonb) into rows
  from (select d.id, d.notification_type, d.certificate_id, d.visit_id, d.client_id,
      d.recipient_email, d.subject, d.status, d.attempt_count, d.next_attempt_at,
      d.last_error, d.smtp_response, d.created_at, d.updated_at
    from public.email_deliveries d
    where (requested_status is null or d.status = requested_status)
      and (requested_type is null or d.notification_type = requested_type)
    order by d.created_at desc, d.id desc
    limit greatest(1, least(limit_count, 100)) offset greatest(offset_count, 0)) page;
  return jsonb_build_object('items', rows, 'total', total_count,
    'limit', greatest(1, least(limit_count, 100)), 'offset', greatest(offset_count, 0));
end;
$$;

create or replace function public.api_email_delivery(delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid; result jsonb;
begin
  perform public.require_systemsolutions_edge_gateway();
  actor := auth.uid();
  if not exists(select 1 from public.cuentas where id = actor and rol = 'super_administrador' and estado = 'activa') then
    raise insufficient_privilege using message = 'Súper Administrador role required';
  end if;
  select to_jsonb(d) into result from public.email_deliveries d where d.id = delivery_id;
  if result is null then raise no_data_found using message = 'Email delivery not found'; end if;
  return result;
end;
$$;

create or replace function public.api_retry_email_delivery(delivery_id uuid, retry_reason text)
returns public.email_deliveries language plpgsql security definer set search_path = public as $$
declare actor uuid; d public.email_deliveries;
begin
  perform public.require_systemsolutions_edge_gateway();
  actor := auth.uid();
  if not exists(select 1 from public.cuentas where id = actor and rol = 'super_administrador' and estado = 'activa') then
    raise insufficient_privilege using message = 'Súper Administrador role required';
  end if;
  if retry_reason is null or length(btrim(retry_reason)) < 5 or length(retry_reason) > 500 then
    raise invalid_parameter_value using message = 'A retry reason of 5 to 500 characters is required';
  end if;
  update public.email_deliveries e set status = 'queued', next_attempt_at = now(),
    recipient_email = (select u.email from auth.users u where u.id = e.client_id),
    last_error = null, smtp_response = null, updated_at = now()
  where e.id = delivery_id and e.status in ('failed', 'uncertain')
  returning e.* into d;
  if d.id is null then raise check_violation using message = 'Only failed or uncertain deliveries can be retried'; end if;
  perform public.record_audit_event('correo_transaccional_reintento', 'email_delivery', d.id, 'exitoso',
    jsonb_build_object('reason', btrim(retry_reason), 'notification_type', d.notification_type),
    jsonb_build_object('attempt_count', d.attempt_count), null, null, d.client_id, null, d.visit_id, d.certificate_id);
  return d;
end;
$$;

revoke all on function public.api_enqueue_expiring_certificate_emails(),
  public.api_claim_email_deliveries(integer),
  public.api_record_email_delivery_result(uuid,text,text,text,boolean),
  public.api_email_deliveries(text,text,integer,integer),
  public.api_email_delivery(uuid),
  public.api_retry_email_delivery(uuid,text) from public, anon, authenticated;
revoke all on function public.enqueue_pending_signature_email() from public, anon, authenticated;
grant execute on function public.api_enqueue_expiring_certificate_emails(),
  public.api_claim_email_deliveries(integer),
  public.api_record_email_delivery_result(uuid,text,text,text,boolean) to service_role;
grant execute on function public.api_email_deliveries(text,text,integer,integer),
  public.api_email_delivery(uuid),
  public.api_retry_email_delivery(uuid,text) to service_role;

commit;

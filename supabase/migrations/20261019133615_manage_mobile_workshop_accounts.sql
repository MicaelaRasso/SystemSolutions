begin;

create or replace function public.api_authorize_workshop_account(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_role public.rol;
  target_account uuid;
  target_email text;
  target_workshop uuid;
  workshop_name text;
  workshop_color text;
  workshop_active boolean;
begin
  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid() and c.estado = 'activa';

  if actor_role is null or actor_role not in ('administrador_regular', 'super_administrador') then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can manage Taller Móvil accounts'));
  end if;

  select c.id, u.email, tc.taller_movil_id, t.nombre, t.color, t.activo
    into target_account, target_email, target_workshop, workshop_name, workshop_color, workshop_active
  from public.cuentas c
  join public.taller_cuentas tc on tc.cuenta_id = c.id
  join public.talleres_moviles t on t.id = tc.taller_movil_id
  join auth.users u on u.id = c.id
  where tc.taller_movil_id = target and c.rol = 'taller_movil'
  order by tc.created_at desc
  limit 1;

  if target_account is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Taller Móvil account was not found'));
  end if;

  return jsonb_build_object('data', jsonb_build_object(
    'account_id', target_account,
    'email', target_email,
    'workshop_id', target_workshop,
    'workshop_name', workshop_name,
    'workshop_color', workshop_color,
    'workshop_active', workshop_active
  ), 'error', null);
end;
$$;

create or replace function public.api_record_workshop_account_event(
  target uuid,
  action_name text,
  event_outcome text default 'exitoso',
  event_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol;
begin
  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid() and c.estado = 'activa';

  if actor_role is null or actor_role not in ('administrador_regular', 'super_administrador') then
    raise exception using errcode = '42501', message = 'Only an active Administrador can manage Taller Móvil accounts';
  end if;
  if action_name is null or action_name not in ('email_change_requested', 'account_deleted')
    or event_outcome is null or event_outcome not in ('exitoso', 'fallido', 'solicitado') then
    raise exception using errcode = '22023', message = 'Unsupported Taller Móvil account event';
  end if;
  if coalesce(event_details, '{}'::jsonb)::text ~* '"(password|new_password|access_token|refresh_token|token|authorization)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'Credentials and tokens cannot be audited';
  end if;
  if action_name = 'email_change_requested' and not exists (
    select 1 from public.cuentas c
    join public.taller_cuentas tc on tc.cuenta_id = c.id
    where c.id = target and c.rol = 'taller_movil'
  ) then
    raise exception using errcode = 'P0002', message = 'Taller Móvil account was not found';
  end if;

  return public.record_audit_event(
    action_name, 'cuenta', target,
    case when event_outcome = 'solicitado' then 'exitoso' else event_outcome end,
    coalesce(event_details, '{}'::jsonb) || case when event_outcome = 'solicitado' then '{"status":"solicitado"}'::jsonb else '{}'::jsonb end,
    '{}'
  );
end;
$$;

revoke all on function public.api_authorize_workshop_account(uuid),
  public.api_record_workshop_account_event(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_authorize_workshop_account(uuid),
  public.api_record_workshop_account_event(uuid, text, text, jsonb)
  to service_role;

commit;

begin;

-- Preserve the state each account had before a parent Cliente or Taller Móvil
-- was disabled. Reactivation can then restore pending accounts as pending.
alter table public.cuentas
  add column suspendida_por_padre boolean not null default false,
  add column estado_previo_padre public.estado_cuenta;

create or replace function public.sync_parent_account_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  linked_account_ids uuid[];
begin
  if tg_table_name = 'clientes' then
    linked_account_ids := array(
      select cc.cuenta_id from public.cliente_cuentas cc where cc.cliente_cuenta_id = new.cuenta_id
      union select new.cuenta_id
    );
  else
    linked_account_ids := array(
      select tc.cuenta_id from public.taller_cuentas tc where tc.taller_movil_id = new.id
    );
  end if;

  if new.activo is false and old.activo is distinct from false then
    update public.cuentas c
    set estado_previo_padre = c.estado,
        suspendida_por_padre = true,
        estado = 'deshabilitada'
    where c.id = any(linked_account_ids)
      and not c.suspendida_por_padre
      and c.estado <> 'deshabilitada';
  elsif new.activo is true and old.activo is distinct from true then
    update public.cuentas c
    set estado = case
          when c.estado_previo_padre = 'pendiente' and exists (
            select 1 from auth.users u where u.id = c.id and u.email_confirmed_at is not null
              and nullif(u.encrypted_password, '') is not null
          ) then 'activa'::public.estado_cuenta
          else coalesce(c.estado_previo_padre, 'pendiente'::public.estado_cuenta)
        end,
        estado_previo_padre = null,
        suspendida_por_padre = false
    where c.id = any(linked_account_ids)
      and c.suspendida_por_padre;
  end if;
  return new;
end;
$$;

drop trigger if exists clientes_sync_account_access on public.clientes;
create trigger clientes_sync_account_access
after update of activo on public.clientes
for each row when (old.activo is distinct from new.activo)
execute function public.sync_parent_account_access();

drop trigger if exists talleres_sync_account_access on public.talleres_moviles;
create trigger talleres_sync_account_access
after update of activo on public.talleres_moviles
for each row when (old.activo is distinct from new.activo)
execute function public.sync_parent_account_access();

revoke all on function public.sync_parent_account_access() from public, anon, authenticated, service_role;

create or replace function public.api_authorize_admin_account_create(account_email text, account_role public.rol)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol;
begin
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid() and c.estado = 'activa';
  if actor_role not in ('administrador_regular', 'super_administrador') or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can provision accounts'));
  end if;
  if account_role not in ('administrador_regular', 'super_administrador') then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_role', 'message', 'Target role must be an administrator role'));
  end if;
  if actor_role <> 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can provision administrator accounts'));
  end if;
  if account_email is null or btrim(account_email) = '' or position('@' in account_email) < 2 then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_email', 'message', 'A valid email is required'));
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = lower(btrim(account_email))) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'duplicate_email', 'message', 'An account already uses this email'));
  end if;
  return jsonb_build_object('data', true, 'error', null);
end;
$$;

-- Preflight for Cliente and Taller Móvil invitation routes, before Auth sends
-- any email or creates a provisional identity.
create or replace function public.api_authorize_account_provisioning(account_kind text, target_client uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if not exists (
    select 1 from public.cuentas c where c.id = auth.uid()
      and c.estado = 'activa' and c.rol in ('administrador_regular', 'super_administrador')
  ) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can provision accounts'));
  end if;
  if account_kind = 'cliente' then
    if target_client is null or not exists (
      select 1 from public.clientes c where c.cuenta_id = target_client and c.activo
    ) then
      return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'An active Cliente is required'));
    end if;
  elsif account_kind not in ('taller_movil', 'cliente_root') or target_client is not null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_role', 'message', 'Unsupported account kind'));
  end if;
  return jsonb_build_object('data', true, 'error', null);
end;
$$;

create or replace function public.api_register_client_account(account_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.cuentas c where c.id = auth.uid()
      and c.rol in ('administrador_regular', 'super_administrador') and c.estado = 'activa'
  ) then
    raise exception using errcode = '42501', message = 'Only an active Administrador can create a Cliente account';
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, 'cliente', 'pendiente', false);
end;
$$;

create or replace function public.api_admin_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; result jsonb;
begin
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid() and c.estado = 'activa';
  if actor_role not in ('administrador_regular', 'super_administrador') or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can list administrator accounts'));
  end if;
  if actor_role <> 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can list administrator accounts'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'email', u.email,
    'nombre', coalesce(u.raw_user_meta_data->>'nombre', ''),
    'apellido', coalesce(u.raw_user_meta_data->>'apellido', ''),
    'rol', c.rol, 'activo', c.activo, 'estado', c.estado,
    'creado_en', c.created_at
  ) order by coalesce(u.raw_user_meta_data->>'apellido', ''), coalesce(u.raw_user_meta_data->>'nombre', ''), u.email), '[]'::jsonb)
  into result
  from public.cuentas c join auth.users u on u.id = c.id
  where c.rol in ('administrador_regular', 'super_administrador');
  return jsonb_build_object('data', result, 'error', null);
end;
$$;

create or replace function public.api_create_admin_account(account_id uuid, account_role public.rol)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; account_email text; account_data jsonb;
begin
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid() and c.estado = 'activa';
  if actor_role <> 'super_administrador' or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can create administrator accounts'));
  end if;
  if account_role not in ('administrador_regular', 'super_administrador') then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_role', 'message', 'Target role must be an administrator role'));
  end if;
  select u.email into account_email from auth.users u where u.id = account_id;
  if account_email is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Invited Auth identity was not found'));
  end if;
  if exists (select 1 from public.cuentas c where c.id = account_id) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'duplicate_email', 'message', 'Cuenta already exists'));
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, account_role, 'pendiente', false);
  select jsonb_build_object('id', c.id, 'email', account_email, 'nombre', coalesce(u.raw_user_meta_data->>'nombre', ''),
    'apellido', coalesce(u.raw_user_meta_data->>'apellido', ''), 'rol', c.rol, 'activo', c.activo, 'estado', c.estado,
    'creado_en', c.created_at) into account_data
  from public.cuentas c join auth.users u on u.id = c.id where c.id = account_id;
  return jsonb_build_object('data', account_data, 'error', null);
end;
$$;

create or replace function public.api_update_admin_account(target uuid, account_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; target_role public.rol; setup_complete boolean; result jsonb;
begin
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid() and c.estado = 'activa';
  if actor_role not in ('administrador_regular', 'super_administrador') or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can update accounts'));
  end if;
  select c.rol into target_role from public.cuentas c where c.id = target;
  if target_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Administrator account was not found'));
  end if;
  if target_role not in ('administrador_regular', 'super_administrador') then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_role', 'message', 'Target is not an administrator account'));
  end if;
  if actor_role <> 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can update administrator accounts'));
  end if;
  if target = auth.uid() and not account_active then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'An administrator cannot disable its own account'));
  end if;
  if account_active then
    select u.email_confirmed_at is not null and nullif(u.encrypted_password, '') is not null
      into setup_complete from auth.users u where u.id = target;
    update public.cuentas set estado = case when setup_complete then 'activa'::public.estado_cuenta else 'pendiente'::public.estado_cuenta end where id = target;
  else
    update public.cuentas set estado = 'deshabilitada' where id = target;
  end if;
  select jsonb_build_object('id', c.id, 'email', u.email, 'nombre', coalesce(u.raw_user_meta_data->>'nombre', ''),
    'apellido', coalesce(u.raw_user_meta_data->>'apellido', ''), 'rol', c.rol, 'activo', c.activo, 'estado', c.estado,
    'creado_en', c.created_at) into result
  from public.cuentas c join auth.users u on u.id = c.id where c.id = target;
  return jsonb_build_object('data', result, 'error', null);
end;
$$;

create or replace function public.api_admin_recovery_email(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; target_role public.rol; target_email text;
begin
  select c.rol into actor_role from public.cuentas c where c.id = auth.uid() and c.estado = 'activa';
  if actor_role not in ('administrador_regular', 'super_administrador') or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can initiate recovery'));
  end if;
  select c.rol, u.email into target_role, target_email
  from public.cuentas c join auth.users u on u.id = c.id where c.id = target;
  if target_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Account was not found'));
  end if;
  if target_role in ('administrador_regular', 'super_administrador') and actor_role <> 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can recover administrator accounts'));
  end if;
  return jsonb_build_object('data', jsonb_build_object('email', target_email), 'error', null);
end;
$$;

-- Return only an eligible pending invitation after checking the caller and
-- its parent. The Edge route uses this email with Auth's /invite endpoint,
-- which renews an existing unconfirmed identity.
create or replace function public.api_pending_invitation_target(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; target_role public.rol; target_state public.estado_cuenta;
  target_email text; confirmed_at timestamptz;
begin
  select c.rol into actor_role from public.cuentas c
  where c.id = auth.uid() and c.estado = 'activa';
  if actor_role not in ('administrador_regular', 'super_administrador') or actor_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Administrador can resend invitations'));
  end if;
  select c.rol, c.estado, u.email, u.email_confirmed_at
    into target_role, target_state, target_email, confirmed_at
  from public.cuentas c join auth.users u on u.id = c.id where c.id = target;
  if target_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Account was not found'));
  end if;
  if target_role in ('administrador_regular', 'super_administrador') and actor_role <> 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only a Súper administrador can resend administrator invitations'));
  end if;
  if target_state <> 'pendiente' or confirmed_at is not null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an unconfirmed pending account can be reinvited'));
  end if;
  if target_role = 'cliente' and not exists (
    select 1 from public.clientes cl where cl.cuenta_id = target and cl.activo
    union all
    select 1 from public.cliente_cuentas cc
      join public.clientes cl on cl.cuenta_id = cc.cliente_cuenta_id
    where cc.cuenta_id = target and cl.activo
  ) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'An active Cliente is required'));
  end if;
  if target_role = 'taller_movil' and not exists (
    select 1 from public.taller_cuentas tc
      join public.talleres_moviles tm on tm.id = tc.taller_movil_id
    where tc.cuenta_id = target and tm.activo
  ) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'An active Taller Móvil is required'));
  end if;
  return jsonb_build_object('data', jsonb_build_object('id', target, 'email', target_email), 'error', null);
end;
$$;

-- Record account-auth lifecycle events through a narrow allowlist. Callers
-- cannot submit credentials, tokens, or arbitrary audit action names.
create or replace function public.api_record_auth_event(
  action_name text,
  target_account uuid default null,
  event_outcome text default 'exitoso',
  event_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_role public.rol; actor_state public.estado_cuenta; target_role public.rol;
  allowed_actions constant text[] := array[
    'account_invited', 'account_invitation_resent', 'account_invitation_accepted',
    'account_password_reset_requested', 'account_email_changed', 'account_enabled',
    'account_disabled', 'account_reactivated', 'account_sessions_revoked', 'account_admin_denied',
    'email_change_requested', 'password_recovery_requested'
  ];
begin
  select c.rol, c.estado into actor_role, actor_state from public.cuentas c where c.id = auth.uid();
  if auth.uid() is null or actor_role is null then
    raise exception using errcode = '42501', message = 'An authenticated account actor is required';
  end if;
  if actor_state <> 'activa' then
    raise exception using errcode = '42501', message = 'An active account actor is required';
  end if;
  if action_name <> all(allowed_actions) or event_outcome not in ('exitoso', 'fallido', 'solicitado') then
    raise exception using errcode = '22023', message = 'Unsupported account security audit event';
  end if;
  if coalesce(event_details, '{}'::jsonb)::text ~* '"(password|new_password|access_token|refresh_token|token|authorization)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'Credentials and tokens cannot be audited';
  end if;
  if action_name = 'email_change_requested' and target_account is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Email changes can only be audited for the requesting account';
  end if;
  if action_name in ('account_invitation_resent', 'account_password_reset_requested', 'password_recovery_requested') then
    if actor_role not in ('administrador_regular', 'super_administrador') then
      raise exception using errcode = '42501', message = 'Only an Administrador can initiate account recovery';
    end if;
    select c.rol into target_role from public.cuentas c where c.id = target_account;
    if target_role in ('administrador_regular', 'super_administrador') and actor_role <> 'super_administrador' then
      raise exception using errcode = '42501', message = 'Only a Súper administrador can recover an administrator account';
    end if;
  end if;
  return public.record_audit_event(
    action_name, 'cuenta', target_account,
    case when event_outcome = 'solicitado' then 'exitoso' else event_outcome end,
    coalesce(event_details, '{}'::jsonb) || case when event_outcome = 'solicitado' then '{"status":"solicitado"}'::jsonb else '{}'::jsonb end,
    '{}'::jsonb
  );
end;
$$;

-- Replace the generic Cuenta row audit hook with one canonical lifecycle event
-- per insert or state transition. Other business-table events keep Phase 2's
-- generic audit trigger unchanged.
create or replace function public.audit_cuenta_security_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare action_name text; outcome text := 'exitoso';
begin
  if tg_op = 'INSERT' then
    action_name := 'account_invited';
  elsif old.estado is distinct from new.estado then
    action_name := case
      when new.estado = 'deshabilitada' then 'account_disabled'
      when old.estado = 'deshabilitada' and new.estado = 'activa' then 'account_reactivated'
      when old.estado = 'pendiente' and new.estado = 'activa' then 'account_invitation_accepted'
      when new.estado = 'activa' then 'account_enabled'
      else null
    end;
  else
    return new;
  end if;
  if action_name is null then return new; end if;
  if tg_op = 'UPDATE' and old.estado = 'pendiente' and new.estado = 'activa' and auth.uid() is null then
    perform set_config('request.jwt.claim.sub', new.id::text, true);
  end if;
  perform public.record_audit_event(
    action_name, 'cuenta', new.id, outcome,
    jsonb_build_object(
      'rol', new.rol,
      'estado_anterior', case when tg_op = 'UPDATE' then old.estado else null end,
      'estado_nuevo', new.estado
    ), '{}'::jsonb
  );
  return new;
end;
$$;
drop trigger if exists cuentas_audit_change on public.cuentas;
create trigger cuentas_security_audit
after insert or update of estado on public.cuentas
for each row execute function public.audit_cuenta_security_change();
revoke all on function public.audit_cuenta_security_change() from public, anon, authenticated, service_role;

-- An invitation is accepted after Auth confirms the email and the owner sets
-- a password. The Cuenta stays pending between those two steps.
create or replace function public.activate_pending_cuenta_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare account_row public.cuentas%rowtype; parent_enabled boolean := true;
begin
  if (old.email_confirmed_at is null or nullif(old.encrypted_password, '') is null)
    and new.email_confirmed_at is not null
    and nullif(new.encrypted_password, '') is not null then
    select * into account_row from public.cuentas where id = new.id;
    if account_row.id is null then return new; end if;
    if account_row.rol = 'cliente' then
      select not exists (
        select 1 from public.clientes p where p.cuenta_id = account_row.id and not p.activo
        union all
        select 1 from public.cliente_cuentas cc join public.clientes p on p.cuenta_id = cc.cliente_cuenta_id
        where cc.cuenta_id = account_row.id and not p.activo
      ) into parent_enabled;
    elsif account_row.rol = 'taller_movil' then
      select not exists (
        select 1 from public.taller_cuentas tc join public.talleres_moviles t on t.id = tc.taller_movil_id
        where tc.cuenta_id = account_row.id and not t.activo
      ) into parent_enabled;
    end if;
    if auth.uid() is null then perform set_config('request.jwt.claim.sub', new.id::text, true); end if;
    if account_row.estado = 'pendiente' and parent_enabled then
      update public.cuentas set estado = 'activa' where id = new.id;
    elsif account_row.estado = 'deshabilitada' then
      perform public.record_audit_event(
        'account_invitation_accepted', 'cuenta', new.id, 'exitoso',
        jsonb_build_object('parent_access_suspended', not parent_enabled), '{}'::jsonb
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.activate_pending_cuenta_after_confirmation() from public, anon, authenticated, service_role;
drop trigger if exists auth_user_activate_pending_cuenta on auth.users;
create trigger auth_user_activate_pending_cuenta
after update of email_confirmed_at, encrypted_password on auth.users
for each row execute function public.activate_pending_cuenta_after_confirmation();

-- Enforce parent state at the gateway too, including accounts provisioned
-- during a parent-state race and individual reactivation while the parent is
-- still disabled.
create or replace function public.require_systemsolutions_edge_gateway()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  gateway_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt', true), '')::jsonb ->> 'role'
  );
  request_headers jsonb := coalesce(current_setting('request.headers', true), '{}')::jsonb;
  actor_header text := request_headers ->> 'x-systemsolutions-actor-id';
  actor_id uuid;
begin
  if gateway_role is distinct from 'service_role' then
    raise insufficient_privilege using message = 'SystemSolutions Edge gateway required';
  end if;
  if actor_header is null or actor_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise insufficient_privilege using message = 'SystemSolutions Edge gateway required';
  end if;
  actor_id := actor_header::uuid;
  if not exists (
    select 1 from public.cuentas c
    where c.id = actor_id and c.estado = 'activa'
      and (c.rol <> 'cliente' or (
        not exists (select 1 from public.clientes p where p.cuenta_id = c.id and not p.activo)
        and not exists (select 1 from public.cliente_cuentas cc join public.clientes p on p.cuenta_id = cc.cliente_cuenta_id where cc.cuenta_id = c.id and not p.activo)
      ))
      and (c.rol <> 'taller_movil' or not exists (
        select 1 from public.taller_cuentas tc join public.talleres_moviles t on t.id = tc.taller_movil_id
        where tc.cuenta_id = c.id and not t.activo
      ))
  ) then
    raise insufficient_privilege using message = 'Cuenta is not active';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
end;
$$;
revoke all on function public.require_systemsolutions_edge_gateway() from public, anon, authenticated;
grant execute on function public.require_systemsolutions_edge_gateway() to service_role;

-- `api_context` is also consumed by the Edge gateway before route dispatch.
-- Return the effective state when a parent is disabled, even if a stale or
-- racing write left the linked Cuenta row active.
drop function if exists public.api_context();
create function public.api_context()
returns table (cuenta_id uuid, rol public.rol, taller_movil_id uuid, cliente boolean, estado public.estado_cuenta)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.rol, tc.taller_movil_id, (c.rol = 'cliente'),
    case when c.rol = 'cliente' and (
      exists (select 1 from public.clientes p where p.cuenta_id = c.id and not p.activo)
      or exists (select 1 from public.cliente_cuentas cc join public.clientes p on p.cuenta_id = cc.cliente_cuenta_id where cc.cuenta_id = c.id and not p.activo)
    ) then 'deshabilitada'::public.estado_cuenta
    when c.rol = 'taller_movil' and exists (
      select 1 from public.taller_cuentas tc2 join public.talleres_moviles t on t.id = tc2.taller_movil_id
      where tc2.cuenta_id = c.id and not t.activo
    ) then 'deshabilitada'::public.estado_cuenta
    else c.estado end
  from public.cuentas c left join public.taller_cuentas tc on tc.cuenta_id = c.id
  where c.id = auth.uid()
$$;
revoke all on function public.api_context() from public, anon, authenticated;
grant execute on function public.api_context() to service_role;

-- Defend the provisioning transaction against a Cliente being disabled after
-- the Edge preflight but before its Auth invitation is registered.
create or replace function public.api_create_client_account(target_client uuid, account_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and estado = 'activa') then
    raise exception using errcode = '42501', message = 'Only an active Administrador can create accounts';
  end if;
  if not exists (select 1 from public.clientes where cuenta_id = target_client and activo) then
    raise exception using errcode = 'P0002', message = 'Active Cliente not found';
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, 'cliente', 'pendiente', false);
  insert into public.cliente_cuentas(cliente_cuenta_id, cuenta_id) values (target_client, account_id);
  return jsonb_build_object('id', account_id, 'estado', 'pendiente');
end;
$$;

create or replace function public.api_update_account(target uuid, account_active boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; setup_complete boolean; parent_active boolean;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and estado = 'activa') then
    raise exception using errcode = '42501', message = 'Only an active Administrador can update accounts';
  end if;
  if account_active then
    select exists (
      select 1 from public.clientes p where p.cuenta_id = coalesce((select cc.cliente_cuenta_id from public.cliente_cuentas cc where cc.cuenta_id = target), target) and p.activo
    ) into parent_active;
    if not parent_active then raise exception using errcode = '42501', message = 'Cannot reactivate a Cuenta under a disabled Cliente'; end if;
    select email_confirmed_at is not null and nullif(encrypted_password, '') is not null
      into setup_complete from auth.users where id = target;
    update public.cuentas set estado = case when setup_complete then 'activa'::public.estado_cuenta else 'pendiente'::public.estado_cuenta end where id = target and rol = 'cliente';
  else
    update public.cuentas set estado = 'deshabilitada' where id = target and rol = 'cliente';
  end if;
  if not found then raise exception using errcode = 'P0002', message = 'Client account not found'; end if;
  select row into result from public.api_client_accounts(coalesce((select cliente_cuenta_id from public.cliente_cuentas where cuenta_id = target), target)) row where (row->>'id')::uuid = target;
  return result;
end;
$$;

revoke all on function public.api_authorize_admin_account_create(text, public.rol),
  public.api_authorize_account_provisioning(text, uuid), public.api_admin_accounts(),
  public.api_create_admin_account(uuid, public.rol), public.api_update_admin_account(uuid, boolean),
  public.api_admin_recovery_email(uuid), public.api_pending_invitation_target(uuid), public.api_record_auth_event(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_authorize_admin_account_create(text, public.rol),
  public.api_authorize_account_provisioning(text, uuid), public.api_admin_accounts(),
  public.api_create_admin_account(uuid, public.rol), public.api_update_admin_account(uuid, boolean),
  public.api_admin_recovery_email(uuid), public.api_pending_invitation_target(uuid), public.api_record_auth_event(text, uuid, text, jsonb)
  to service_role;

-- A verified email change is a security boundary: revoke every existing
-- refresh session and record both the change and revocation in the immutable
-- Registro de auditoría stream.
create or replace function public.revoke_sessions_after_verified_email_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if old.email is distinct from new.email then
    if auth.uid() is null then perform set_config('request.jwt.claim.sub', new.id::text, true); end if;
    delete from auth.sessions where user_id = new.id;
    perform public.record_audit_event(
      'account_email_changed', 'cuenta', new.id, 'exitoso',
      jsonb_build_object('email_change_verified', true), '{}'::jsonb
    );
    perform public.record_audit_event(
      'account_sessions_revoked', 'cuenta', new.id, 'exitoso',
      jsonb_build_object('cause', 'verified_email_change'), '{}'::jsonb
    );
  end if;
  return new;
end;
$$;
drop trigger if exists auth_user_email_change_revokes_sessions on auth.users;
create trigger auth_user_email_change_revokes_sessions
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.revoke_sessions_after_verified_email_change();
revoke all on function public.revoke_sessions_after_verified_email_change() from public, anon, authenticated, service_role;

-- Make device ownership part of the conflict predicate. A SELECT FOR UPDATE
-- cannot lock the absence of a claim row; concurrent first claims must be
-- arbitrated by the unique-index conflict itself.
create or replace function public.api_claim_visit_device(target_visit uuid, target_device uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  current_claim public.dispositivos_visita;
  visit_row public.visitas_servicio;
begin
  if target_device is null then
    raise exception using errcode = '22023', message = 'A device id is required';
  end if;
  select * into visit_row from public.api_assigned_visit(target_visit);
  if visit_row.estado not in ('aceptada', 'en_curso') then
    raise exception using errcode = 'check_violation', message = 'Only an active visit can be claimed';
  end if;

  select * into current_claim
  from public.dispositivos_visita
  where visita_id = target_visit
  for update;
  if current_claim.visita_id is not null and current_claim.device_id <> target_device then
    raise exception using errcode = 'serialization_failure', message = 'Another device is already working on this visit';
  end if;

  insert into public.dispositivos_visita as existing_claim(visita_id, device_id, claimed_at, last_seen_at)
  values (target_visit, target_device, now(), now())
  on conflict (visita_id) do update
    set last_seen_at = now()
    where existing_claim.device_id = excluded.device_id
  returning * into current_claim;
  if not found then
    raise exception using errcode = 'serialization_failure', message = 'Another device is already working on this visit';
  end if;
  return jsonb_build_object(
    'visit_id', target_visit,
    'device_id', target_device,
    'claimed_at', current_claim.claimed_at,
    'last_seen_at', current_claim.last_seen_at
  );
end;
$$;
revoke all on function public.api_claim_visit_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.api_claim_visit_device(uuid, uuid) to service_role;

commit;

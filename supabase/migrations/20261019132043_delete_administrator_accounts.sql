begin;

create or replace function public.api_authorize_admin_account_delete(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare actor_role public.rol; target_role public.rol; target_email text;
begin
  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid() and c.estado = 'activa';

  if actor_role is distinct from 'super_administrador' then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Only an active Súper administrador can delete administrator accounts'));
  end if;
  if target = auth.uid() then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'forbidden', 'message', 'A Súper administrador cannot delete its own account'));
  end if;

  select c.rol, u.email into target_role, target_email
  from public.cuentas c
  join auth.users u on u.id = c.id
  where c.id = target;

  if target_role is null then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'not_found', 'message', 'Administrator account was not found'));
  end if;
  if target_role not in ('administrador_regular', 'super_administrador') then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'invalid_role', 'message', 'Target is not an administrator account'));
  end if;
  if target_role = 'super_administrador' and not exists (
    select 1 from public.cuentas other_admin
    where other_admin.rol = 'super_administrador'
      and other_admin.estado = 'activa'
      and other_admin.id <> target
  ) then
    return jsonb_build_object('data', null, 'error', jsonb_build_object('code', 'last_super_admin', 'message', 'The last active Súper administrador cannot be deleted'));
  end if;

  return jsonb_build_object('data', jsonb_build_object('id', target, 'email', target_email), 'error', null);
end;
$$;

-- Auth deletion removes the Cuenta through its auth.users foreign key. The
-- audit row keeps the target UUID without retaining the removed identity.
create or replace function public.api_record_admin_account_deletion(
  target uuid,
  event_outcome text default 'exitoso',
  event_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor_role public.rol;
begin
  select c.rol into actor_role
  from public.cuentas c
  where c.id = auth.uid() and c.estado = 'activa';
  if actor_role is distinct from 'super_administrador' then
    raise exception using errcode = '42501', message = 'Only an active Súper administrador can audit administrator deletion';
  end if;
  if event_outcome not in ('exitoso', 'fallido') then
    raise exception using errcode = '22023', message = 'Unsupported administrator deletion outcome';
  end if;
  if coalesce(event_details, '{}'::jsonb)::text ~* '"(password|new_password|access_token|refresh_token|token|authorization)"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'Credentials and tokens cannot be audited';
  end if;
  return public.record_audit_event('account_deleted', 'cuenta', target, event_outcome,
    coalesce(event_details, '{}'::jsonb), '{}'::jsonb);
end;
$$;

revoke all on function public.api_authorize_admin_account_delete(uuid),
  public.api_record_admin_account_deletion(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.api_authorize_admin_account_delete(uuid),
  public.api_record_admin_account_deletion(uuid, text, jsonb)
  to service_role;

commit;

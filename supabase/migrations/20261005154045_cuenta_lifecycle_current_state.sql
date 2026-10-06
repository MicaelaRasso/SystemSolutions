begin;

create type public.estado_cuenta as enum ('pendiente', 'activa', 'deshabilitada');

alter table public.cuentas
  add column estado public.estado_cuenta not null default 'activa';

update public.cuentas
set estado = case
  when not activo then 'deshabilitada'::public.estado_cuenta
  when exists (
    select 1 from auth.users u
    where u.id = cuentas.id and u.email_confirmed_at is null and u.invited_at is not null
  ) then 'pendiente'::public.estado_cuenta
  else 'activa'::public.estado_cuenta
end;

-- Keep the legacy boolean synchronized while existing application RPCs migrate
-- to the explicit lifecycle state. New invitations set estado='pendiente'.
create or replace function public.sync_cuenta_estado()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.estado = 'activa' and not new.activo then
      new.estado := 'deshabilitada';
    end if;
    new.activo := new.estado = 'activa';
  elsif new.estado is distinct from old.estado then
    new.activo := new.estado = 'activa';
  elsif new.activo is distinct from old.activo then
    if new.activo then
      new.estado := case
        when exists (select 1 from auth.users where id = new.id and email_confirmed_at is not null)
          then 'activa'::public.estado_cuenta
        else 'pendiente'::public.estado_cuenta
      end;
    else
      new.estado := 'deshabilitada';
    end if;
  end if;
  return new;
end;
$$;

create trigger cuentas_estado_sync
before insert or update of estado, activo on public.cuentas
for each row execute function public.sync_cuenta_estado();
revoke all on function public.sync_cuenta_estado() from public, anon, authenticated, service_role;

-- Invitation acceptance activates a pending Cuenta. A disabled Cuenta stays
-- disabled if its owner later completes an old invitation or verifies email.
create or replace function public.activate_pending_cuenta_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.cuentas
    set estado = 'activa'
    where id = new.id and estado = 'pendiente';
  end if;
  return new;
end;
$$;

create trigger auth_user_confirmation_activates_cuenta
after update of email_confirmed_at on auth.users
for each row execute function public.activate_pending_cuenta_after_confirmation();
revoke all on function public.activate_pending_cuenta_after_confirmation() from public, anon, authenticated, service_role;

-- Publish current account state in the authenticated identity context.
drop function public.api_context();
create function public.api_context()
returns table (cuenta_id uuid, rol public.rol, taller_movil_id uuid, cliente boolean, estado public.estado_cuenta)
language sql stable security definer set search_path = public as $$
  select c.id, c.rol, tc.taller_movil_id, (c.rol = 'cliente'), c.estado
  from public.cuentas c left join public.taller_cuentas tc on tc.cuenta_id = c.id
  where c.id = auth.uid()
$$;
revoke all on function public.api_context() from public, anon, authenticated;
grant execute on function public.api_context() to service_role;

-- Invitation flows create a preserved identity in pendiente state.
create or replace function public.api_register_client_account(account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create a Cliente account';
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, 'cliente', 'pendiente', false);
end;
$$;

create or replace function public.api_create_client_account(target_client uuid, account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create accounts';
  end if;
  if not exists (select 1 from public.clientes where cuenta_id = target_client) then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, 'cliente', 'pendiente', false);
  insert into public.cliente_cuentas(cliente_cuenta_id, cuenta_id) values (target_client, account_id);
  return jsonb_build_object('id', account_id, 'estado', 'pendiente');
end;
$$;

create or replace function public.api_client_accounts(target_client uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'email', coalesce(u.email, ''),
    'nombre', coalesce(u.raw_user_meta_data->>'nombre', ''),
    'apellido', coalesce(u.raw_user_meta_data->>'apellido', ''),
    'rol', a.rol, 'activo', a.activo, 'estado', a.estado, 'creado_en', a.created_at
  )
  from public.cuentas a
  join auth.users u on u.id = a.id
  where a.rol = 'cliente'
    and exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
    and (a.id = target_client or exists (select 1 from public.cliente_cuentas cc where cc.cliente_cuenta_id = target_client and cc.cuenta_id = a.id))
  order by coalesce(u.raw_user_meta_data->>'apellido', ''), coalesce(u.raw_user_meta_data->>'nombre', ''), u.email;
$$;

create or replace function public.api_workshops()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'nombre', t.nombre, 'color', t.color, 'activo', t.activo,
    'usuario_id', tc.cuenta_id, 'email', coalesce(u.email, ''), 'estado_cuenta', cuenta.estado
  )
  from public.talleres_moviles t
  left join public.taller_cuentas tc on tc.taller_movil_id = t.id
  left join auth.users u on u.id = tc.cuenta_id
  left join public.cuentas cuenta on cuenta.id = tc.cuenta_id
  where exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by t.nombre;
$$;

create or replace function public.api_create_workshop(workshop_name text, workshop_color text, account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare workshop_id uuid; result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can create a Taller';
  end if;
  insert into public.cuentas(id, rol, estado, activo) values (account_id, 'taller_movil', 'pendiente', false);
  insert into public.talleres_moviles(nombre, color) values (btrim(workshop_name), btrim(workshop_color)) returning id into workshop_id;
  insert into public.taller_cuentas(taller_movil_id, cuenta_id) values (workshop_id, account_id);
  select row into result from public.api_workshops() row where (row->>'id')::uuid = workshop_id;
  return result;
end;
$$;

create or replace function public.api_update_account(target uuid, account_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
  confirmed_at timestamptz;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update accounts';
  end if;
  if account_active then
    select email_confirmed_at into confirmed_at from auth.users where id = target;
    update public.cuentas
    set estado = case when confirmed_at is null then 'pendiente'::public.estado_cuenta else 'activa'::public.estado_cuenta end
    where id = target and rol = 'cliente';
  else
    update public.cuentas set estado = 'deshabilitada' where id = target and rol = 'cliente';
  end if;
  if not found then raise exception using errcode = 'no_data_found', message = 'Client account not found'; end if;
  select row into result from public.api_client_accounts(coalesce((select cliente_cuenta_id from public.cliente_cuentas where cuenta_id = target), target)) row where (row->>'id')::uuid = target;
  return result;
end;
$$;

-- Preserve the old DELETE endpoint's compatibility while making its effect a
-- soft disable. Ordinary account administration never destroys Auth identity.
create or replace function public.api_delete_account(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can disable accounts';
  end if;
  if target = auth.uid() then raise exception using errcode = 'check_violation', message = 'An account cannot disable itself'; end if;
  update public.cuentas set estado = 'deshabilitada' where id = target and rol = 'cliente';
  if not found then raise exception using errcode = 'no_data_found', message = 'Client account not found'; end if;
end;
$$;

-- Enforce active state centrally before every Data API request. Since every
-- Edge application-data capability uses this service-role gateway, existing
-- access tokens lose access as soon as a Cuenta is disabled or still pending.
create or replace function public.require_systemsolutions_edge_gateway()
returns void
language plpgsql
security definer
set search_path = pg_catalog
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
  if actor_header is null
    or actor_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise insufficient_privilege using message = 'SystemSolutions Edge gateway required';
  end if;

  actor_id := actor_header::uuid;
  if not exists (select 1 from public.cuentas where id = actor_id and estado = 'activa') then
    raise insufficient_privilege using message = 'Cuenta is not active';
  end if;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
end;
$$;

commit;

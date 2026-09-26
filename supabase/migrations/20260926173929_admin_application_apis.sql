begin;

-- Frontend: Empresa -> backend: Cliente.  The existing account id remains the
-- canonical client identity so existing yacimiento ownership is preserved.
alter table public.clientes
  add column if not exists razon_social text,
  add column if not exists cuit text,
  add column if not exists contacto text,
  add column if not exists telefono text,
  add column if not exists email text,
  add column if not exists direccion text,
  add column if not exists logo_bucket text,
  add column if not exists logo_path text,
  add column if not exists aviso_vencimiento boolean not null default true,
  add column if not exists activo boolean not null default true;

update public.clientes
set razon_social = coalesce(nullif(razon_social, ''), nombre),
    email = coalesce(email, (select u.email from auth.users u where u.id = clientes.cuenta_id));

create unique index if not exists clientes_cuit_unique
  on public.clientes(cuit) where cuit is not null and btrim(cuit) <> '';

alter table public.cuentas
  add column if not exists activo boolean not null default true;

create table if not exists public.cliente_cuentas (
  cliente_cuenta_id uuid not null references public.clientes(cuenta_id) on delete cascade,
  cuenta_id uuid primary key references public.cuentas(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.cliente_cuentas enable row level security;

create table if not exists public.cliente_accesos (
  cuenta_id uuid not null references public.cuentas(id) on delete cascade,
  nivel text not null check (nivel in ('yacimiento', 'planta', 'equipo')),
  ref_id uuid not null,
  primary key (cuenta_id, nivel, ref_id)
);

alter table public.cliente_accesos enable row level security;

insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Frontend: Taller -> backend: talleres_moviles; account ownership remains in
-- taller_cuentas and is managed by identity-admin.
alter table public.talleres_moviles
  add column if not exists color text not null default '#2563eb',
  add column if not exists activo boolean not null default true;

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellido text not null,
  dni text not null unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.nominas_jornada (
  taller_movil_id uuid not null references public.talleres_moviles(id) on delete cascade,
  fecha date not null,
  persona_ids uuid[] not null default '{}',
  primary key (taller_movil_id, fecha)
);

alter table public.personas enable row level security;
alter table public.nominas_jornada enable row level security;

create table if not exists public.catalogo_opciones (
  id uuid primary key default gen_random_uuid(),
  lista text not null,
  valor text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lista, valor)
);

create index if not exists catalogo_opciones_lista_orden_idx
  on public.catalogo_opciones(lista, orden, valor);

create table if not exists public.patrones_ensayo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nro_serie text not null,
  vencimiento date not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (nombre, nro_serie)
);

alter table public.catalogo_opciones enable row level security;
alter table public.patrones_ensayo enable row level security;

create sequence if not exists public.solicitudes_servicio_numero_seq;
alter table public.solicitudes_servicio
  add column if not exists numero_solicitud bigint,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.solicitudes_servicio
set numero_solicitud = nextval('public.solicitudes_servicio_numero_seq')
where numero_solicitud is null;

alter table public.solicitudes_servicio
  alter column numero_solicitud set default nextval('public.solicitudes_servicio_numero_seq'),
  alter column numero_solicitud set not null;

create unique index if not exists solicitudes_servicio_numero_unique
  on public.solicitudes_servicio(numero_solicitud);

-- ---------------------------------------------------------------------------
-- Cliente and account APIs (owner: identity-admin / asset-access)
-- ---------------------------------------------------------------------------

create or replace function public.api_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an active Administrador can use this API';
  end if;
end;
$$;

create or replace function public.api_client_rows()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.api_require_admin();
  return query
  select jsonb_build_object(
    'id', c.cuenta_id,
    'razon_social', coalesce(nullif(c.razon_social, ''), c.nombre),
    'nombre', c.nombre,
    'cuit', coalesce(c.cuit, ''),
    'contacto', coalesce(c.contacto, ''),
    'telefono', coalesce(c.telefono, ''),
    'email', coalesce(c.email, ''),
    'direccion', coalesce(c.direccion, ''),
    'logo_url', case when c.logo_bucket is null or c.logo_path is null then null else jsonb_build_object('bucket', c.logo_bucket, 'path', c.logo_path) end,
    'aviso_vencimiento', c.aviso_vencimiento,
    'activo', c.activo,
    'creado_en', c.created_at,
    'yacimientos', (select count(*) from public.yacimientos y where y.cliente_cuenta_id = c.cuenta_id),
    'valvulas', (select count(*) from public.valvulas v join public.equipos_unidades e on e.id = v.equipo_id join public.plantas_locaciones p on p.id = e.planta_id join public.yacimientos y on y.id = p.yacimiento_id where y.cliente_cuenta_id = c.cuenta_id),
    'usuarios', (select count(*) from public.cuentas a where a.id = c.cuenta_id or exists (select 1 from public.cliente_cuentas cc where cc.cliente_cuenta_id = c.cuenta_id and cc.cuenta_id = a.id))
  )
  from public.clientes c
  order by coalesce(nullif(c.razon_social, ''), c.nombre);
end;
$$;

create or replace function public.api_client(target uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can read Cliente administration';
  end if;
  select row into result from public.api_client_rows() row where (row->>'id')::uuid = target;
  if result is null then
    raise exception using errcode = 'no_data_found', message = 'Cliente not found';
  end if;
  return result;
end;
$$;

create or replace function public.api_create_client(
  client_cuenta uuid, client_name text, client_cuit text, client_contacto text,
  client_telefono text, client_email text, client_direccion text,
  client_aviso boolean, client_activo boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create a Cliente';
  end if;
  if not exists (select 1 from public.cuentas where id = client_cuenta and rol = 'cliente') then
    raise exception using errcode = 'foreign_key_violation', message = 'Client account not found';
  end if;
  insert into public.clientes(cuenta_id, nombre, razon_social, cuit, contacto, telefono, email, direccion, aviso_vencimiento, activo)
  values (client_cuenta, btrim(client_name), btrim(client_name), nullif(btrim(client_cuit), ''), btrim(client_contacto), btrim(client_telefono), lower(btrim(client_email)), btrim(client_direccion), client_aviso, client_activo);
  return public.api_client(client_cuenta);
exception when unique_violation then
  raise exception using errcode = 'unique_violation', message = 'A Cliente with that account or CUIT already exists';
end;
$$;

create or replace function public.api_register_client_account(account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create a Cliente account';
  end if;
  insert into public.cuentas(id, rol) values (account_id, 'cliente');
end;
$$;

create or replace function public.api_update_client(
  target uuid, client_name text, client_cuit text, client_contacto text,
  client_telefono text, client_email text, client_direccion text,
  client_aviso boolean, client_activo boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update a Cliente';
  end if;
  update public.clientes
  set nombre = btrim(client_name), razon_social = btrim(client_name), cuit = nullif(btrim(client_cuit), ''),
      contacto = btrim(client_contacto), telefono = btrim(client_telefono), email = lower(btrim(client_email)),
      direccion = btrim(client_direccion), aviso_vencimiento = client_aviso, activo = client_activo
  where cuenta_id = target;
  if not found then raise exception using errcode = 'no_data_found', message = 'Cliente not found'; end if;
  return public.api_client(target);
exception when unique_violation then
  raise exception using errcode = 'unique_violation', message = 'A Cliente with that CUIT already exists';
end;
$$;

create or replace function public.api_set_client_logo(target uuid, bucket_name text, object_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can change a Cliente logo';
  end if;
  update public.clientes set logo_bucket = bucket_name, logo_path = object_path where cuenta_id = target;
  if not found then raise exception using errcode = 'no_data_found', message = 'Cliente not found'; end if;
  return public.api_client(target);
end;
$$;

create or replace function public.api_client_accounts(target_client uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'email', coalesce(u.email, ''),
    'nombre', coalesce(u.raw_user_meta_data->>'nombre', ''),
    'apellido', coalesce(u.raw_user_meta_data->>'apellido', ''),
    'rol', a.rol, 'activo', a.activo, 'creado_en', a.created_at
  )
  from public.cuentas a
  join auth.users u on u.id = a.id
  where a.rol = 'cliente'
    and exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
    and (a.id = target_client or exists (select 1 from public.cliente_cuentas cc where cc.cliente_cuenta_id = target_client and cc.cuenta_id = a.id))
  order by coalesce(u.raw_user_meta_data->>'apellido', ''), coalesce(u.raw_user_meta_data->>'nombre', ''), u.email;
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
  insert into public.cuentas(id, rol) values (account_id, 'cliente');
  insert into public.cliente_cuentas(cliente_cuenta_id, cuenta_id) values (target_client, account_id);
  return jsonb_build_object('id', account_id);
end;
$$;

create or replace function public.api_update_account(target uuid, account_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update accounts';
  end if;
  update public.cuentas set activo = account_active where id = target and rol = 'cliente';
  if not found then raise exception using errcode = 'no_data_found', message = 'Client account not found'; end if;
  select row into result from public.api_client_accounts(coalesce((select cliente_cuenta_id from public.cliente_cuentas where cuenta_id = target), target)) row where (row->>'id')::uuid = target;
  return result;
end;
$$;

create or replace function public.api_delete_account(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can delete accounts';
  end if;
  if target = auth.uid() then raise exception using errcode = 'check_violation', message = 'An account cannot delete itself'; end if;
  delete from public.cuentas where id = target and rol = 'cliente';
  if not found then raise exception using errcode = 'no_data_found', message = 'Client account not found'; end if;
end;
$$;

create or replace function public.api_account_access(target uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usuario_id', cuenta_id, 'nivel', nivel, 'ref_id', ref_id)
  from public.cliente_accesos where cuenta_id = target
    and exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by nivel, ref_id;
$$;

create or replace function public.api_set_account_access(target uuid, scopes jsonb)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare item jsonb; access_level text; access_ref uuid; client_owner uuid;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can assign access';
  end if;
  select coalesce((select cliente_cuenta_id from public.cliente_cuentas where cuenta_id = target), target) into client_owner;
  delete from public.cliente_accesos where cuenta_id = target;
  for item in select value from jsonb_array_elements(scopes) loop
    access_level := item->>'nivel'; access_ref := (item->>'ref_id')::uuid;
    if access_level = 'yacimiento' and not exists (select 1 from public.yacimientos where id = access_ref and cliente_cuenta_id = client_owner) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Access scope is outside the Cliente';
    elsif access_level = 'planta' and not exists (select 1 from public.plantas_locaciones p join public.yacimientos y on y.id = p.yacimiento_id where p.id = access_ref and y.cliente_cuenta_id = client_owner) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Access scope is outside the Cliente';
    elsif access_level = 'equipo' and not exists (select 1 from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id join public.yacimientos y on y.id = p.yacimiento_id where e.id = access_ref and y.cliente_cuenta_id = client_owner) then
      raise exception using errcode = 'invalid_parameter_value', message = 'Access scope is outside the Cliente';
    end if;
    insert into public.cliente_accesos(cuenta_id, nivel, ref_id) values (target, access_level, access_ref);
  end loop;
  return query select * from public.api_account_access(target);
end;
$$;

-- ---------------------------------------------------------------------------
-- Talleres, técnicos and staffing APIs (owner: identity-admin)
-- ---------------------------------------------------------------------------

create or replace function public.api_workshops()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'color', t.color, 'activo', t.activo,
    'usuario_id', tc.cuenta_id, 'email', coalesce(u.email, ''))
  from public.talleres_moviles t
  left join public.taller_cuentas tc on tc.taller_movil_id = t.id
  left join auth.users u on u.id = tc.cuenta_id
  where exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by t.nombre;
$$;

create or replace function public.api_create_workshop(workshop_name text, workshop_color text, account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare workshop_id uuid; result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create a Taller';
  end if;
  insert into public.talleres_moviles(nombre, color) values (btrim(workshop_name), btrim(workshop_color)) returning id into workshop_id;
  insert into public.taller_cuentas(taller_movil_id, cuenta_id) values (workshop_id, account_id);
  select row into result from public.api_workshops() row where (row->>'id')::uuid = workshop_id;
  return result;
end;
$$;

create or replace function public.api_update_workshop(target uuid, workshop_name text, workshop_color text, workshop_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update a Taller';
  end if;
  update public.talleres_moviles set nombre = btrim(workshop_name), color = btrim(workshop_color), activo = workshop_active where id = target;
  if not found then raise exception using errcode = 'no_data_found', message = 'Taller not found'; end if;
  select row into result from public.api_workshops() row where (row->>'id')::uuid = target;
  return result;
end;
$$;

create or replace function public.api_people()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) from public.personas p
  where exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by p.apellido, p.nombre;
$$;

create or replace function public.api_create_person(person_name text, person_last_name text, person_dni text, person_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.personas;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create a Técnico';
  end if;
  insert into public.personas(nombre, apellido, dni, activo) values (btrim(person_name), btrim(person_last_name), btrim(person_dni), person_active) returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_update_person(target uuid, person_name text, person_last_name text, person_dni text, person_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.personas;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update a Técnico';
  end if;
  update public.personas set nombre = btrim(person_name), apellido = btrim(person_last_name), dni = btrim(person_dni), activo = person_active where id = target returning * into result;
  if result.id is null then raise exception using errcode = 'no_data_found', message = 'Técnico not found'; end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_staffing(from_date date, to_date date)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('taller_id', taller_movil_id, 'fecha', fecha, 'persona_ids', to_jsonb(persona_ids))
  from public.nominas_jornada where fecha between from_date and to_date
    and exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by fecha, taller_movil_id;
$$;

create or replace function public.api_set_staffing(target_taller uuid, target_date date, ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit staffing';
  end if;
  if exists (select 1 from unnest(ids) selected(id) where not exists (select 1 from public.personas p where p.id = selected.id and p.activo)) then
    raise exception using errcode = 'invalid_parameter_value', message = 'Staffing includes an inactive or unknown Técnico';
  end if;
  insert into public.nominas_jornada(taller_movil_id, fecha, persona_ids) values (target_taller, target_date, ids)
  on conflict (taller_movil_id, fecha) do update set persona_ids = excluded.persona_ids;
  return jsonb_build_object('taller_id', target_taller, 'fecha', target_date, 'persona_ids', to_jsonb(ids));
end;
$$;

create or replace function public.api_copy_staffing(previous_monday date)
returns integer language plpgsql security definer set search_path = public as $$
declare copied integer := 0; source_row record; target_date date;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can copy staffing';
  end if;
  for source_row in select * from public.nominas_jornada where fecha between previous_monday - 7 and previous_monday - 1 loop
    target_date := source_row.fecha + 7;
    if not exists (select 1 from public.nominas_jornada where taller_movil_id = source_row.taller_movil_id and fecha = target_date) then
      insert into public.nominas_jornada values (source_row.taller_movil_id, target_date, source_row.persona_ids); copied := copied + 1;
    end if;
  end loop;
  return copied;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog APIs (owner: identity-admin)
-- ---------------------------------------------------------------------------

create or replace function public.api_catalog_options(target_list text, include_inactive boolean default true)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(o) from public.catalogo_opciones o
  where o.lista = target_list and (include_inactive or o.activo)
    and exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by o.orden, o.valor;
$$;

create or replace function public.api_catalog_summary()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lista', lista, 'total', count(*), 'activas', count(*) filter (where activo))
  from public.catalogo_opciones
  where exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  group by lista order by lista;
$$;

create or replace function public.api_create_catalog_option(target_list text, option_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.catalogo_opciones;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs'; end if;
  insert into public.catalogo_opciones(lista, valor, orden) values (target_list, btrim(option_value), coalesce((select max(orden) + 1 from public.catalogo_opciones where lista = target_list), 0)) returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_update_catalog_option(target uuid, option_value text, option_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.catalogo_opciones;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs'; end if;
  update public.catalogo_opciones set valor = coalesce(nullif(btrim(option_value), ''), valor), activo = coalesce(option_active, activo) where id = target returning * into result;
  if result.id is null then raise exception using errcode = 'no_data_found', message = 'Catalog option not found'; end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_reorder_catalog(target_list text, option_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit catalogs'; end if;
  update public.catalogo_opciones o set orden = positions.position
  from unnest(option_ids) with ordinality positions(id, position)
  where o.id = positions.id and o.lista = target_list;
end;
$$;

create or replace function public.api_test_standards()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) from public.patrones_ensayo p
  where exists (select 1 from public.cuentas actor where actor.id = auth.uid() and actor.rol in ('administrador_regular', 'super_administrador') and actor.activo)
  order by p.nombre, p.nro_serie;
$$;

create or replace function public.api_create_test_standard(standard_name text, standard_serial text, standard_expiry date, standard_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.patrones_ensayo;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit test standards'; end if;
  insert into public.patrones_ensayo(nombre, nro_serie, vencimiento, activo) values (upper(btrim(standard_name)), btrim(standard_serial), standard_expiry, standard_active) returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.api_update_test_standard(target uuid, standard_name text, standard_serial text, standard_expiry date, standard_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.patrones_ensayo;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can edit test standards'; end if;
  update public.patrones_ensayo set nombre = upper(btrim(standard_name)), nro_serie = btrim(standard_serial), vencimiento = standard_expiry, activo = standard_active where id = target returning * into result;
  if result.id is null then raise exception using errcode = 'no_data_found', message = 'Test standard not found'; end if;
  return to_jsonb(result);
end;
$$;

-- Admin screens edit a Cliente's hierarchy; Cliente accounts may edit only
-- their own hierarchy. These wrappers preserve that distinction without
-- weakening the original owner-only RPCs used by older clients.
create or replace function public.api_actor_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador') and activo);
$$;

create or replace function public.api_create_yacimiento_for_actor(
  target_client uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos language plpgsql security definer set search_path = public as $$
declare result public.yacimientos; owner_id uuid := coalesce(target_client, auth.uid());
begin
  perform public.require_authenticated_cuenta();
  if public.api_actor_is_admin() then null;
  elsif owner_id <> auth.uid() or not exists (select 1 from public.cuentas where id = auth.uid() and rol = 'cliente') then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente or an Administrador can create a Yacimiento';
  end if;
  insert into public.yacimientos(cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (owner_id, public.require_asset_name(asset_name), public.require_nonblank(asset_provincia, 'Provincia'), public.require_nonblank(asset_operadora, 'Operadora'), public.require_nonblank(asset_contratista, 'Contratista'))
  returning * into result;
  return result;
end;
$$;

create or replace function public.api_update_yacimiento_for_actor(
  target uuid, asset_name text, asset_provincia text, asset_operadora text, asset_contratista text
)
returns public.yacimientos language plpgsql security definer set search_path = public as $$
declare result public.yacimientos;
begin
  perform public.require_authenticated_cuenta();
  if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = target and cliente_cuenta_id = auth.uid()) then
    raise exception using errcode = 'insufficient_privilege', message = 'Only the owning Cliente or an Administrador can update a Yacimiento';
  end if;
  update public.yacimientos set nombre = public.require_asset_name(asset_name), provincia = public.require_nonblank(asset_provincia, 'Provincia'), operadora = public.require_nonblank(asset_operadora, 'Operadora'), contratista = public.require_nonblank(asset_contratista, 'Contratista') where id = target returning * into result;
  if result.id is null then raise exception using errcode = 'no_data_found', message = 'Yacimiento not found'; end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', target, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', 'yacimiento'));
  return result;
end;
$$;

create or replace function public.api_create_descendant_for_actor(kind text, parent_id uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare yid uuid; result jsonb; normalized_name text;
begin
  perform public.require_authenticated_cuenta();
  if kind not in ('planta', 'equipo', 'valvula') then raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type'; end if;
  normalized_name := public.require_asset_name(asset_name);
  if kind = 'planta' then
    select yacimiento_id into yid from public.yacimientos where id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    insert into public.plantas_locaciones(yacimiento_id, nombre) values (yid, normalized_name) returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid from public.plantas_locaciones p where p.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    insert into public.equipos_unidades(planta_id, nombre) values (parent_id, normalized_name) returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where e.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    insert into public.valvulas(equipo_id, nombre) values (parent_id, normalized_name) returning to_jsonb(valvulas.*) into result;
  end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  return result;
end;
$$;

create or replace function public.api_update_descendant_for_actor(kind text, target uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare yid uuid; result jsonb; normalized_name text;
begin
  perform public.require_authenticated_cuenta();
  if kind not in ('planta', 'equipo', 'valvula') then raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type'; end if;
  normalized_name := public.require_asset_name(asset_name);
  if kind = 'planta' then
    select yacimiento_id into yid from public.plantas_locaciones where id = target;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    update public.plantas_locaciones set nombre = normalized_name where id = target returning to_jsonb(plantas_locaciones.*) into result;
  elsif kind = 'equipo' then
    select p.yacimiento_id into yid from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where e.id = target;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    update public.equipos_unidades set nombre = normalized_name where id = target returning to_jsonb(equipos_unidades.*) into result;
  else
    select p.yacimiento_id into yid from public.valvulas v join public.equipos_unidades e on e.id = v.equipo_id join public.plantas_locaciones p on p.id = e.planta_id where v.id = target;
    perform public.require_yacimiento_access(yid);
    if not public.api_actor_is_admin() and not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Not authorized'; end if;
    update public.valvulas set nombre = normalized_name where id = target returning to_jsonb(valvulas.*) into result;
  end if;
  if result is null then raise exception using errcode = 'no_data_found', message = 'Descendant not found'; end if;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', yid, target, auth.uid(), jsonb_build_object('event', 'updated', 'kind', kind));
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Frontend TareaResumen -> backend operations read model. Writes still create
-- canonical Solicitud/Visita records and store only UI-specific metadata.
-- ---------------------------------------------------------------------------

create or replace function public.api_operation_row(target_request uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', coalesce(v.id, s.id), 'nro_solicitud', s.numero_solicitud,
    'empresa_id', s.cliente_cuenta_id, 'yacimiento_id', s.yacimiento_id,
    'planta_id', location.planta_id, 'equipo_id', location.equipo_id,
    'taller_id', v.taller_movil_id, 'contacto', coalesce(s.metadata->>'contacto', ''),
    'telefono', coalesce(s.metadata->>'telefono', ''), 'fecha_solicitud', s.created_at::date,
    'fecha_ejecucion', coalesce(v.starts_at::date, nullif(s.metadata->>'fecha_ejecucion', '')::date),
    'horario', coalesce(s.metadata->>'horario', to_char(v.starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI')),
    'tipo', coalesce(s.metadata->>'tipo', 'Certificación'), 'detalle', coalesce(s.metadata->>'detalle', ''),
    'pd_rto', s.metadata->>'pd_rto', 'orden_trabajo', s.metadata->>'orden_trabajo',
    'condiciones', coalesce(s.metadata->'condiciones', '[]'::jsonb), 'adjuntos', coalesce(s.metadata->'adjuntos', '[]'::jsonb),
    'estado', case when v.estado = 'cancelada' then 'cancelada' when v.estado = 'completada' then 'completada' when v.estado = 'en_curso' then 'en_curso' when v.taller_movil_id is not null then 'asignada' else 'pendiente' end,
    'empresa_nombre', coalesce(c.razon_social, c.nombre), 'yacimiento_nombre', y.nombre,
    'planta_nombre', coalesce(location.planta_nombre, '—'), 'equipo_nombre', coalesce(location.equipo_nombre, '—'),
    'taller_nombre', t.nombre, 'taller_color', t.color
  )
  from public.solicitudes_servicio s
  join public.clientes c on c.cuenta_id = s.cliente_cuenta_id
  join public.yacimientos y on y.id = s.yacimiento_id
  left join public.visitas_servicio v on v.solicitud_id = s.id
  left join public.talleres_moviles t on t.id = v.taller_movil_id
  left join lateral (
    select p.id planta_id, p.nombre planta_nombre, e.id equipo_id, e.nombre equipo_nombre
    from public.solicitud_valvulas sv join public.valvulas va on va.id = sv.valvula_id
    join public.equipos_unidades e on e.id = va.equipo_id
    join public.plantas_locaciones p on p.id = e.planta_id
    where sv.solicitud_id = s.id order by sv.selected_at limit 1
  ) location on true
  where s.id = target_request;
$$;

create or replace function public.api_operations(from_date date default null, to_date date default null, status_filter text default null, workshop_filter uuid default null, client_filter uuid default null, search_text text default null)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select operation from public.solicitudes_servicio s cross join lateral public.api_operation_row(s.id) operation
  where (from_date is null or (operation->>'fecha_ejecucion')::date >= from_date)
    and (to_date is null or (operation->>'fecha_ejecucion')::date <= to_date)
    and (status_filter is null or operation->>'estado' = any(string_to_array(status_filter, ',')))
    and (workshop_filter is null or (operation->>'taller_id')::uuid = workshop_filter)
    and (client_filter is null or (operation->>'empresa_id')::uuid = client_filter)
    and (search_text is null or operation::text ilike '%' || search_text || '%')
  order by (operation->>'fecha_ejecucion'), (operation->>'nro_solicitud')::bigint;
$$;

create or replace function public.api_create_operation(
  target_client uuid, target_yacimiento uuid, selection_kind text, selection_id uuid,
  operation_metadata jsonb, provider_id uuid default null, visit_starts_at timestamptz default null, visit_ends_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_id uuid; result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can create an operation'; end if;
  if not exists (select 1 from public.yacimientos where id = target_yacimiento and cliente_cuenta_id = target_client) then raise exception using errcode = 'invalid_parameter_value', message = 'Yacimiento is outside the Cliente'; end if;
  insert into public.solicitudes_servicio(yacimiento_id, cliente_cuenta_id, metadata) values (target_yacimiento, target_client, coalesce(operation_metadata, '{}'::jsonb)) returning id into request_id;
  perform public.api_replace_service_selection(request_id, target_yacimiento, jsonb_build_array(jsonb_build_object('kind', selection_kind, 'id', selection_id)));
  if provider_id is not null then
    if visit_starts_at is null or visit_ends_at is null then raise exception using errcode = 'invalid_parameter_value', message = 'A scheduled operation requires a time window'; end if;
    perform public.api_schedule_visit(request_id, provider_id, visit_starts_at, visit_ends_at);
  end if;
  select public.api_operation_row(request_id) into result;
  return result;
end;
$$;

create or replace function public.api_update_operation(
  target uuid, operation_metadata jsonb, provider_id uuid default null, visit_starts_at timestamptz default null, visit_ends_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare request_id uuid; result jsonb;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol in ('administrador_regular', 'super_administrador')) then raise exception using errcode = 'insufficient_privilege', message = 'Only an Administrador can update an operation'; end if;
  select solicitud_id into request_id from public.visitas_servicio where id = target;
  if request_id is null then request_id := target; end if;
  update public.solicitudes_servicio set metadata = coalesce(metadata, '{}'::jsonb) || coalesce(operation_metadata, '{}'::jsonb), updated_at = now() where id = request_id;
  if not found then raise exception using errcode = 'no_data_found', message = 'Operation not found'; end if;
  if provider_id is not null then perform public.api_schedule_visit(request_id, provider_id, visit_starts_at, visit_ends_at); end if;
  select public.api_operation_row(request_id) into result;
  return result;
end;
$$;

-- The Edge gateway is the only caller of application RPCs.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.api_client_rows(), public.api_client(uuid), public.api_register_client_account(uuid), public.api_create_client(uuid,text,text,text,text,text,text,boolean,boolean), public.api_update_client(uuid,text,text,text,text,text,text,boolean,boolean), public.api_set_client_logo(uuid,text,text), public.api_client_accounts(uuid), public.api_create_client_account(uuid,uuid), public.api_update_account(uuid,boolean), public.api_delete_account(uuid), public.api_account_access(uuid), public.api_set_account_access(uuid,jsonb) to service_role;
grant execute on function public.api_actor_is_admin(), public.api_create_yacimiento_for_actor(uuid,text,text,text,text), public.api_update_yacimiento_for_actor(uuid,text,text,text,text), public.api_create_descendant_for_actor(text,uuid,text), public.api_update_descendant_for_actor(text,uuid,text) to service_role;
grant execute on function public.api_workshops(), public.api_create_workshop(text,text,uuid), public.api_update_workshop(uuid,text,text,boolean), public.api_people(), public.api_create_person(text,text,text,boolean), public.api_update_person(uuid,text,text,text,boolean), public.api_staffing(date,date), public.api_set_staffing(uuid,date,uuid[]), public.api_copy_staffing(date) to service_role;
grant execute on function public.api_catalog_options(text,boolean), public.api_catalog_summary(), public.api_create_catalog_option(text,text), public.api_update_catalog_option(uuid,text,boolean), public.api_reorder_catalog(text,uuid[]), public.api_test_standards(), public.api_create_test_standard(text,text,date,boolean), public.api_update_test_standard(uuid,text,text,date,boolean) to service_role;
grant execute on function public.api_operations(date,date,text,uuid,uuid,text), public.api_operation_row(uuid), public.api_create_operation(uuid,uuid,text,uuid,jsonb,uuid,timestamptz,timestamptz), public.api_update_operation(uuid,jsonb,uuid,timestamptz,timestamptz) to service_role;

commit;

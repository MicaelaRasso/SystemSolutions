create extension if not exists pgcrypto;

create type public.rol as enum (
  'cliente',
  'taller_movil',
  'administrador_regular',
  'super_administrador'
);

create type public.estado_solicitud as enum ('pendiente', 'aceptada', 'rechazada', 'cancelada');
create type public.estado_asignacion as enum ('activa', 'finalizada');
create type public.tipo_historial as enum ('servicio', 'jerarquia');

create table public.cuentas (
  id uuid primary key references auth.users(id) on delete cascade,
  rol public.rol not null,
  created_at timestamptz not null default now()
);

create table public.clientes (
  cuenta_id uuid primary key references public.cuentas(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.talleres_moviles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.taller_cuentas (
  taller_movil_id uuid not null references public.talleres_moviles(id) on delete cascade,
  cuenta_id uuid primary key references public.cuentas(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.ensure_taller_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cuentas where id = new.cuenta_id and rol = 'taller_movil') then
    raise exception using errcode = 'check_violation', message = 'Only a Taller Móvil account can belong to a provider';
  end if;
  return new;
end;
$$;
create trigger taller_cuentas_role_check before insert or update on public.taller_cuentas
for each row execute function public.ensure_taller_role();

create table public.yacimientos (
  id uuid primary key default gen_random_uuid(),
  cliente_cuenta_id uuid not null references public.clientes(cuenta_id),
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.plantas_locaciones (
  id uuid primary key default gen_random_uuid(),
  yacimiento_id uuid not null references public.yacimientos(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.equipos_unidades (
  id uuid primary key default gen_random_uuid(),
  planta_id uuid not null references public.plantas_locaciones(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.valvulas (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos_unidades(id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.solicitudes_certificado (
  id uuid primary key default gen_random_uuid(),
  yacimiento_id uuid not null references public.yacimientos(id) on delete cascade,
  taller_movil_id uuid not null references public.talleres_moviles(id),
  solicitante_cuenta_id uuid not null references public.cuentas(id),
  estado public.estado_solicitud not null default 'pendiente',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.asignaciones_servicio (
  id uuid primary key default gen_random_uuid(),
  yacimiento_id uuid not null references public.yacimientos(id) on delete cascade,
  taller_movil_id uuid not null references public.talleres_moviles(id),
  solicitud_id uuid not null unique references public.solicitudes_certificado(id),
  estado public.estado_asignacion not null default 'activa',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((estado = 'activa' and ended_at is null) or (estado = 'finalizada' and ended_at is not null))
);

create unique index one_active_assignment_per_yacimiento
  on public.asignaciones_servicio(yacimiento_id) where estado = 'activa';

create table public.historial_relaciones (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_historial not null,
  yacimiento_id uuid not null references public.yacimientos(id) on delete cascade,
  relacion_id uuid,
  actor_cuenta_id uuid references public.cuentas(id),
  datos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index yacimientos_cliente_idx on public.yacimientos(cliente_cuenta_id);
create index plantas_yacimiento_idx on public.plantas_locaciones(yacimiento_id);
create index equipos_planta_idx on public.equipos_unidades(planta_id);
create index valvulas_equipo_idx on public.valvulas(equipo_id);

create or replace function public.prevent_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol is distinct from old.rol then
    raise exception using errcode = 'check_violation', message = 'Cuenta role is immutable';
  end if;
  return new;
end;
$$;
create trigger cuentas_role_immutable before update of rol on public.cuentas
for each row execute function public.prevent_role_change();

create or replace function public.current_cuenta_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cuentas where id = auth.uid()
$$;

create or replace function public.can_access_yacimiento(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.yacimientos y
    join public.cuentas c on c.id = auth.uid()
    where y.id = target
      and (
        c.rol in ('administrador_regular', 'super_administrador')
        or y.cliente_cuenta_id = c.id
        or exists (
          select 1 from public.asignaciones_servicio a
          join public.taller_cuentas tc on tc.taller_movil_id = a.taller_movil_id
          where a.yacimiento_id = y.id and a.estado = 'activa' and tc.cuenta_id = c.id
        )
      )
  )
$$;

create or replace function public.require_yacimiento_access(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access_yacimiento(target) then
    raise exception using errcode = 'insufficient_privilege', message = 'Not authorized';
  end if;
end;
$$;

create or replace function public.api_context()
returns table (cuenta_id uuid, rol public.rol, taller_movil_id uuid, cliente boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.rol, tc.taller_movil_id, (c.rol = 'cliente')
  from public.cuentas c left join public.taller_cuentas tc on tc.cuenta_id = c.id
  where c.id = auth.uid()
$$;

create or replace function public.api_yacimientos()
returns setof public.yacimientos language sql stable security definer set search_path = public as $$
  select y from public.yacimientos y
  where public.can_access_yacimiento(y.id)
$$;

create or replace function public.api_yacimiento_tree(target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.require_yacimiento_access(target);
  select jsonb_build_object(
    'yacimiento', (select to_jsonb(y) from public.yacimientos y where y.id = target),
    'plantas', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.plantas_locaciones p where p.yacimiento_id = target), '[]'::jsonb),
    'equipos', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where p.yacimiento_id = target), '[]'::jsonb),
    'valvulas', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.valvulas v join public.equipos_unidades e on e.id = v.equipo_id join public.plantas_locaciones p on p.id = e.planta_id where p.yacimiento_id = target), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.api_assignment(target uuid)
returns public.asignaciones_servicio language plpgsql security definer set search_path = public as $$
declare result public.asignaciones_servicio;
begin
  perform public.require_yacimiento_access(target);
  select * into result from public.asignaciones_servicio where yacimiento_id = target and estado = 'activa';
  return result;
end;
$$;

create or replace function public.api_create_yacimiento(asset_name text)
returns public.yacimientos language plpgsql security definer set search_path = public as $$
declare result public.yacimientos;
begin
  if not exists (select 1 from public.cuentas where id = auth.uid() and rol = 'cliente') then
    raise exception using errcode = 'insufficient_privilege', message = 'Only a Cliente can create a Yacimiento';
  end if;
  insert into public.yacimientos(cliente_cuenta_id, nombre) values (auth.uid(), asset_name) returning * into result;
  return result;
end;
$$;

create or replace function public.api_create_descendant(kind text, parent_id uuid, asset_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare yid uuid; result jsonb;
begin
  if kind not in ('planta', 'equipo', 'valvula') then raise exception using errcode = 'invalid_parameter_value', message = 'Unknown descendant type'; end if;
  if kind = 'planta' then select yacimiento_id into yid from public.yacimientos where id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy'; end if;
    insert into public.plantas_locaciones(yacimiento_id, nombre) values (yid, asset_name) returning to_jsonb(plantas_locaciones.*) into result;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind));
  elsif kind = 'equipo' then select p.yacimiento_id into yid from public.plantas_locaciones p where p.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy'; end if;
    insert into public.equipos_unidades(planta_id, nombre) values (parent_id, asset_name) returning to_jsonb(equipos_unidades.*) into result;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  else select p.yacimiento_id into yid from public.equipos_unidades e join public.plantas_locaciones p on p.id = e.planta_id where e.id = parent_id;
    perform public.require_yacimiento_access(yid);
    if not exists (select 1 from public.yacimientos where id = yid and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can change hierarchy'; end if;
    insert into public.valvulas(equipo_id, nombre) values (parent_id, asset_name) returning to_jsonb(valvulas.*) into result;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('jerarquia', yid, (result->>'id')::uuid, auth.uid(), jsonb_build_object('event', 'created', 'kind', kind, 'parent_id', parent_id));
  end if;
  return result;
end;
$$;

create or replace function public.api_request_certificate(target uuid, provider uuid)
returns public.solicitudes_certificado language plpgsql security definer set search_path = public as $$
declare result public.solicitudes_certificado;
begin
  if not exists (select 1 from public.yacimientos where id = target and cliente_cuenta_id = auth.uid()) then raise exception using errcode = 'insufficient_privilege', message = 'Only the owner can request service'; end if;
  if not exists (select 1 from public.talleres_moviles where id = provider) then raise exception using errcode = 'foreign_key_violation', message = 'Taller Móvil not found'; end if;
  insert into public.solicitudes_certificado(yacimiento_id, taller_movil_id, solicitante_cuenta_id) values (target, provider, auth.uid()) returning * into result;
  return result;
end;
$$;

create or replace function public.api_accept_request(request_id uuid)
returns public.asignaciones_servicio language plpgsql security definer set search_path = public as $$
declare request public.solicitudes_certificado; provider uuid; old_assignment public.asignaciones_servicio; result public.asignaciones_servicio;
begin
  select * into request from public.solicitudes_certificado where id = request_id for update;
  select taller_movil_id into provider from public.taller_cuentas where cuenta_id = auth.uid();
  if request.id is null or provider is null or request.taller_movil_id <> provider or request.estado <> 'pendiente' then raise exception using errcode = 'insufficient_privilege', message = 'Cannot accept this request'; end if;
  select * into old_assignment from public.asignaciones_servicio where yacimiento_id = request.yacimiento_id and estado = 'activa' for update;
  if old_assignment.id is not null then
    update public.asignaciones_servicio set estado = 'finalizada', ended_at = now() where id = old_assignment.id;
    insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('servicio', request.yacimiento_id, old_assignment.id, auth.uid(), jsonb_build_object('event', 'replaced', 'taller_movil_id', old_assignment.taller_movil_id));
  end if;
  update public.solicitudes_certificado set estado = 'aceptada', decided_at = now() where id = request.id;
  insert into public.asignaciones_servicio(yacimiento_id, taller_movil_id, solicitud_id) values (request.yacimiento_id, provider, request.id) returning * into result;
  insert into public.historial_relaciones(tipo, yacimiento_id, relacion_id, actor_cuenta_id, datos) values ('servicio', request.yacimiento_id, result.id, auth.uid(), jsonb_build_object('event', 'accepted', 'taller_movil_id', provider));
  return result;
end;
$$;

alter table public.cuentas enable row level security;
alter table public.clientes enable row level security;
alter table public.talleres_moviles enable row level security;
alter table public.taller_cuentas enable row level security;
alter table public.yacimientos enable row level security;
alter table public.plantas_locaciones enable row level security;
alter table public.equipos_unidades enable row level security;
alter table public.valvulas enable row level security;
alter table public.solicitudes_certificado enable row level security;
alter table public.asignaciones_servicio enable row level security;
alter table public.historial_relaciones enable row level security;

-- Business APIs use the SECURITY DEFINER functions above. There is deliberately no
-- direct authenticated-table policy, preventing accidental bypass of the access seam.

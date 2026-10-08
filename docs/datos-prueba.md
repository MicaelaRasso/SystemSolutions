# Datos de prueba para SystemSolutions

Este fixture agrega un Cliente, un Taller Móvil y una jerarquía completa para probar las pantallas de administración de activos. Los nombres, correos y tags son ficticios. No crea Solicitudes de servicio, Visitas de servicio ni Certificados: créalos desde la aplicación para conservar sus validaciones y Registro de auditoría.

## Preparación

1. En **Supabase → Authentication → Users**, crea y confirma dos usuarios de prueba:
   - `qa.cliente@example.com` — acceso de Cliente.
   - `qa.taller@example.com` — acceso de Taller Móvil.
2. Abre **SQL Editor** en el proyecto de prueba y ejecuta el bloque completo de abajo. El bloque busca esos usuarios por correo y falla con un mensaje claro si falta alguno.
3. Inicia sesión con el usuario `qa.cliente@example.com` para probar el Portal del Cliente. Usa la cuenta `qa.taller@example.com` para el flujo del Taller Móvil.

No uses correos reales. El SQL no escribe en `auth.users` ni modifica archivos de migración; las identidades se crean desde Authentication.

Ejecuta este fixture en un proyecto de prueba. Las inserciones directas en SQL Editor no generan los eventos de auditoría que sí producen los flujos de la aplicación.

## Fixture SQL

```sql
begin;

do $$
declare
  client_auth_id uuid;
  workshop_auth_id uuid;
  existing_role public.rol;
  client_account_state public.estado_cuenta;
  workshop_account_state public.estado_cuenta;
begin
  select id into client_auth_id
  from auth.users
  where lower(email) = lower('qa.cliente@example.com');

  select id into workshop_auth_id
  from auth.users
  where lower(email) = lower('qa.taller@example.com');

  if client_auth_id is null or workshop_auth_id is null then
    raise exception 'Crea y confirma qa.cliente@example.com y qa.taller@example.com en Authentication antes de ejecutar este bloque';
  end if;

  if client_auth_id = workshop_auth_id then
    raise exception 'El Cliente y el Taller Móvil necesitan usuarios distintos';
  end if;

  select rol into existing_role from public.cuentas where id = client_auth_id;
  if existing_role is not null and existing_role <> 'cliente' then
    raise exception 'qa.cliente@example.com ya tiene un rol distinto de cliente';
  end if;

  select rol into existing_role from public.cuentas where id = workshop_auth_id;
  if existing_role is not null and existing_role <> 'taller_movil' then
    raise exception 'qa.taller@example.com ya tiene un rol distinto de taller_movil';
  end if;

  select case when email_confirmed_at is not null then 'activa'::public.estado_cuenta
              else 'pendiente'::public.estado_cuenta end
  into client_account_state from auth.users where id = client_auth_id;

  select case when email_confirmed_at is not null then 'activa'::public.estado_cuenta
              else 'pendiente'::public.estado_cuenta end
  into workshop_account_state from auth.users where id = workshop_auth_id;

  insert into public.cuentas (id, rol, estado, activo)
  values (client_auth_id, 'cliente', client_account_state, client_account_state = 'activa')
  on conflict (id) do nothing;

  insert into public.cuentas (id, rol, estado, activo)
  values (workshop_auth_id, 'taller_movil', workshop_account_state, workshop_account_state = 'activa')
  on conflict (id) do nothing;

  insert into public.clientes (
    cuenta_id, nombre, razon_social, cuit, contacto, telefono, email, direccion,
    aviso_vencimiento, activo
  ) values (
    client_auth_id, 'Operadora Demo', 'Operadora Demo S.A.', null,
    'Contacto de prueba', '+54 299 555 0101', 'qa.cliente@example.com',
    'Av. de Prueba 100, Neuquén', true, true
  )
  on conflict (cuenta_id) do update set
    nombre = excluded.nombre,
    razon_social = excluded.razon_social,
    contacto = excluded.contacto,
    telefono = excluded.telefono,
    email = excluded.email,
    direccion = excluded.direccion,
    aviso_vencimiento = excluded.aviso_vencimiento,
    activo = excluded.activo;

  insert into public.talleres_moviles (id, nombre, color, activo)
  values ('d0000000-0000-4000-8000-000000000001', 'Taller Móvil Demo', '#2563eb', true)
  on conflict (id) do update set nombre = excluded.nombre, color = excluded.color, activo = excluded.activo;

  insert into public.taller_cuentas (taller_movil_id, cuenta_id)
  values ('d0000000-0000-4000-8000-000000000001', workshop_auth_id)
  on conflict (cuenta_id) do update set taller_movil_id = excluded.taller_movil_id;

  insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
  values (
    'd0000000-0000-4000-8000-000000000010', client_auth_id,
    'Yacimiento Demo Norte', 'Neuquén', 'Operadora Demo', 'Servicios de Prueba S.R.L.'
  )
  on conflict (id) do update set
    cliente_cuenta_id = excluded.cliente_cuenta_id,
    nombre = excluded.nombre,
    provincia = excluded.provincia,
    operadora = excluded.operadora,
    contratista = excluded.contratista;

  insert into public.plantas_locaciones (id, yacimiento_id, nombre) values
    ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000010', 'Planta Compresión'),
    ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000010', 'Batería Tanques')
  on conflict (id) do update set yacimiento_id = excluded.yacimiento_id, nombre = excluded.nombre;

  insert into public.equipos_unidades (id, planta_id, nombre) values
    ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000011', 'Compresor CP-01'),
    ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000011', 'Separador SP-01'),
    ('d0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000012', 'Tanque TK-01')
  on conflict (id) do update set planta_id = excluded.planta_id, nombre = excluded.nombre;

  insert into public.valvulas (id, equipo_id, nombre) values
    ('d0000000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000021', 'PSV-CP01-001'),
    ('d0000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000021', 'PSV-CP01-002'),
    ('d0000000-0000-4000-8000-000000000033', 'd0000000-0000-4000-8000-000000000022', 'PSV-SP01-001'),
    ('d0000000-0000-4000-8000-000000000034', 'd0000000-0000-4000-8000-000000000023', 'PSV-TK01-001')
  on conflict (id) do update set equipo_id = excluded.equipo_id, nombre = excluded.nombre;

  insert into public.personas (id, nombre, apellido, dni, activo) values
    ('d0000000-0000-4000-8000-000000000041', 'Técnico', 'Demo Uno', '90000001', true),
    ('d0000000-0000-4000-8000-000000000042', 'Técnico', 'Demo Dos', '90000002', true)
  on conflict (id) do update set
    nombre = excluded.nombre, apellido = excluded.apellido, dni = excluded.dni, activo = excluded.activo;

  insert into public.nominas_jornada (taller_movil_id, fecha, persona_ids)
  values (
    'd0000000-0000-4000-8000-000000000001', current_date,
    array['d0000000-0000-4000-8000-000000000041'::uuid, 'd0000000-0000-4000-8000-000000000042'::uuid]
  )
  on conflict (taller_movil_id, fecha) do update set persona_ids = excluded.persona_ids;
end $$;

commit;
```

Confirma que se cargó la jerarquía con esta consulta:

```sql
select
  y.nombre as yacimiento,
  p.nombre as planta,
  e.nombre as equipo,
  v.nombre as valvula
from public.yacimientos y
join public.plantas_locaciones p on p.yacimiento_id = y.id
join public.equipos_unidades e on e.planta_id = p.id
join public.valvulas v on v.equipo_id = e.id
where y.id = 'd0000000-0000-4000-8000-000000000010'
order by p.nombre, e.nombre, v.nombre;
```

## Recorrido sugerido en la app

1. Como Administrador, comprueba el Cliente **Operadora Demo** y su Yacimiento **Yacimiento Demo Norte** con dos Plantas/locaciones, tres Equipos/unidades y cuatro Válvulas.
2. Crea una Solicitud de servicio para el Yacimiento y selecciona la Planta **Planta Compresión** (incluye sus dos Válvulas).
3. Programa y asigna la Visita de servicio a **Taller Móvil Demo**.
4. Acepta la visita con la cuenta del Taller Móvil; registra el Técnico ejecutor, evalúa las Ordenes de trabajo y completa la captura según el flujo normal.
5. Usa la cuenta del Cliente para revisar el Portal, firmar Certificados pendientes y consultar los Certificados finalizados.

El fixture puede ejecutarse de nuevo: conserva los mismos IDs y actualiza esos registros de demostración. Para retirarlo, borra primero los registros operativos que hayas creado desde la aplicación; luego elimina las Válvulas, Equipos/unidades, Plantas/locaciones y Yacimiento con los IDs del bloque. La eliminación de registros no borra las identidades Auth.

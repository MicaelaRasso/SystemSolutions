-- P8: el logo del Cliente llega al certificado finalizado.
-- `api_set_client_logo` / `api_set_own_client_logo` guardan el logo en `clientes.logo_bucket` y
-- `clientes.logo_path`; la finalización lo leía de `logo_imagen_id`, que nada escribe.
begin;

select plan(8);

-- Dos Clientes: uno con logo (A) y otro sin logo (B), cada uno con una visita firmada y un
-- certificado cerrado, listo para finalizar.
create function public.p8_logo_id(n integer, parte integer)
returns uuid language sql immutable as $fn$
  select format('00000000-0000-0000-%s-%s', lpad(n::text, 4, '0'), lpad(parte::text, 12, '0'))::uuid
$fn$;

create function public.p8_logo_fixture(n integer)
returns void language plpgsql as $fn$
begin
  insert into auth.users (id, email) values (public.p8_logo_id(n, 1), format('p8-logo-%s@example.test', n));
  insert into public.cuentas (id, rol) values (public.p8_logo_id(n, 1), 'cliente');
  insert into public.clientes (cuenta_id, nombre) values (public.p8_logo_id(n, 1), format('Cliente logo %s', n));
  insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
    values (public.p8_logo_id(n, 2), public.p8_logo_id(n, 1), format('Yacimiento %s', n), 'Neuquen', 'Operadora', 'Contratista');
  insert into public.plantas_locaciones (id, yacimiento_id, nombre) values (public.p8_logo_id(n, 3), public.p8_logo_id(n, 2), 'Planta');
  insert into public.equipos_unidades (id, planta_id, nombre) values (public.p8_logo_id(n, 4), public.p8_logo_id(n, 3), 'Equipo');
  insert into public.valvulas (id, equipo_id, nombre) values (public.p8_logo_id(n, 5), public.p8_logo_id(n, 4), format('V-%s', n));
  insert into public.solicitudes_servicio (id, cliente_cuenta_id, yacimiento_id)
    values (public.p8_logo_id(n, 6), public.p8_logo_id(n, 1), public.p8_logo_id(n, 2));
  insert into public.visitas_servicio (id, solicitud_id, yacimiento_id, estado, starts_at, ends_at, replacement_catalog_version_id)
    values (public.p8_logo_id(n, 7), public.p8_logo_id(n, 6), public.p8_logo_id(n, 2), 'programada', now(), now() + interval '1 hour',
      (select id from public.replacement_catalog_versions order by created_at desc limit 1));
  insert into public.ordenes_trabajo (id, visita_id, valvula_id, estado)
    values (public.p8_logo_id(n, 8), public.p8_logo_id(n, 7), public.p8_logo_id(n, 5), 'evaluada');
  insert into public.valvula_revisiones (id, valvula_id, datos) values (public.p8_logo_id(n, 9), public.p8_logo_id(n, 5), '{}');
  insert into public.certificados (
    id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id, equipo_id,
    valvula_revision_id, estado, estado_captura, fecha_ejecucion, tecnico_ejecutor,
    datos_tecnicos, alcance_mantenimiento, repuestos, evidencia_fotografica,
    plantilla_version, plantilla_version_id, plantilla_snapshot, replacement_catalog_version_id
  ) values (
    public.p8_logo_id(n, 10), public.p8_logo_id(n, 8), public.p8_logo_id(n, 7), public.p8_logo_id(n, 5),
    public.p8_logo_id(n, 2), public.p8_logo_id(n, 3), public.p8_logo_id(n, 4), public.p8_logo_id(n, 9),
    'pendiente', 'cerrado', '2026-03-10', 'Tomas Tecnico',
    '{"valvula":{"tag":"V-P8","marca":"Farris"},"ensayos":{"patron":{"id":"p1","label":"FLUKE"},"sp_inicial":{"valor":10,"unidad":"Kg/Cm2"},"sp_apertura":{"valor":11,"unidad":"Kg/Cm2"},"presion_cierre":{"valor":12,"unidad":"Kg/Cm2"}}}',
    '[]', '{"catalog_version":"v1","items":[],"otros":null}',
    '{"desarmada":null,"ensamblada_prueba":null,"placa_precinto":null}',
    'p8-logo',
    (select id from public.plantillas_certificado order by created_at limit 1),
    '{"version":"p8-logo","campos":[]}',
    (select id from public.replacement_catalog_versions order by created_at desc limit 1)
  );
  insert into storage.objects (bucket_id, name) values ('certificate-signatures', format('p8/%s.png', n));
  insert into public.imagenes_certificado (id, bucket, object_path, categoria)
    values (public.p8_logo_id(n, 11), 'certificate-signatures', format('p8/%s.png', n), 'firma');
  -- La firma presencial del Cliente va antes que la del Técnico.
  insert into public.firmas_visita (visita_id, parte, nombre_firmante, imagen_id) values
    (public.p8_logo_id(n, 7), 'cliente', 'Firmante Cliente', public.p8_logo_id(n, 11));
  insert into public.firmas_visita (visita_id, parte, nombre_firmante, imagen_id) values
    (public.p8_logo_id(n, 7), 'tecnico', 'Firmante Tecnico', public.p8_logo_id(n, 11));
end;
$fn$;

select public.p8_logo_fixture(9801);
select public.p8_logo_fixture(9802);

-- El logo de A se carga como lo hace la Edge Function (`api_set_client_logo`).
insert into storage.objects (bucket_id, name)
values ('client-logos', 'clients/00000000-0000-0000-9801-000000000001/p8-logo.png');
update public.clientes
set logo_bucket = 'client-logos', logo_path = 'clients/00000000-0000-0000-9801-000000000001/p8-logo.png'
where cuenta_id = public.p8_logo_id(9801, 1);

select is(
  jsonb_array_length(public.api_finalize_visit_certificates(public.p8_logo_id(9801, 7))),
  1,
  'P8 setup: the signed certificate of the Cliente with a logo is finalized'
);
select is(
  (select instantanea->'client_logo' from public.certificados where id = public.p8_logo_id(9801, 10)),
  '{"bucket":"client-logos","object_path":"clients/00000000-0000-0000-9801-000000000001/p8-logo.png"}'::jsonb,
  'P8: the finalized certificate snapshots the Cliente logo stored by api_set_client_logo'
);
select is(
  jsonb_array_length(public.api_finalize_visit_certificates(public.p8_logo_id(9802, 7))),
  1,
  'P8 setup: the signed certificate of the Cliente without a logo is finalized'
);
select ok(
  (select coalesce(jsonb_typeof(instantanea->'client_logo'), 'null') = 'null' from public.certificados where id = public.p8_logo_id(9802, 10)),
  'P8: a Cliente without a logo leaves no logo on the certificate'
);

-- Backfill: certificados finalizados antes del arreglo quedaron sin logo. Se simula quitándolo.
alter table public.certificados disable trigger certificados_closed_immutable;
update public.certificados
set instantanea = jsonb_set(instantanea, '{client_logo}', 'null'::jsonb)
where id = public.p8_logo_id(9801, 10);
alter table public.certificados enable trigger certificados_closed_immutable;

select is(
  public.backfill_finalized_certificate_client_logos(),
  1,
  'P8 backfill: only the certificate finalized while the logo already existed is completed'
);
select is(
  (select instantanea->'client_logo'->>'object_path' from public.certificados where id = public.p8_logo_id(9801, 10)),
  'clients/00000000-0000-0000-9801-000000000001/p8-logo.png',
  'P8 backfill: the certificate gets back the logo the Cliente had when it was finalized'
);

-- Un logo subido después de la finalización no se agrega: no era el logo de ese momento.
alter table public.certificados disable trigger certificados_closed_immutable;
update public.certificados
set instantanea = jsonb_set(instantanea, '{client_logo}', 'null'::jsonb)
where id = public.p8_logo_id(9801, 10);
alter table public.certificados enable trigger certificados_closed_immutable;
update storage.objects
set created_at = (select finalized_at from public.certificados where id = public.p8_logo_id(9801, 10)) + interval '1 day'
where bucket_id = 'client-logos' and name = 'clients/00000000-0000-0000-9801-000000000001/p8-logo.png';

select is(
  public.backfill_finalized_certificate_client_logos(),
  0,
  'P8 backfill: a logo uploaded after the finalization is not added to the certificate'
);

select throws_ok(
  format($$update public.certificados set observaciones = 'x' where id = %L$$, public.p8_logo_id(9801, 10)),
  '23514',
  'Closed certificate data is immutable; create a replacement certificate',
  'P8 backfill: finalized certificates stay immutable afterwards'
);

select * from finish();
rollback;

-- RNF-11, CA-11, RN-12, RN-08, CA-04: numeración de certificados.
-- Las sesiones concurrentes usan dblink y siempre terminan en rollback: no dejan datos ni consumen
-- números del contador real.
begin;

select plan(13);

create extension if not exists dblink with schema extensions;

create function public.req_num_id(n integer, parte integer)
returns uuid language sql immutable as $fn$
  select format('00000000-0000-0000-%s-%s', lpad(n::text, 4, '0'), lpad(parte::text, 12, '0'))::uuid
$fn$;

-- Sentencias de una visita con un certificado cerrado, listo para finalizar.
-- Devuelve SQL para poder correrlo también dentro de otra sesión.
create function public.req_num_fixture(n integer, ejecucion date, firmas text[])
returns text language sql as $fn$
  select format($sql$
    insert into auth.users (id, email) values ('%1$s', 'req-num-%2$s@example.test');
    insert into public.cuentas (id, rol) values ('%1$s', 'cliente');
    insert into public.clientes (cuenta_id, nombre) values ('%1$s', 'Cliente %2$s');
    insert into public.yacimientos (id, cliente_cuenta_id, nombre, provincia, operadora, contratista)
      values ('%3$s', '%1$s', 'Yacimiento %2$s', 'Neuquen', 'Operadora', 'Contratista');
    insert into public.plantas_locaciones (id, yacimiento_id, nombre) values ('%4$s', '%3$s', 'Planta %2$s');
    insert into public.equipos_unidades (id, planta_id, nombre) values ('%5$s', '%4$s', 'Equipo %2$s');
    insert into public.valvulas (id, equipo_id, nombre) values ('%6$s', '%5$s', 'V-%2$s');
    insert into public.solicitudes_servicio (id, cliente_cuenta_id, yacimiento_id)
      values ('%7$s', '%1$s', '%3$s');
    insert into public.visitas_servicio (id, solicitud_id, yacimiento_id, estado, starts_at, ends_at, replacement_catalog_version_id)
      values ('%8$s', '%7$s', '%3$s', 'programada', now(), now() + interval '1 hour',
        (select id from public.replacement_catalog_versions order by created_at desc limit 1));
    insert into public.ordenes_trabajo (id, visita_id, valvula_id, estado) values ('%9$s', '%8$s', '%6$s', 'evaluada');
    insert into public.valvula_revisiones (id, valvula_id, datos) values ('%10$s', '%6$s', '{}');
    insert into public.certificados (
      id, orden_trabajo_id, visita_id, valvula_id, yacimiento_id, planta_id, equipo_id,
      valvula_revision_id, estado, estado_captura, fecha_ejecucion, tecnico_ejecutor,
      datos_tecnicos, alcance_mantenimiento, repuestos, evidencia_fotografica,
      plantilla_version, plantilla_version_id, plantilla_snapshot, replacement_catalog_version_id
    ) values (
      '%11$s', '%9$s', '%8$s', '%6$s', '%3$s', '%4$s', '%5$s', '%10$s', 'pendiente', 'cerrado',
      %12$L, 'Tomas Tecnico',
      '{"valvula":{"tag":"V-%2$s","marca":"Farris"},"ensayos":{"patron":{"id":"p1","label":"FLUKE"},"sp_inicial":{"valor":10,"unidad":"Kg/Cm2"},"sp_apertura":{"valor":11,"unidad":"Kg/Cm2"},"presion_cierre":{"valor":12,"unidad":"Kg/Cm2"}}}',
      '[]', '{"catalog_version":"v1","items":[],"otros":null}', '{}',
      'req-numeracion',
      (select id from public.plantillas_certificado order by created_at limit 1),
      '{"version":"req-numeracion","campos":[]}',
      (select id from public.replacement_catalog_versions order by created_at desc limit 1)
    );
    insert into storage.objects (bucket_id, name) values ('certificate-signatures', 'req/%2$s.png');
    insert into public.imagenes_certificado (id, bucket, object_path, categoria)
      values ('%13$s', 'certificate-signatures', 'req/%2$s.png', 'firma');
    %14$s
  $sql$,
    public.req_num_id(n, 1), n, public.req_num_id(n, 2), public.req_num_id(n, 3), public.req_num_id(n, 4),
    public.req_num_id(n, 5), public.req_num_id(n, 6), public.req_num_id(n, 7), public.req_num_id(n, 8),
    public.req_num_id(n, 9), public.req_num_id(n, 10), ejecucion, public.req_num_id(n, 11),
    (select coalesce(string_agg(format(
       $f$insert into public.firmas_visita (visita_id, parte, nombre_firmante, imagen_id) values ('%s', '%s', 'Firmante Prueba', '%s');$f$,
       public.req_num_id(n, 7), parte, public.req_num_id(n, 11)), ' '), '')
     from unnest(firmas) parte)
  )
$fn$;

create function public.req_num_correr(sentencias text) returns void language plpgsql as $fn$
begin
  execute sentencias;
end;
$fn$;

create function public.req_num_siguiente() returns bigint language sql stable as $fn$
  select siguiente_numero from public.contador_certificados where id = true
$fn$;

-- Tres visitas firmadas, una con dos firmas pendientes, una incompleta.
select public.req_num_correr(public.req_num_fixture(9101, '2026-03-10', array['tecnico', 'cliente']));
select public.req_num_correr(public.req_num_fixture(9102, '2026-03-11', array['tecnico', 'cliente']));
select public.req_num_correr(public.req_num_fixture(9103, '2026-03-12', array['tecnico', 'cliente']));
select public.req_num_correr(public.req_num_fixture(9104, '2026-03-13', array['tecnico']));
select public.req_num_correr(public.req_num_fixture(9105, '2026-03-14', array['tecnico', 'cliente']));

create temporary table req_inicio on commit drop as select public.req_num_siguiente() as valor;

-- RN-12: sin ambas firmas no se numera ni se consume el contador.
select is(
  jsonb_array_length(public.api_finalize_visit_certificates(public.req_num_id(9104, 7))),
  0,
  'RN-12: sin la firma del Cliente no se finaliza ningún certificado'
);
select is(
  (select numero from public.certificados where id = public.req_num_id(9104, 10)),
  null::bigint,
  'RN-12: el certificado sin ambas firmas sigue sin número'
);
select is(public.req_num_siguiente(), (select valor from req_inicio), 'RN-12: el contador no se consume sin ambas firmas');

-- CA-11: un certificado incompleto no deja un salto en la numeración.
alter table public.certificados disable trigger certificados_closed_immutable;
update public.certificados set fecha_ejecucion = null where id = public.req_num_id(9105, 10);
alter table public.certificados enable trigger certificados_closed_immutable;
select public.api_finalize_visit_certificates(public.req_num_id(9105, 7));
select is(public.req_num_siguiente(), (select valor from req_inicio), 'CA-11: un certificado incompleto no consume número');

-- RNF-11, CA-11: correlativos, sin duplicados ni saltos.
select public.api_finalize_visit_certificates(public.req_num_id(9101, 7));
select public.api_finalize_visit_certificates(public.req_num_id(9102, 7));
select public.api_finalize_visit_certificates(public.req_num_id(9103, 7));

select results_eq(
  $$select numero from public.certificados
    where id in (public.req_num_id(9101, 10), public.req_num_id(9102, 10), public.req_num_id(9103, 10))
    order by numero$$,
  $$select generate_series(valor, valor + 2) from req_inicio$$,
  'RNF-11 CA-11: tres finalizaciones reciben números correlativos desde el contador'
);
select is(
  (select count(*) from (select numero from public.certificados where numero is not null group by numero having count(*) > 1) d),
  0::bigint,
  'RNF-11 CA-11: ningún número se repite'
);
select throws_ok(
  format(
    $$update public.certificados set numero = %s where id = '%s'$$,
    (select numero from public.certificados where id = public.req_num_id(9101, 10)),
    public.req_num_id(9102, 10)
  ),
  null,
  null,
  'RNF-11: la base rechaza asignar un número ya usado'
);

-- RNF-04: finalizar de nuevo una visita no consume otro número ni cambia el emitido.
select is(
  jsonb_array_length(public.api_finalize_visit_certificates(public.req_num_id(9101, 7))),
  0,
  'RNF-04: repetir la finalización no vuelve a emitir'
);
select is(public.req_num_siguiente(), (select valor + 3 from req_inicio), 'RNF-04: repetir la finalización no consume el contador');

-- RN-08, CA-04: la fecha del servicio es la ejecución real, aunque se finalice después.
select is(
  (select fecha_ejecucion from public.certificados where id = public.req_num_id(9101, 10)),
  '2026-03-10'::date,
  'RN-08 CA-04: la fecha de ejecución no cambia al finalizar más tarde'
);
select is(
  (select vigencia_hasta from public.certificados where id = public.req_num_id(9101, 10)),
  '2027-03-10'::date,
  'RN-01 RN-08: la vigencia se cuenta desde la ejecución, no desde la sincronización'
);

-- RNF-11: dos sesiones reales: la segunda espera a que la primera libere el contador.
select extensions.dblink_connect('req_a', 'dbname=' || current_database() || ' user=postgres');
select extensions.dblink_connect('req_b', 'dbname=' || current_database() || ' user=postgres');
select extensions.dblink_exec('req_a', 'begin');
select extensions.dblink_exec('req_b', 'begin');
select extensions.dblink_exec(c, sentencias)
from (values
  ('req_a', public.req_num_fixture(9201, '2026-04-01', array['tecnico', 'cliente'])),
  ('req_b', public.req_num_fixture(9202, '2026-04-02', array['tecnico', 'cliente']))
) as f(c, sentencias);
select * from extensions.dblink('req_a', format(
  $$select jsonb_array_length(public.api_finalize_visit_certificates('%s'))$$, public.req_num_id(9201, 7)
)) as r(emitidos integer);
select extensions.dblink_send_query('req_b', format(
  $$select jsonb_array_length(public.api_finalize_visit_certificates('%s'))$$, public.req_num_id(9202, 7)
));
select pg_sleep(0.5);
select is(
  extensions.dblink_is_busy('req_b'),
  1,
  'RNF-11 CA-11: una finalización simultánea espera a la otra en lugar de numerar a la vez'
);
select extensions.dblink_exec('req_a', 'rollback');
select pg_sleep(0.5);
select is(
  (select emitidos from extensions.dblink_get_result('req_b') as r(emitidos integer)),
  1,
  'RNF-11 CA-11: al liberarse el contador, la segunda finalización continúa sin error'
);
select extensions.dblink_exec('req_b', 'rollback');
select extensions.dblink_disconnect('req_a');
select extensions.dblink_disconnect('req_b');

select * from extensions.finish(true);
rollback;

-- P8: el logo del Cliente nunca llegaba al certificado.
--
-- La subida del logo (`api_set_client_logo` y `api_set_own_client_logo`, Edge Function
-- `asset-access`) guarda la referencia en `clientes.logo_bucket` / `clientes.logo_path`, pero
-- `api_finalize_visit_certificates` armaba `instantanea.client_logo` desde
-- `clientes.logo_imagen_id`, una columna que nada escribe. Todo certificado se finalizaba sin logo.
--
-- 1. `certificate_client_logo` resuelve el logo desde donde realmente se guarda (y conserva la
--    columna vieja como respaldo). Devuelve `{bucket, object_path}`, la forma que la Edge Function
--    `certificate-field` firma (bucket `client-logos`) y que la vista del certificado muestra.
-- 2. `api_finalize_visit_certificates` (base: 20260926211000) usa ese helper; el resto es igual.
-- 3. Backfill de los certificados ya finalizados sin logo: solo cuando el objeto del logo actual
--    del Cliente ya existía al momento de la finalización (`storage.objects.created_at <=
--    finalized_at`). Cada subida crea un objeto nuevo (`clients/<id>/<uuid>-<archivo>`), así que
--    ese objeto es exactamente el logo que el Cliente tenía configurado cuando se finalizó. Si el
--    logo se cambió o se quitó después, no se agrega nada (no se puede saber cuál era).
begin;

create or replace function public.certificate_client_logo(target_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when i.id is not null then
      jsonb_build_object('id', i.id, 'bucket', i.bucket, 'object_path', i.object_path)
    when nullif(cl.logo_bucket, '') is not null and nullif(cl.logo_path, '') is not null then
      jsonb_build_object('bucket', cl.logo_bucket, 'object_path', cl.logo_path)
    else null
  end
  from public.clientes cl
  left join public.imagenes_certificado i on i.id = cl.logo_imagen_id
  where cl.cuenta_id = target_client;
$$;

revoke all on function public.certificate_client_logo(uuid) from public, anon, authenticated;

create or replace function public.api_finalize_visit_certificates(target_visit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.certificados;
  y public.yacimientos;
  p public.plantas_locaciones;
  e public.equipos_unidades;
  x public.valvulas;
  r public.valvula_revisiones;
  client_logo jsonb;
  counter bigint;
  finalized jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.firmas_visita where visita_id = target_visit and parte = 'tecnico')
     or not exists (select 1 from public.firmas_visita where visita_id = target_visit and parte = 'cliente') then
    return finalized;
  end if;

  select * into y from public.yacimientos where id = (select yacimiento_id from public.visitas_servicio where id = target_visit);
  select * into p from public.plantas_locaciones where id = (select planta_id from public.certificados where visita_id = target_visit limit 1);
  select * into e from public.equipos_unidades where id = (select equipo_id from public.certificados where visita_id = target_visit limit 1);
  client_logo := public.certificate_client_logo(y.cliente_cuenta_id);

  -- The single counter row serializes all finalizations globally.
  perform 1 from public.contador_certificados where id = true for update;
  for c in
    select * from public.certificados
    where visita_id = target_visit and estado_captura = 'cerrado' and estado = 'pendiente'
    order by id
    for update
  loop
    if not ((public.api_certificate_validation(c)->>'complete')::boolean) then
      continue;
    end if;

    select * into r from public.valvula_revisiones where id = c.valvula_revision_id;
    select * into x from public.valvulas where id = c.valvula_id;
    select * into e from public.equipos_unidades where id = c.equipo_id;
    select * into p from public.plantas_locaciones where id = c.planta_id;
    select * into y from public.yacimientos where id = c.yacimiento_id;

    update public.contador_certificados
    set siguiente_numero = siguiente_numero + 1
    where id = true
    returning siguiente_numero - 1 into counter;

    update public.certificados
    set estado = 'finalizado',
        numero = counter,
        finalized_at = now(),
        instantanea = jsonb_build_object(
          'yacimiento', coalesce(c.contexto_captura->'yacimiento', to_jsonb(y)),
          'planta', coalesce(c.contexto_captura->'planta', to_jsonb(p)),
          'equipo', coalesce(c.contexto_captura->'equipo', to_jsonb(e)),
          'valvula', coalesce(c.contexto_captura->'valvula', r.datos, to_jsonb(x)),
          'valvula_revision_id', r.id,
          'captured_at', r.created_at,
          'client_logo', client_logo
        ),
        updated_at = now()
    where id = c.id
    returning * into c;

    finalized := finalized || jsonb_build_array(to_jsonb(c));
  end loop;
  return finalized;
end;
$$;

-- Completa `instantanea.client_logo` en los certificados finalizados que quedaron sin logo, con
-- el logo que el Cliente ya tenía al finalizarse. Devuelve cuántos certificados completó.
-- Solo para el dueño de la base (migración y tests); nunca se expone por la API.
create or replace function public.backfill_finalized_certificate_client_logos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  -- Los certificados cerrados son inmutables (`certificados_closed_immutable`); el backfill solo
  -- toca `instantanea.client_logo` y vuelve a activar el trigger en la misma transacción.
  alter table public.certificados disable trigger certificados_closed_immutable;

  update public.certificados c
  set instantanea = jsonb_set(
    c.instantanea,
    '{client_logo}',
    jsonb_build_object('bucket', cl.logo_bucket, 'object_path', cl.logo_path)
  )
  from public.yacimientos y, public.clientes cl, storage.objects o
  where c.estado = 'finalizado'
    and c.instantanea is not null
    and coalesce(jsonb_typeof(c.instantanea->'client_logo'), 'null') = 'null'
    and y.id = c.yacimiento_id
    and cl.cuenta_id = y.cliente_cuenta_id
    and nullif(cl.logo_bucket, '') is not null
    and nullif(cl.logo_path, '') is not null
    and o.bucket_id = cl.logo_bucket
    and o.name = cl.logo_path
    and o.created_at <= c.finalized_at;
  get diagnostics updated = row_count;

  alter table public.certificados enable trigger certificados_closed_immutable;
  return updated;
end;
$$;

revoke all on function public.backfill_finalized_certificate_client_logos() from public, anon, authenticated, service_role;

select public.backfill_finalized_certificate_client_logos();

commit;

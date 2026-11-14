begin;

-- S4: el alta de una tarea eran tres llamadas independientes desde el navegador (crear la
-- solicitud, guardar su metadata y programar la visita). Si la programación fallaba quedaba una
-- solicitud huérfana y el reintento la duplicaba. Este comando hace las tres cosas en una sola
-- transacción reutilizando los RPC existentes: cualquier error revierte todo.
create or replace function public.api_admin_create_service_request_with_visit(
  target_client uuid,
  target_yacimiento uuid,
  selections jsonb,
  request_metadata jsonb default null,
  provider_id uuid default null,
  visit_starts_at timestamptz default null,
  visit_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created jsonb;
  new_request_id uuid;
  scheduled jsonb;
begin
  -- Sin taller no se crea la visita: una ventana sin taller se descartaría en silencio.
  if provider_id is null and (visit_starts_at is not null or visit_ends_at is not null) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'A visit window requires a Taller Móvil';
  end if;

  -- Valida al Administrador, al Cliente y al Yacimiento, y registra el historial.
  created := public.api_admin_create_service_request(target_client, target_yacimiento, selections);
  new_request_id := (created->'request'->>'id')::uuid;

  if request_metadata is not null then
    created := public.api_update_admin_service_request_metadata(new_request_id, request_metadata);
  end if;

  if provider_id is not null then
    scheduled := public.api_schedule_visit(new_request_id, provider_id, visit_starts_at, visit_ends_at);
  end if;

  return created || jsonb_build_object('scheduled_visit', scheduled);
end;
$$;

revoke all on function public.api_admin_create_service_request_with_visit(
  uuid, uuid, jsonb, jsonb, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.api_admin_create_service_request_with_visit(
  uuid, uuid, jsonb, jsonb, uuid, timestamptz, timestamptz
) to service_role;

commit;

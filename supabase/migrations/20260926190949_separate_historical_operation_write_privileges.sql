begin;

-- Keep the historical routines available for migrations that still reference
-- them, but remove them from the service_role operations read API.
revoke execute on function public.api_operation_row(uuid)
  from service_role;

revoke execute on function public.api_create_operation(
  uuid, uuid, text, uuid, jsonb, uuid, timestamptz, timestamptz
)
  from service_role;

revoke execute on function public.api_update_operation(
  uuid, jsonb, uuid, timestamptz, timestamptz
)
  from service_role;

commit;

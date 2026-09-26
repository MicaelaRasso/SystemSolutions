begin;

-- Application data has one ingress: service-access.  The function verifies a
-- browser session, then uses its server-only service_role credential to call
-- the Data API.  It forwards the authenticated Cuenta id in this header; the
-- Data API must not trust a browser-provided JWT or actor header.
create or replace function public.require_systemsolutions_edge_gateway()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  -- PostgREST has used all three settings across supported versions.  Prefer
  -- the legacy scalar claim when present, then the current JSON settings.
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
  if not exists (select 1 from public.cuentas where id = actor_id) then
    raise insufficient_privilege using message = 'SystemSolutions Edge gateway required';
  end if;

  -- auth.uid() in the existing domain RPCs reads this transaction-local claim.
  -- The service JWT authenticates the gateway; this claim restores the real
  -- Cuenta identity only after the gateway and actor have both been verified.
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
end;
$$;

-- Direct browser access cannot reach application tables, sequences, helpers,
-- or business RPCs.  service_role remains the sole business-RPC executor
-- because the Edge Function calls PostgREST with that server-only credential.
-- The pre-request guard is the deliberate exception: PostgREST must execute it
-- under every request role so that it can reject non-service-role requests.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

do $$
declare
  api_routine record;
begin
  for api_routine in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'api\_%' escape '\'
  loop
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      api_routine.nspname,
      api_routine.proname,
      api_routine.arguments
    );
  end loop;
end;
$$;

grant execute on function public.require_systemsolutions_edge_gateway()
  to anon, authenticated, service_role, authenticator;

-- PostgreSQL otherwise grants EXECUTE on new functions to PUBLIC.  Keep that
-- default closed for objects subsequently created by the migration owner.  New
-- exposed business RPCs must opt in explicitly with a service_role grant.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- PostgREST runs this before dispatching every Data API request.  The check is
-- intentionally independent of RLS: it rejects anon and authenticated JWTs
-- before they can invoke an RPC, while the RPCs still perform domain-level
-- authorization using the actor identity set above.
alter role authenticator set pgrst.db_pre_request = 'public.require_systemsolutions_edge_gateway';
notify pgrst, 'reload config';

commit;

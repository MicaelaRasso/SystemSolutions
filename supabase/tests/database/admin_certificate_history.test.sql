-- pgTAP no tiene like() con descripción: la comparación por patrón es alike().
begin;

select plan(9);

select has_function(
  'public', 'api_admin_certificate_history',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'date', 'text', 'integer', 'integer', 'text']::text[], -- 20261102010000 agregó pd_filter.
  'administrative certificate history exposes all supported filters'
);
select is(
  has_function_privilege('service_role', 'public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)', 'execute'),
  true, 'only the server capability can execute administrative certificate history'
);
select is(
  has_function_privilege('authenticated', 'public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)', 'execute'),
  false, 'browser accounts cannot bypass the administrative Edge capability'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)'::regprocedure),
  '%api_audit_require_admin%', 'the history API uses the existing role authorization model'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)'::regprocedure),
  '%cliente_email%', 'search and results include the Cliente identity'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)'::regprocedure),
  '%signature_state_filter%', 'history can filter visit-level signature state'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate_history(uuid,uuid,uuid,uuid,text,text,date,text,integer,integer,text)'::regprocedure),
  '%c.estado::text = state_filter%', 'history preserves pending and finalized state filters'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate(uuid)'::regprocedure),
  '%h.created_at asc%', 'same-Válvula history is complete and ordered from earlier certificates'
);
select alike(
  pg_get_functiondef('public.api_admin_certificate(uuid)'::regprocedure),
  '%firma_visita_registrada%', 'certificate detail includes directly related visit signature events'
);

select * from finish();

begin;

select plan(13);

select has_function(
  'public',
  'api_offline_submit_signature',
  array['uuid', 'parte_firma_visita', 'text', 'text', 'text', 'uuid', 'timestamptz']::text[],
  'offline signature submission keeps its evidence-specific server seam'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)',
    'execute'
  ),
  false,
  'browser sessions cannot bypass the Edge synchronization gateway'
);

select is(
  has_function_privilege(
    'service_role',
    'public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)',
    'execute'
  ),
  true,
  'the authenticated Edge gateway can register offline signatures'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%coalesce($7, now()), canonical_method, actor%',
  'the device event timestamp is persisted on the visit signature'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%pwa_tecnico%pwa_cliente_presencial%',
  'offline signatures use canonical capture method values'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%''image_id'', image_id%',
  'the acknowledgement returns the image reference associated with the signature'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%target_image_id,%',
  'the device image identity is persisted on the signature evidence row'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%Signature image identity does not match its storage path%',
  'the image identity must match the uploaded signature object path'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%|| signing_party::text ||%',
  'the Storage path party must match the signature party'
);

select like(
  pg_get_functiondef('public.api_offline_submit_signature(uuid,public.parte_firma_visita,text,text,text,uuid,timestamptz)'::regprocedure),
  '%target_image_id is null%',
  'offline signature identity is required'
);

select like(
  pg_get_functiondef('public.api_sync_visit_batch(uuid,jsonb,uuid)'::regprocedure),
  '%op_device_timestamp%',
  'offline synchronization passes the device event timestamp into signature capture'
);

select like(
  pg_get_functiondef('public.api_sync_visit_batch(uuid,jsonb,uuid)'::regprocedure),
  '%if stored.id is not null then%',
  'an accepted operation replay returns its stored acknowledgement'
);

select like(
  pg_get_functiondef('public.api_sync_visit_batch(uuid,jsonb,uuid)'::regprocedure),
  '%''result'', stored.result%',
  'an accepted operation replay returns its original result without reinserting evidence'
);

select * from extensions.finish(true);

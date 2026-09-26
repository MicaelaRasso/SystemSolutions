# Service-access API

Apply the migration with `supabase db push`, then serve the function with
`supabase functions serve service-access`. The function expects a Supabase
Bearer token and exposes:

## Required Edge configuration

`service-access` verifies the caller with `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, then calls database RPCs with the server-only
`SUPABASE_SERVICE_ROLE_KEY` and the validated Cuenta identity. These keys must
never be exposed through a `NEXT_PUBLIC_` variable.

Set `ALLOWED_ORIGINS` to a comma-separated list of browser origins (for
example, the deployed application and `http://localhost:3000`). CORS is denied
unless an origin is explicitly listed; `ALLOWED_ORIGIN` remains supported as a
single-origin compatibility setting.

- `GET /context`
- `GET|POST /yacimientos` (`POST` body: `{ "name": "...", "provincia": "...", "operadora": "...", "contratista": "..." }`)
- `PATCH /yacimientos/:id` (same body as `POST`)
- `GET /yacimientos/:id/tree`
- `GET /yacimientos/:id/assignment`
- `POST /hierarchy` (`{ "kind": "planta|equipo|valvula", "parent_id": "...", "name": "..." }`)
- `PATCH /hierarchy/:id` (`{ "kind": "planta|equipo|valvula", "name": "..." }`)
- `GET|POST /requests` (`POST` body: `{ "yacimiento_id": "...", "selections": [{ "kind": "yacimiento|planta|equipo|valvula", "id": "..." }] }`)
- `GET|PATCH /requests/:id` (`PATCH` body: `{ "selections": [...] }`)
- `POST /requests/:id/schedule` (`{ "taller_movil_id": "...", "starts_at": "...", "ends_at": "..." }`)
- `GET /visits`, `GET /visits/:id`
- `POST /visits/:id/accept`, `POST /visits/:id/reject`, `POST /visits/:id/cancel`
- `POST /visits/:id/start`, `POST /visits/:id/complete`, `POST /visits/:id/work-orders`
- `PATCH /work-orders/:id` (`{ "outcome": "evaluada|no_evaluada", "not_evaluated_reason": "..." }`)
- `POST /visits/:id/signatures` (`{ "party": "tecnico|cliente", "signer_name": "...", "bucket": "...", "object_path": "..." }`)
- `POST /visits/:id/sync` (`{ "operations": [{ "operation_id": "uuid", "kind": "...", "payload": {} }] }`)
- `GET /offline/working-set` (the assigned Taller Móvil's accepted/in-progress visits in the two-day working window)
- `GET /certificates/:id/finalized` (complete immutable consumer payload)
- `GET /valves/:id/certificates` (current certificate plus complete history)

The browser calls this authenticated Edge Function for every business and asset
operation. It must not call PostgreSQL tables, RPCs, the Data API, or Storage
directly; Supabase Auth is the only direct browser integration and is limited
to session management. PostgreSQL RLS, privileges, and domain authorization
remain the final authorization barrier. `historial_relaciones` has no
ordinary-user API route, and asset deletion is not exposed because relationship
history must remain auditable.

Run the database contract tests with `supabase test db --local`; they require a
started local Supabase stack.

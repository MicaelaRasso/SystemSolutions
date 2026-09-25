# Service-access API

Apply the migration with `supabase db push`, then serve the function with
`supabase functions serve service-access`. The function expects a Supabase
Bearer token and exposes:

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

All business access goes through authenticated SECURITY DEFINER RPCs. Direct
table access is intentionally denied by RLS and explicit database privileges,
and `historial_relaciones` has no ordinary-user API route. Asset deletion is
not exposed because relationship history must remain auditable.

Run the database contract tests with `supabase test db --local`; they require a
started local Supabase stack.

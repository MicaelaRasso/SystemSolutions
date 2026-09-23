# Service-access API

Apply the migration with `supabase db push`, then serve the function with
`supabase functions serve service-access`. The function expects a Supabase
Bearer token and exposes:

- `GET /context`
- `GET|POST /yacimientos` (`POST` body: `{ "name": "..." }`)
- `GET /yacimientos/:id/tree`
- `GET /yacimientos/:id/assignment`
- `POST /hierarchy` (`{ "kind": "planta|equipo|valvula", "parent_id": "...", "name": "..." }`)
- `POST /requests` (`{ "yacimiento_id": "...", "taller_movil_id": "..." }`)
- `POST /requests/:id/accept`

All business access goes through SECURITY DEFINER RPCs. Direct authenticated
table access is intentionally denied by RLS, and `historial_relaciones` has no
ordinary-user API route.

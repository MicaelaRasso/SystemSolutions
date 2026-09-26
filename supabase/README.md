# Edge capability functions

The browser integrates directly with Supabase Auth for session management only.
Application data goes through named adapters in `src/lib/api/`, the function
registry in `EdgeTransport`, and an authenticated Edge Function. The browser
must not call PostgreSQL, RPCs, the Data API, or Storage directly.

## Function registry

Configure direct function URLs for the deployed environment:

| Variable                            | Function            | Direct responsibility                                                                                  |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_IDENTITY_ADMIN_URL`    | `identity-admin`    | Authenticated context; accounts, workshops, technicians, catalogs and staffing when those routes exist |
| `NEXT_PUBLIC_ASSET_ACCESS_URL`      | `asset-access`      | Cliente and physical-asset access                                                                      |
| `NEXT_PUBLIC_SERVICE_WORKFLOW_URL`  | `service-workflow`  | Requests, visits, work orders and scheduling                                                           |
| `NEXT_PUBLIC_CERTIFICATE_FIELD_URL` | `certificate-field` | Certificate fields, history, signatures and media workflows when implemented                           |
| `NEXT_PUBLIC_OFFLINE_SYNC_URL`      | `offline-sync`      | Working set and offline synchronization                                                                |

If a direct URL is absent, the registry falls back to
`NEXT_PUBLIC_SERVICE_ACCESS_URL` or the Supabase project URL's
`service-access` function. This is a compatibility fallback for rollout, not a
new capability owner. Set the five direct URLs before retiring the legacy
function.

The browser-facing adapter names are `identity`, `hierarchy`, `yacimientos`,
`valves`, `serviceWorkflow`, `serviceRequests`, `visits`, `workOrders`,
`certificates`, `signatures` and `offline`. Components use these adapters and
do not select a function URL themselves.

## Route ownership

| Route                                                                                                                | Direct owner                                                                                                        | Browser adapter                                 | Status                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /context`                                                                                                       | `identity-admin`                                                                                                    | `identity`                                      | Available                                                                          |
| `GET                                                                                                                 | POST /yacimientos`, `PATCH /yacimientos/:id`, `GET /yacimientos/:id/tree`, `GET /yacimientos/:id/assignment`, `POST | PATCH /hierarchy`                               | `asset-access`                                                                     | `hierarchy`, `yacimientos`                   | Available for implemented hierarchy operations |
| `GET                                                                                                                 | PATCH /valves/:id`                                                                                                  | `asset-access`                                  | `hierarchy`, `valves`                                                              | Available for detail and technical revisions |
| `GET                                                                                                                 | POST                                                                                                                | PATCH /requests`, `POST /requests/:id/schedule` | `service-workflow`                                                                 | `serviceWorkflow`, `serviceRequests`         | Available                                      |
| `GET /visits`, `GET /visits/:id`, visit lifecycle commands, `POST /visits/:id/work-orders`, `PATCH /work-orders/:id` | `service-workflow`                                                                                                  | `serviceWorkflow`, `visits`, `workOrders`       | Available as API contracts; no combined operations/Tarea view                      |
| `POST /work-orders/:id/certificate-draft`, `GET                                                                      | PATCH /certificates/:id`, `GET /certificates/:id/finalized`, `GET /valves/:id/certificates`                         | `certificate-field`                             | `certificates`                                                                     | Available as implemented DTOs                |
| `POST /visits/:id/signatures`                                                                                        | `certificate-field`                                                                                                 | `certificates`, `signatures`                    | Partial: registers a Storage reference; does not upload bytes                      |
| `GET /offline/working-set`, `POST /visits/:id/sync`                                                                  | `offline-sync`                                                                                                      | `offline`                                       | Available as working-set and batch routes; UI conflict handling remains incomplete |
| Equivalent legacy routes                                                                                             | `service-access`                                                                                                    | Registry fallback only                          | Compatibility fallback; not a direct owner                                         |

All five direct functions use the private runtime in
`supabase/functions/_shared`. It centralizes bearer-token authentication, actor
propagation, service-role database access, route ownership, CORS, validation,
errors, request metadata and correlation IDs. The server-only
`SUPABASE_SERVICE_ROLE_KEY` is never exposed to the browser.

## Configuration

Every function expects a Supabase Bearer token. Set `ALLOWED_ORIGINS` to a
comma-separated list of browser origins, such as the deployed application and
`http://localhost:3000`. CORS is denied unless an origin is explicitly listed;
`ALLOWED_ORIGIN` remains supported as a single-origin compatibility setting.

The Auth client uses `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (with the legacy anon-key name supported
during migration). Neither key grants browser access to application tables.

## Unavailable capabilities

The following are intentionally not complete. Do not add direct browser access
or document them as available until their contracts and authorization rules are
resolved:

| Capability                                            | Planned owner                        | Current state                                                             |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Cliente list/profile/create/update and logo lifecycle | `asset-access`                       | Unavailable; no supported routes                                          |
| Cuenta lifecycle and access scopes                    | `identity-admin`                     | Unavailable; Cuenta scope decision is unresolved                          |
| Asset deletion                                        | `asset-access`                       | Unavailable; deletion/archive policy is unresolved                        |
| Signature, evidence and logo media bytes              | `certificate-field` / `asset-access` | Unavailable; no Edge multipart upload contract                            |
| Combined operations read model replacing mock `Tarea` | `service-workflow`                   | Unavailable; `/operations` is not implemented and must not create `Tarea` |
| Taller Móvil, Técnico and staffing administration     | `identity-admin`                     | Unavailable; no administrative routes                                     |
| Catalog reads and administration                      | `identity-admin`                     | Unavailable; catalog policy conflicts remain unresolved                   |

The unresolved decisions are Cuenta scope, catalog administration versus the
versioned fixed `Repuestos` data, asset deletion and preserved history, the
media contract, and the stable identity/lifecycle of `/operations`. These are
blocking decisions, not implementation claims.

## Verification

Use a local Supabase stack and configure direct function URLs to verify the
seam:

```text
npm test
npm run typecheck
supabase test db --local
```

In separate terminals, serve the five direct owners locally:

```text
supabase functions serve identity-admin
supabase functions serve asset-access
supabase functions serve service-workflow
supabase functions serve certificate-field
supabase functions serve offline-sync
```

Then verify that browser network traffic
contains Auth plus the configured direct function URLs. When a direct URL is
omitted, verify the request reaches `service-access` only as the compatibility
fallback. Also verify that:

- unauthenticated requests are rejected by every direct function;
- direct table, RPC and Data API access from the browser is rejected;
- route ownership rejects a route sent to the wrong function;
- Auth tokens, publishable key, correlation ID and JSON headers are present;
- certificate signature registration does not imply media-byte upload;
- unavailable accounts, client lifecycle, deletion, media bytes,
  operations/Tarea, staffing and catalog administration remain unavailable.

The database contract tests require a started local Supabase stack. Do not use
production service-role credentials in browser configuration.

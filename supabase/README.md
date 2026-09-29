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
| `NEXT_PUBLIC_SERVICE_WORKFLOW_URL`  | `service-workflow`  | Requests, visits, work orders, scheduling and read-only operations                                    |
| `NEXT_PUBLIC_CERTIFICATE_FIELD_URL` | `certificate-field` | Certificate fields, history, signatures and media workflows when implemented                           |
| `NEXT_PUBLIC_OFFLINE_SYNC_URL`      | `offline-sync`      | Working set and offline synchronization                                                                |

If a direct URL is absent, the registry builds the URL of the corresponding
proprietary function from `NEXT_PUBLIC_SUPABASE_URL`. There is no legacy
gateway fallback; an unknown route fails locally.

The browser-facing adapter names are `identity`, `hierarchy`, `yacimientos`,
`valves`, `serviceWorkflow`, `serviceRequests`, `visits`, `workOrders`,
`certificates`, `signatures`, `offline` and `operations`. Components use these
adapters and do not select a function URL themselves.

## Route ownership

| Route | Direct owner | Browser adapter | Status |
| --- | --- | --- | --- |
| `GET /context` | `identity-admin` | `identity` | Available |
| `GET/POST /yacimientos`, `PATCH /yacimientos/:id`, tree/assignment reads and `POST/PATCH /hierarchy` | `asset-access` | `hierarchy`, `yacimientos` | Available for implemented hierarchy operations |
| `GET/PATCH /valves/:id` | `asset-access` | `hierarchy`, `valves` | Available for detail and technical revisions |
| `GET /requests`, `GET /requests/:id`, `POST /requests`, `PATCH /requests/:id`, `POST /requests/:id/schedule` | `service-workflow` | `serviceWorkflow`, `serviceRequests` | Available; these are the Solicitud mutations and scheduling seam |
| `GET /visits`, `GET /visits/:id`, visit lifecycle commands, `POST /visits/:id/work-orders`, `PATCH /work-orders/:id` | `service-workflow` | `serviceWorkflow`, `visits`, `workOrders` | Available; Visita is the canonical operational aggregate |
| `GET /operations`, `GET /operations/:visitId` | `service-workflow` | `operations` | **Available for read-only access.** The detail id is the Visita id and responses use canonical envelopes; `POST/PATCH /operations` are unsupported |
| `POST /attachments` | `service-workflow` | `services.tareas.subirAdjunto` (compatibility) | Available Edge Storage upload; unrelated to `edgeApi.operations` and `/operations` mutations |
| `POST /work-orders/:id/certificate-draft`, `GET/PATCH /certificates/:id`, `GET /certificates/:id/finalized`, `GET /valves/:id/certificates` | `certificate-field` | `certificates` | Available as implemented DTOs |
| `POST /visits/:id/signatures` | `certificate-field` | `certificates`, `signatures` | Partial: registers a Storage reference; does not upload bytes |
| `GET /offline/working-set`, `POST /visits/:id/sync` | `offline-sync` | `offline` | Available as working-set and batch routes; UI conflict handling remains incomplete |
| `GET/POST/PATCH /clients`, `PUT /clients/:id/logo` | `asset-access` | `admin.clients` | Available; `Empresa` maps to the canonical `Cliente` aggregate |
| `GET/POST/PATCH/DELETE /accounts`, `PUT /accounts/:id/access-scopes` | `identity-admin` | `admin.accounts` | Available for client accounts and hierarchy scopes |
| `GET/POST/PATCH /mobile-workshops`, `/technicians`, `/staffing` | `identity-admin` | `admin.workshops`, `admin.people`, `admin.staffing` | Available for current admin screens |
| `GET/POST/PATCH/PUT /catalogs`, `/test-standards` | `identity-admin` | `admin.catalogs`, `admin.standards` | Available for current catalog screens |

All five direct functions use the private runtime in
`supabase/functions/_shared`. It centralizes bearer-token authentication, actor
propagation, secret-key database access, route ownership, CORS, validation,
errors, request metadata and correlation IDs. The server-only
`SUPABASE_SECRET_KEY` is never exposed to the browser.

## Canonical service workflow contract

`Visita de servicio` is the canonical operational record. It belongs to one
Yacimiento and one Solicitud de servicio, and its response envelope is
`{ visit, work_orders }`. `visit` carries the backend visit identity and
`estado` (`solicitada`, `programada`, `aceptada`, `en_curso`, `completada` or
`cancelada`); each work order carries its `valvula_id` and independent outcome
(`pendiente`, `evaluada` or `no_evaluada`).

The write surface is intentionally split:

- Solicitudes: `POST /requests` and `PATCH /requests/:id` create or edit the
  Selección de servicio; `POST /requests/:id/schedule` creates or reassigns the
  Visita.
- Visitas: `POST /visits/:id/accept`, `reject`, `cancel`, `start` and `complete`
  perform lifecycle transitions.
- Ordenes: `POST /visits/:id/work-orders` adds a Válvula while the Visita is
  `en_curso`; `PATCH /work-orders/:id` records its independent result.

`GET /operations` lists scheduled Visitas using the canonical read envelope;
`GET /operations/:visitId` reads the canonical Visita envelope plus the related
Solicitud and Ordenes. `Tarea` is a UI compatibility name only. The endpoints
never create or update a Solicitud, Visita, Orden or Orden de trabajo.

## Configuration

Every function expects a Supabase Bearer token. Set `ALLOWED_ORIGINS` to a
comma-separated list of browser origins, such as the deployed application and
`http://localhost:3000`. CORS is denied unless an origin is explicitly listed;
`ALLOWED_ORIGIN` remains supported as a single-origin compatibility setting.

The browser Auth client uses `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Edge Functions use
`SUPABASE_PUBLISHABLE_KEY` for request authentication and
`SUPABASE_SECRET_KEY` for privileged database, Auth and Storage operations.
Hosted Supabase runtimes may expose the named-key JSON maps
`SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`; the shared runtime
resolves those maps as a deployment fallback. `SUPABASE_JWKS_URL` is not
required because request authentication currently uses Supabase Auth's
`getUser` endpoint.

## Capabilities with unresolved scope

The following are intentionally not complete. Do not add direct browser access
or document them as available until their contracts and authorization rules are
resolved:

| Capability                                            | Planned owner                        | Current state                                                             |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Asset deletion                                        | `asset-access`                       | Unavailable; deletion/archive policy is unresolved                        |
| Signature, evidence and logo media bytes              | `certificate-field` / `asset-access` | Logo and generic attachment uploads implemented; certificate media remains pending |

The unresolved decisions are Cuenta scope, catalog administration versus the
versioned fixed `Repuestos` data, asset deletion and preserved history, and the
media contract. `/operations` has a stable read identity based on the Visita;
its write prohibition is part of the route contract.

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

Then verify that browser network traffic contains Auth plus the configured
direct function URLs. Also verify that:

- unauthenticated requests are rejected by every direct function;
- direct table, RPC and Data API access from the browser is rejected;
- route ownership rejects a route sent to the wrong function;
- Auth tokens, publishable key, correlation ID and JSON headers are present;
- certificate signature registration does not imply media-byte upload;
- `/operations` rejects writes and remains a canonical read surface keyed by
  Visita; mutations continue through Solicitudes, Visitas and Ordenes.

The database contract tests require a started local Supabase stack. Do not use
production service-role credentials in browser configuration.

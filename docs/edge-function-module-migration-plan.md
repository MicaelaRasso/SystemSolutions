# Edge Function module migration plan

**Status:** proposed

This plan separates the browser-facing application interface from the number of
deployed Supabase Edge Functions. The browser will expose focused capability
modules, while related capabilities will be grouped into a smaller number of
Edge Function deployments.

The capability inventory remains in [`integration.md`](../integration.md).
This document describes how to migrate the implementation without breaking the
Edge-only application-data rule from [ADR 0013](adr/0013-edge-function-only-application-data-gateway.md).

## Objective

Replace the current all-purpose `service-access` implementation with:

1. A broad, domain-oriented browser adapter interface.
2. A shared private Edge transport for authentication, errors, and DTO parsing.
3. Several independently deployable Edge Functions grouped by domain and
   operational behavior.
4. PostgreSQL and Storage access that remains available only through those
   authenticated Edge Functions.

The migration must not expose PostgreSQL, PostgREST, database RPCs, or Storage
to the browser, and it must not introduce a backend entity named `Tarea`.

## Target architecture

```text
Browser
  ├── Supabase Auth (session only)
  └── application adapters
        ├── services.identity
        ├── services.clients
        ├── services.yacimientos
        ├── services.valves
        ├── services.serviceRequests
        ├── services.visits
        ├── services.workOrders
        ├── services.certificates
        ├── services.signatures
        ├── services.evidence
        ├── services.accounts
        ├── services.mobileWorkshops
        ├── services.technicians
        ├── services.catalogs
        ├── services.staffing
        ├── services.operations
        └── services.offline
              │
              └── shared Edge transport
                    │
                    ├── identity-admin
                    ├── asset-access
                    ├── service-workflow
                    ├── certificate-field
                    └── offline-sync
                          │
                          └── PostgreSQL RPCs / Storage
```

The frontend modules are the application seam. Components use capability
methods and do not know which Edge Function owns a route. The deployed
functions are an implementation detail selected by the shared transport.

## Browser-facing capability modules

| Module | Responsibility | Initial Edge owner |
| --- | --- | --- |
| `identity` | `GET /context`, canonical role and account context | `identity-admin` |
| `clients` | Cliente list, profile, mutations, and client-scoped views | `asset-access` |
| `yacimientos` | Yacimiento list, tree, creation, editing, and deletion | `asset-access` |
| `valves` | Válvula detail, technical data, revisions, and deletion | `asset-access` |
| `serviceRequests` | Solicitud de servicio and Selección de servicio | `service-workflow` |
| `visits` | Visita de servicio queries and lifecycle commands | `service-workflow` |
| `workOrders` | Orden de trabajo creation and independent outcomes | `service-workflow` |
| `operations` | Combined operational list/detail read model replacing mock `Tarea` | `service-workflow` |
| `certificates` | Borrador, Certificado finalizado, history, and validity | `certificate-field` |
| `signatures` | Visit-level Firma digitalizada capture and upload | `certificate-field` |
| `evidence` | Certificate and visit photo/evidence upload | `certificate-field` |
| `accounts` | Cuenta lifecycle and access scopes | `identity-admin` |
| `mobileWorkshops` | Taller Móvil administration | `identity-admin` |
| `technicians` | Técnico/Person management | `identity-admin` |
| `catalogs` | Catalog reads and only the administration explicitly allowed by domain decisions | `identity-admin` |
| `staffing` | Technician rosters and weekly copying | `identity-admin` |
| `offline` | Working set, ordered synchronization, acknowledgements, and conflicts | `offline-sync` |

Each module owns its request and response DTOs, view mapping, query keys,
invalidations, and domain-specific error interpretation. A component must not
call a generic `request(path)` method directly.

## Edge Function grouping

### `identity-admin`

Owns identity context and administrative data:

- `GET /context`
- accounts and access scopes
- Talleres Móviles and Técnicos
- catalogs and staffing

Account creation, deactivation, and deletion use Supabase Auth administrative
operations inside the Edge Function. The browser never receives a server key.

### `asset-access`

Owns Cliente and physical asset access:

- Clientes and client profiles
- Yacimientos and descendant trees
- Plantas/locaciones, Equipos/unidades, and Válvulas
- technical Válvula revisions
- asset deletion commands
- client logo operations

All reads and mutations remain subject to Cliente, Yacimiento, and active
Taller Móvil authorization rules.

### `service-workflow`

Owns the operational lifecycle:

- Solicitudes de servicio
- Visitas de servicio
- Órdenes de trabajo
- scheduling and assignment
- the combined `operations` read model

The implementation must preserve the distinctions defined in [ADR 0007](adr/0007-service-request-visit-and-valve-work-order-boundaries.md).

### `certificate-field`

Owns certificate capture and evidence:

- Borrador de certificado
- Certificado pendiente and Certificado finalizado reads
- Válvula certificate history and validity
- visit-level signatures
- certificate and visit evidence
- Edge-mediated Storage uploads

It must preserve visit-level signature reuse, immutable closed certificates, and
the capture boundary from [ADR 0010](adr/0010-visit-level-digitalized-signatures-and-pending-certificates.md).

### `offline-sync`

Owns field-device synchronization:

- two-day working set
- ordered operation batches
- idempotency and replay results
- per-operation acknowledgements
- conflict responses

It must preserve the local/backend state distinction and conflict semantics from
[ADR 0009](adr/0009-offline-field-work-and-idempotent-synchronization.md).

## Shared private implementation

Create private internal modules used by every Edge Function:

- `auth`: validate the Supabase JWT and obtain the authenticated Cuenta.
- `actor`: install the internal actor header for PostgreSQL authorization.
- `db`: create the service-role client with the gateway headers.
- `http`: JSON, multipart, CORS, route errors, and status mapping.
- `validation`: request parsing and shared limits.
- `storage`: safe object naming, content-type/size validation, and metadata
  helpers.

These modules are implementation details, not browser-facing capabilities. They
must not duplicate domain authorization; PostgreSQL remains the final
authorization boundary.

## Decisions required before implementation

Resolve these issues before adding the affected routes:

1. **Cuenta scope.** The glossary says a Cliente has exactly one login, while
   the inventory proposes multiple `Cuentas de Cliente` with access scopes.
   Decide whether these are the Cliente login itself or a new class of
   subordinate accounts.
2. **Catalog administration.** [ADR 0012](adr/0012-versioned-replacement-parts-and-capture-boundary.md)
   says the Repuestos catalog has no runtime maintenance, while the inventory
   proposes generic catalog administration. Separate fixed certificate data
   from catalogs that are genuinely configurable, or revise the decision.
3. **Asset deletion.** Define when deletion is allowed, whether it is a
   soft-delete/archive operation, and how it behaves when the asset has
   Solicitudes, Visitas, Certificados, or preserved history.
4. **Media contract.** Define ownership, evidence section, file size and MIME
   limits, object naming, idempotency, replacement rules, and whether a file
   can be removed after certificate closure.
5. **Operation identity.** Define the stable identifier and lifecycle for the
   combined `/operations` read model. It must not create a second domain entity
   called `Tarea`.

## Migration phases

### Phase 0 — Establish the transport seam

- Extract authentication, actor propagation, CORS, error mapping, and response
  validation from `service-access`.
- Add a function registry to the browser Edge adapter.
- Move existing browser capability clients behind named modules while they still
  call the current `service-access` function.
- Keep route contracts and DTOs unchanged during this phase.
- Add transport tests proving that Auth tokens, actor identity, errors, and
  malformed responses behave consistently.

**Exit criterion:** components use named capability modules; no component calls
`fetch`, a database client, PostgREST, or Storage directly.

### Phase 1 — Deploy `asset-access`

- Move the existing hierarchy, valve, certificate-history, and assignment reads
  and mutations.
- Add Client list/profile/create/update routes.
- Add asset deletion only after the deletion policy is resolved.
- Add client logo operations through the Edge Function.
- Add PostgreSQL API functions, grants, DTOs, adapters, and authorization tests.
- Switch `clients`, `yacimientos`, and `valves` modules to the new function.

**Exit criterion:** hierarchy and Cliente screens work through `asset-access`
without changing their domain behavior.

### Phase 2 — Deploy `service-workflow`

- Move Solicitud de servicio, Visita de servicio, and Orden de trabajo routes.
- Add the combined operations list/detail read model.
- Preserve all lifecycle and simultaneous-Equipo rules.
- Switch `serviceRequests`, `visits`, `workOrders`, and `operations` modules.

**Exit criterion:** scheduling and operational screens work without the old
`service-access` route.

### Phase 3 — Deploy `certificate-field`

- Move draft, finalized, history, and validity reads.
- Define stable certificate capture DTOs instead of exposing opaque JSONB.
- Implement signature upload and registration as one Edge-mediated workflow.
- Implement evidence upload with immutable certificate references.
- Switch `certificates`, `signatures`, and `evidence` modules.

**Exit criterion:** certificate capture, signatures, evidence, and finalized
certificate reads work without browser Storage access.

### Phase 4 — Deploy `identity-admin`

- Move `GET /context`.
- Implement accounts and access scopes after the Cuenta decision.
- Add Taller Móvil, Técnico, catalog, and staffing routes.
- Use Supabase Auth administrative operations only inside this function.
- Switch the corresponding modules and administrative screens.

**Exit criterion:** administrative screens use the new function and role/access
tests cover every administrative operation.

### Phase 5 — Deploy `offline-sync`

- Move the working-set route and batch synchronization route.
- Complete acknowledgement, retry, and conflict DTOs.
- Connect the local synchronization queue to the new module.
- Test idempotent replay, dependency ordering, local completion, and conflicts.

**Exit criterion:** offline field work follows the accepted synchronization
contract without relying on the old gateway.

### Phase 6 — Retire the monolithic gateway

- Search the repository for every `service-access` URL and route reference.
- Remove migrated routes from the old function.
- Remove the old function only after production callers and tests are clean.
- Update `integration.md` to list function ownership and the new transport map.
- Record the final deployment grouping in an ADR only if the grouping reflects a
  hard-to-reverse operational trade-off.

**Exit criterion:** `service-access` is no longer required, and every browser
application-data request reaches one of the capability-owning Edge Functions.

## Testing and rollout rules

Every migrated capability requires:

- DTO contract tests at the browser adapter seam.
- authenticated and unauthenticated route tests.
- role, Cliente, Yacimiento, and Taller Móvil authorization tests as applicable.
- direct table/RPC/Data API bypass rejection tests.
- parity tests against the existing route before switching callers.
- Storage authorization and upload-limit tests for media operations.
- observability with function name, capability, route, actor, correlation ID,
  latency, and normalized error code.

During rollout, the old function remains available only as a temporary
compatibility implementation. New frontend modules must not proxy through the
old function to reach the new ones; that would preserve the deployment coupling
and add an avoidable network hop.

## Completion definition

The migration is complete when:

- browser code depends on capability modules rather than URL paths;
- each capability has one clear interface and owner;
- Edge Functions are grouped by domain and workload rather than by table;
- authentication and actor propagation are shared but domain authorization stays
  local to the owning implementation and PostgreSQL;
- media never crosses directly from browser to Storage;
- offline synchronization retains its idempotency and conflict guarantees; and
- the old monolithic `service-access` function can be removed without changing
  application behavior.

# Changelog

## Phase 4 — local implementation 2026-10-07

Scope: [#41](https://github.com/MicaelaRasso/SystemSolutions/issues/41), [#42](https://github.com/MicaelaRasso/SystemSolutions/issues/42), [#43](https://github.com/MicaelaRasso/SystemSolutions/issues/43), and [#66](https://github.com/MicaelaRasso/SystemSolutions/issues/66). Changes are local and undeployed.

All four Phase 4 issues were closed on 2026-10-07 with the SQL runtime verification gap disclosed in their closing comments.

- Added Súper Administrador audit JSON/CSV exports using the current filters, a complete matching event set, traceable CSV columns, and export audit records. Regular Administradores are denied by the database API.
- Corrected operational dashboard period and expiration calculations to Argentina calendar dates, and added period validation, state handling, and coverage for the existing cards.
- Added administrative certificate history filters, complete same-Válvula history links, directly related audit events, and an audited JSON certificate-data download on the existing history/detail screens. A PDF renderer is not present in this repository; the download format is JSON.
- Kept Tarea as a frontend projection while showing programada and aceptada separately, showing Solicitudes without Visitas, and scheduling them through the existing API. Canonical Visita actions respect their lifecycle states; the Taller Móvil correction request remains disconnected.
- Full Vitest suite passed (33 files, 307 tests), along with lint, typecheck, build, and `git diff --check`. SQL tests could not run because Docker/local Postgres is unavailable; migrations and database authorization behavior are not runtime verified.

## Phase 3 — authorized 2026-10-06; local implementation

Scope: [#67](https://github.com/MicaelaRasso/SystemSolutions/issues/67), [#70](https://github.com/MicaelaRasso/SystemSolutions/issues/70)–[#76](https://github.com/MicaelaRasso/SystemSolutions/issues/76), except production invitation setup [#68](https://github.com/MicaelaRasso/SystemSolutions/issues/68). Changes remain local and undeployed.

- Added administrator Cuenta provisioning and role-scoped account APIs, account parent disablement/reactivation enforcement, recovery request and verified email-change contracts, account-security audit events, and session revocation after verified email change.
- Required device identity and a downloaded catalog revision at visit start, checked device identity in offline routes, and closed a concurrent first-claim race in the database. Focused tests cover selected Técnico/signature attribution. Existing account edit forms no longer offer direct unverified email changes.
- Supabase Auth's built-in email service is selected for now. Pending invitation resend now renews the same unconfirmed Auth identity and rotates its link; local Auth is configured for email confirmation, one-hour invite expiry, dual email-change confirmation, and email-change notification. Added an administrator Cuenta panel, invitation password setup, owner password recovery, and a shared Cuenta security page; activation waits for both email confirmation and password setup. Lost-email recovery still returns 501 because Auth's built-in mailer cannot initiate an administrator-verified change of an existing identity's address. #74 was closed; #67, #70–73, #75, and #76 remain open for unmet acceptance criteria or verification.
- Current lint, typecheck, build, and `git diff --check` pass. The earlier `npm test` pass (29 files, 283 tests) predates the email-service follow-up. The Phase 3 migration and SQL test have not run because local Supabase cannot connect to Docker. No production configuration changed.

## Phase 2 — authorized 2026-10-06; implementation delivered for review

Scope: GitHub issues [#40](https://github.com/MicaelaRasso/SystemSolutions/issues/40), [#62](https://github.com/MicaelaRasso/SystemSolutions/issues/62), [#63](https://github.com/MicaelaRasso/SystemSolutions/issues/63), [#64](https://github.com/MicaelaRasso/SystemSolutions/issues/64), and [#65](https://github.com/MicaelaRasso/SystemSolutions/issues/65). The changes are local and have not been deployed. Issues remain open pending review; this phase does not authorize production changes or issue closure.

### Delivered in the worktree

- #62 adds a backend completion gate for explicit work-order outcomes, complete evaluated certificates, and a Técnico signature. Unevaluated orders cannot have certificates; successful completion closes drafts and keeps complete unsigned certificates pending. Offline UI checks the same work-order and certificate requirements before local completion and orders pending edits before its completion operation.
- #63 adds an administrator-only correction authorization API. It creates a new service request, scheduled visit, and work order for the same Válvula, requires and audits the reason, preserves an immutable lineage record, and links the later certificate draft to the historical source without reopening it.
- #64 preserves offline image identity, capture time, and canonical signature method, validates the media identity against its Storage path, and keeps retry acknowledgements idempotent.
- #65 adds administrator APIs and a conflict-resolution section on the existing admin dashboard. Administrators can inspect immutable payloads, accept/reject/route a conflict with a mandatory reason, and provide correction scheduling details; supported operations apply only when server state remains safe. The Taller Móvil sees the recorded outcome in its existing synchronization panel.
- #40 expands the append-only audit taxonomy and role scope, records selected sensitive denials, adds the requested filters and event details to the existing audit screen, and keeps ordinary reads and validation errors out of the log.

### Verification and limits

- Focused checks reported by implementation agents passed: #62 completion helper tests (4), #64 targeted tests (31), #40 audit/API/transport tests (9), correction Edge/API tests (10), and #65 API/offline/route tests (49). Typecheck and `git diff --check` also passed at implementation checkpoints; lint passed before final integration. These reported checks predate final cross-issue integration and are not a substitute for review.
- Added database tests for the completion gate and conflict resolution to `service_workflow.test.sql`, plus dedicated tests for correction authorization, offline evidence, and operational audit. These test files have not run.
- **Database runtime verification is outstanding.** `supabase status` cannot connect to Docker at `/var/run/docker.sock`, including when run outside the sandbox, and no local database responds on port 54322. The new migrations and SQL tests have not been applied or executed. Do not treat this phase as database-verified or production-ready.
- This implementation is delivered locally for user review and has not yet been accepted. Keep #40, #62–65 open until the review gate is met. See [phase handoff](docs/ready-for-agent-phase-handoff.md) and [integration contracts](integration.md).

## Phase 1 — accepted 2026-10-06

Scope: GitHub issues [#39](https://github.com/MicaelaRasso/SystemSolutions/issues/39), [#53](https://github.com/MicaelaRasso/SystemSolutions/issues/53)–[#60](https://github.com/MicaelaRasso/SystemSolutions/issues/60), [#61](https://github.com/MicaelaRasso/SystemSolutions/issues/61), and [#69](https://github.com/MicaelaRasso/SystemSolutions/issues/69), plus the confirmed [ADR-0012](docs/adr/0012-versioned-replacement-parts-and-capture-boundary.md) catalog-freeze decision. #60 overlaps #53. Some certificate work for #53–59 already existed in commit `cbe98e2`; Phase 1 reconciled and extended it.

### Delivered

- Added Cuenta lifecycle states (`pendiente`, `activa`, `deshabilitada`) and current-state checks for authenticated application-data access, preserving identity and role history.
- Added auditable Visita de servicio transitions and administrator actions for assignment, unassignment, reassignment, and cancellation, with state/role/reason rules and audit data including server receipt and available device event times.
- Expanded the canonical certificate payload, validation, catalog/template version handling, and offline synchronization so drafts and finalized records preserve the captured data and legacy records remain readable.
- Made Repuestos catalog options editable and ordered by administrators. Publishing an edit creates an immutable catalog revision. A Taller Móvil's previously downloaded revision is pinned when its visit starts, including offline starts; later edits cannot change that visit's certificate options. Certificate drafts validate selected replacement IDs and labels against the pinned snapshot.
- Exposed the supporting database, Edge Function, and API contracts, including `GET /certificate-capture/catalogs`, `POST /offline/working-set`, `POST /visits/:id/start`, and offline `start_visit` via `POST /visits/:id/sync`. Existing frontend surfaces were connected where already present; no new application page or route was added. See [Phase 1 page inventory](docs/phase-1-page-inventory.md).
- Updated [CONTEXT.md](CONTEXT.md), [integration.md](integration.md), ADR-0012, and the [phase handoff](docs/ready-for-agent-phase-handoff.md) with the resulting domain and API contract.

### Verification and limits

- Previously run successfully: `npm test` (25 files, 231 tests), lint, typecheck, build, focused Edge route tests (3 files, 71 tests), and `git diff --check`.
- **Not verified against a running database:** local Supabase could not connect to Docker (`/var/run/docker.sock` unavailable). The SQL migrations and database tests have not been executed/applied. This remains a follow-up verification task despite Phase 1 acceptance; do not treat it as production readiness.
- Phase 1 was committed as `be971f4`; no deployment is implied. Phase 2 work is tracked above. The agreed scope is database, Edge Functions, and APIs; connect existing frontend surfaces to those APIs where relevant, but do not build new frontend pages.

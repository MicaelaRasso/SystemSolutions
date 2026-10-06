# Changelog

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
- Phase 1 changes are still in the local uncommitted worktree as of this entry; no deployment is implied. Later phases have not started. The agreed future scope is database, Edge Functions, and APIs; connect existing frontend to those APIs where relevant, but do not build new frontend features.


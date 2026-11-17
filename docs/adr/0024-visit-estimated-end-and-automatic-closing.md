# Visit estimated end, one visit in progress per Taller, and automatic closing

**Status: accepted** (decisión (e) de la usuaria, 2026-11-16, corrected on 2026-11-17; issues #94–#97)

A Visita de servicio has a start and an **estimated end** (`ends_at`, required). The Administrador
sets both when scheduling, rescheduling, reassigning or creating a follow-up visit; the forms
propose start + 1 h («Hora de fin estimada») and the end must be after the start, on the same day
(Argentina time). The Equipo/unidad reservation of ADR 0008 is the scheduled window
`[starts_at, ends_at)`, so the same Equipo can have several visits on the same day as long as their
windows do not overlap; an overlapping one is rejected with 23P01 («El equipo ya tiene otra visita
en ese horario»). Back-to-back windows (one ends at 10:00, the next starts at 10:00) are allowed.

The estimated end **does not close** the visit: only the Técnico completes it, and it may run past
the estimated end. Starting a visit records `started_at` (on an offline start, the device time of
the `start_visit` operation, bounded by the acceptance time and the server time) and keeps the
scheduled reservation unchanged. A visit that runs late therefore does not block later visits of the
same Equipo by itself; the real constraint is the crew:

**A Taller Móvil is a single crew** (it has no subdivisions) and can have only one visit `en_curso`
at a time. Starting a visit (`api_start_visit`, `api_start_visit_with_catalog`, and the
`start_visit` operation of the offline batch) while the same Taller has another visit `en_curso`
fails with «The Taller Móvil already has a visit in progress; complete it before starting another»
(23514 → 409). A visit in Requiere finalización does not count. The field panel does not offer to
start a visit while another one of the Taller is open and tells the Técnico to complete it first.
Offline, the panel blocks the second start too; if a start still reaches the server with another
visit in progress (for example, two devices of the same Taller), the operation becomes a
synchronization conflict for the Administrador like any other invalid late operation, and the
operations queued behind it wait. The Administrador accepts it once the other visit is no longer in
progress (completed or closed at 23:59) or rejects it. To avoid false conflicts, the device sends
its pending starts and completions in the order they were made (a visit completed offline before
starting the next one reaches the server first).

At 23:59 AR a `pg_cron` job (`cerrar-visitas-vencidas`, `public.close_expired_visits()`) is the safety
net: every visit still `en_curso` whose start day (`started_at`) has ended moves to the state
**Requiere finalización** (`requiere_finalizacion`). It releases the visit's Equipo reservations
(and the Taller no longer has a visit in progress), leaves missing signatures pending and work orders
unchanged, and records one audit event per visit. Later runs also close visits from earlier days, and
the job is idempotent. A visit that never started is never closed automatically.

Operations that arrive offline after the closing (any kind, including the Parte diario) become
conflicts with their own reason for the Administrador and change nothing (#96). The Administrador
may accept them while the visit still requires finalization, except signatures, which are rejected
and signed again. Completing a visit in this state (#97): any Técnico of the assigned Taller signs
online from the field panel (also the in-person Cliente, before the Técnico) and the Cliente may
sign from the portal; if the missing signature leaves the visit ready, it completes. Otherwise the
Administrador closes it with a mandatory, audited reason: valves without evaluation become
`no_evaluada` and go to a follow-up visit of the same Solicitud (ADR 0023) with Taller, start and
estimated end, only complete and signed certificates are issued, and incomplete drafts stay as
drafts. Pending conflicts must be resolved first.

There is no rule against overlapping *scheduled* windows of the same Taller (only of the same
Equipo): the Administrador may plan a Taller's day with overlapping estimates; the
one-visit-in-progress rule applies when the Técnico starts.

`pg_cron` is not enabled by the migrations: the migration schedules the job only when the extension
already exists. In production the user enables `pg_cron` (Dashboard → Database → Extensions) and
re-runs the scheduling statement documented in `correcciones.md`.

## Superseded first version (2026-11-16)

The first implementation had no end time: `ends_at` was nullable and every visit reserved its
Equipo from its start until 23:59 AR (`visit_window`), recalculated to the start day when the visit
started. That made two visits of the same Equipo on the same day impossible, which the user rejected
on 2026-11-17. Those migrations were never applied, so they were rewritten in place
(`20261116120100_visit_estimated_end_and_started_at.sql`).

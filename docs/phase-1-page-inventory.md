# Phase 1 page inventory

No new application routes or pages were added. The following existing pages were modified before the scope was narrowed to backend APIs:

| Existing page | Change and purpose |
| --- | --- |
| `/admin/auditoria` | Shows the server receipt time and, where available, the offline device's event time. |
| `/admin/clientes/[id]/usuarios` | Displays the Cuenta lifecycle state and supports the existing account enable/disable flow. |
| `/admin/cronograma` | Exposes reasoned pre-work assignment and reassignment actions for a Visita de servicio. |
| `/admin/tareas/nueva` and `/admin/tareas/[id]` | Expose visit scheduling and administrator assignment, unassignment, reassignment, and cancellation actions. |
| `/taller` | Captures certificate fields and an explicit visit start; keeps the downloaded replacement catalog version for offline work. |
| `/taller/sincronizacion` | Synchronizes a locally started visit before refreshing catalogs and preserves its pinned catalog snapshot. |

The certificate catalog administration page `/admin/catalogos` already existed; this work did not add it. No further frontend development is planned for this API handoff.

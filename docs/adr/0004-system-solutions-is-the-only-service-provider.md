# System Solutions owns all Talleres Móviles

**Status: accepted**

SystemSolutions models multiple Talleres Móviles, all owned by System Solutions; it does not support independent provider organizations. Each Taller Móvil is a unit of workers and may have multiple Técnicos. An Asignación de servicio relates a Yacimiento to one Taller Móvil and governs access for that unit's technicians. Any Técnico belonging to that Taller Móvil may perform a visit and be selected as its Técnico ejecutor; the visit records one Técnico signature reused across its certificates, and no individual Técnico account or per-certificate technician assignment is required. The service-request and certificate flows do not infer branding or certificate identity from an independent provider, while the existing service-access boundary remains scoped to the relevant Yacimiento and its descendants.

This supersedes the independent-provider assumption in ADR-0001. The access model remains relevant, including replacement of the assigned Taller Móvil, but all Talleres Móviles remain units of System Solutions.

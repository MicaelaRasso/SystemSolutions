# Equipment exclusivity across simultaneous visits

**Status: accepted**

Simultaneous Visitas de servicio may share a Yacimiento or Planta/locación, but an Equipo/unidad may belong to only one simultaneous visit. This allows parallel field scheduling while preventing two visits from claiming the same machine and its Válvulas at the same time.

Since ADR 0024 the window is the visit's start and **estimated end** (`[starts_at, ends_at)`):
"simultaneous" means overlapping scheduled windows, so the same Equipo may have several visits on
the same day if they do not overlap. The estimated end does not close the visit, and starting it does
not change the reservation. The crew constraint is separate: a Taller Móvil can have only one visit
in progress at a time (ADR 0024).

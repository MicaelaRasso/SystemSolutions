# Operational metrics and audit-log scope

**Status: accepted**

The Administrador dashboard reports aggregate operational activity separately from certificate history: finalized certificates, completed Visitas de servicio, pending certificates, certificates expiring within 30 days, and Visitas de servicio without an assigned Taller Móvil. The period is selectable and defaults to the current calendar month.

The `Registro de auditoría` is an immutable record for state-changing actions, sensitive exports, synchronization-conflict resolution, and rejected sensitive attempts; ordinary reads are not audited. Each record preserves its actor, action, target, outcome, server receipt time, structured change summary, and correlation identity, with device event time retained when applicable to offline work. Administradores regulares can view operational events, while Súper Administradores can view and export all events as structured JSON and human-readable CSV. Records are retained indefinitely; server receipt time is authoritative for ordering and device time remains available for field chronology.

The frontend provides a global audit screen and certificate-history filters. A certificate detail shows related audit events and the complete certificate history for its Válvula, but does not show a separate corrections section. Finalized certificate immutability and correction-as-a-new-certificate remain governed by ADR-0005.

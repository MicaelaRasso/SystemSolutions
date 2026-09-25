# Yacimiento-scoped service access and relationship history

**Status: accepted**

Clientes own their yacimientos, and service access is assigned only at the yacimiento level, always including the complete descendant tree. A yacimiento has at most one active Taller Móvil assignment; access begins when the Taller Móvil accepts the certificate request, while the Cliente retains access at all times and administrators can access every Cliente and yacimiento.

When the active Taller Móvil changes, the new provider can access the yacimiento's historical data and the previous provider loses access. Previous service and hierarchy relationships remain preserved for audit but are not exposed to ordinary users. This gives ownership and historical data continuity to the Cliente while keeping service access limited to the current provider.

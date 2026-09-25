# Versioned replacement parts and capture boundary

**Status: accepted**

`Repuestos` is represented by the predefined replacement-part categories in `SYS_Certificado Modelo1` plus one optional free-text `Otros` field. A Técnico may select zero or more categories while evaluating a Válvula. Quantities and technician-entered manufacturer or serial identifiers are outside this context. The catalog has stable category identifiers and a catalog version, but the MVP provides no runtime catalog maintenance; a future change requires a new template or application version.

Replacement-part selections, the `Otros` text, the catalog version, and the displayed category labels are editable while the `Visita de servicio` remains open. The work may synchronize as an editable `Borrador de certificado`. When the visit is completed, the certificate's `Estado de captura` becomes closed and the captured values are immutable. A closed certificate cannot be reopened. An unevaluated Válvula creates no certificate; a correction preserves the closed certificate and creates a new one.

## Consequences

- The backend must distinguish an open draft from a `Certificado pendiente` and a `Certificado finalizado`.
- The visit-completion operation is the authoritative editing boundary, including for offline work that is completed locally before synchronization.
- Synchronization must preserve rejected post-closure updates as `Conflicto de sincronización` data rather than overwriting the closed certificate.
- Historical certificates remain interpretable after catalog changes because they retain the catalog version, stable identifiers, and displayed labels used at capture time.

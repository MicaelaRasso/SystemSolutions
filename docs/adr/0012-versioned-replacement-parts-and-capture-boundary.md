# Versioned replacement parts and capture boundary

**Status: accepted**

`Repuestos` is represented by an administrator-maintained catalog of replacement-part categories, initially populated from `SYS_Certificado Modelo1`, plus one optional free-text `Otros` field. A Técnico may select zero or more categories while evaluating a Válvula. Quantities and technician-entered manufacturer or serial identifiers are outside this context. Administradores may add, rename, reorder, and deactivate catalog options at runtime; options are not deleted and their stable identifiers are not reused. A change to the available options does not require a new Plantilla de certificado or application release.

Each edit to the active replacement catalog produces a distinct catalog version. Before a Visita de servicio starts, its assigned Taller Móvil may download that version and its complete option snapshot. At the start of the visit, the last version downloaded to the working device is pinned to the visit, even if an Administrador changed the live catalog after that download. If the visit starts offline, synchronization must preserve the downloaded version instead of substituting the then-current server catalog. A device without a downloaded version cannot start offline certificate capture. The pinned option snapshot supplies choices for all new selections and Borradores de certificado in that visit; later administrator edits apply only to other, not-yet-started visits. Deactivated options are not offered in a newly downloaded version, while selected options remain readable and removable. Each saved selection carries both its stable identifier and its label; legacy string selections remain readable.

Replacement-part selections and the `Otros` text are editable while the `Visita de servicio` remains open; selecting an option records the label in the visit's pinned version, while an already saved label is retained unless the selection is removed and made again. The replacement catalog version is distinct from the Plantilla de certificado version, whose field definitions have their own binding rule in ADR-0017. The work may synchronize as an editable `Borrador de certificado`. When the visit is completed, the certificate's `Estado de captura` becomes closed and the captured values are immutable. A closed certificate cannot be reopened. An unevaluated Válvula creates no certificate; a correction preserves the closed certificate and creates a new one.

## Consequences

- The backend must distinguish an open draft from a `Certificado pendiente` and a `Certificado finalizado`.
- The visit-completion operation is the authoritative editing boundary, including for offline work that is completed locally before synchronization.
- Synchronization must preserve rejected post-closure updates as `Conflicto de sincronización` data rather than overwriting the closed certificate.
- Historical certificates remain interpretable after catalog changes because they retain the visit-pinned catalog version, stable identifiers, and displayed labels used at capture time. The visit retains the complete option snapshot so the captured version can be reconstructed.

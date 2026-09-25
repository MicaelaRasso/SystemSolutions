# Visit-level digitalized signatures and pending certificates

**Status: accepted**

SystemSolutions records one `Firma digitalizada` for the Técnico and at most one for the Cliente per `Visita de servicio`, then reuses those immutable visit-level signature images across every certificate created from completed work in that visit. While a visit is open, evaluated work may be persisted and synchronized as an editable `Borrador de certificado`. When the visit is completed, each eligible draft becomes immutable: it becomes a `Certificado pendiente` when the Cliente signature is absent, or a `Certificado finalizado` when both required signatures are available. A pending certificate remains frozen while it awaits the Cliente signature, which may be captured in person or uploaded later by the authenticated Cliente.

The Técnico selects their name from the assigned Taller Móvil's technician list and draws the signature in the technician PWA; the backend validates that the name belongs to the Taller Móvil. A physically present person may provide the in-person Cliente signature without platform qualification checks, while a later Cliente-panel upload records the authenticated Cliente account and displayed signer name. This image-based evidence is accepted by the business workflow but does not claim cryptographic or legal-validity verification, and signatures cannot be replaced or corrected inside the system.

## Consequences

- `Visita de servicio` completion and `Certificado` finalization are separate lifecycle events.
- Certificate capture is editable only while the visit is open; visit completion is the editing boundary.
- A completed visit may have certificates still pending a Cliente signature.
- The same signature asset and visit-level metadata may appear on multiple certificates.
- Closed certificates cannot be reopened. Any correction is handled outside this workflow by preserving the original and creating a new certificate.

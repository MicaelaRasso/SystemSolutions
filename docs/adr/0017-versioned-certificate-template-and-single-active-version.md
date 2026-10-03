# Versioned certificate templates with one active version

**Status: accepted**

System Solutions stores certificate field definitions in immutable, versioned
`Plantilla de certificado` records. Exactly one version may be active at a time.
Administrators create or edit a draft version and activate it atomically; the
previous active version becomes historical. A new `Borrador de certificado`
binds to the active version at creation, while an existing draft remains bound
to its original version until the visit closes. A closed certificate preserves
the template version and field-definition snapshot used for its capture.

This prevents a field rename, removal, reorder, or required-status change from
altering the meaning or presentation of historical certificates. It also gives
the technician form one unambiguous schema for new work while retaining the
complete `Historial de certificados`.

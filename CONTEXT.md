# SystemSolutions

Domain language for Administradores registering and scheduling safety-valve certification work for Clientes across a hierarchy of yacimientos and their equipment.

## People and accounts

**Cliente**:
An individual whose Cuenta principal is created by an Administrador and who owns yacimientos and their Descendientes. A Cliente can view its data and hierarchy, sign all certificates from a visit, upload its logo, and view or download its certificates.
_Avoid_: organization, tenant, customer account

**Taller Móvil**:
A worker unit belonging to System Solutions that performs certificate work. System Solutions can have multiple Talleres Móviles, and each Taller Móvil can have multiple Técnicos.

**Cuenta**:
The login identity for one person or one shared Taller Móvil. Each account has exactly one immutable role and an Estado de la Cuenta; the MVP exposes one Cuenta principal for each Cliente while retaining existing support for additional Cliente accounts without defining that workflow here.
_Avoid_: user, profile

**Correo de creación de cuenta**:
The email sent when an Administrador creates a Cuenta so its owner can begin access setup. Its invitation link can be resent, and a resend invalidates the previous link; in the MVP, it is delivered through Supabase and is distinct from certificate-expiration notifications.

**Estado de la Cuenta**:
The lifecycle state of a Cuenta: `pendiente` while its invitation has not been accepted, `activa` while it may authenticate, or `deshabilitada` while access is blocked but the identity and history remain available for reactivation. An account is never deleted as part of ordinary lifecycle administration.

**Recuperación de Cuenta**:
The verified process for restoring access when a Cuenta owner loses password or email access. An Administrador may initiate it, but no administrator sets or learns the password; changing the email requires verification of the new address and revokes existing sessions.

**Cuenta compartida de Taller Móvil**:
The single operational login associated with a Taller Móvil. It may have more than one active session, while accountability comes from the selected Técnico, visit and device events, signatures, and audit records.

**Rol**:
An exclusive permission category assigned to an account. An account cannot hold more than one role, and its role does not change.

**Administrador**:
An Administrador regular or Super administrador who registers and corrects Client-owned asset hierarchies and schedules service visits for Clientes. The two administrative roles differ in their additional account, configuration, and exceptional-correction permissions.

**Administrador regular**:
An administrative account with access to every Cliente and yacimiento that registers and corrects asset hierarchies, manages ordinary operational requests, scheduling, and assignments, and manages the lifecycle of Cliente and Taller Móvil Cuentas. It cannot manage Administrador Cuentas.

**Super administrador**:
An administrative account with access to every Cliente and yacimiento and the highest administrative permissions, including the lifecycle of all Cuentas, role assignment for new Cuentas, Taller Móvil, configuration, exceptional-correction, and audit actions. A Cuenta's assigned Rol remains immutable after creation.

## Asset hierarchy

**Yacimiento**:
A geographic area registered by an Administrador for and owned by a Cliente. It contains one or more Plantas/locaciones and carries its province, name, and free-text Operadora and Contratista attributes.

**Planta/locación**:
A specific installation beneath a Yacimiento. A Planta/locación can contain multiple Equipos/unidades and has a required alphanumeric name.

**Equipo/unidad**:
A specific machine beneath a Planta/locación. An Equipo/unidad can contain multiple Válvulas and has a required alphanumeric name or tag.

**Válvula**:
The device beneath an Equipo/unidad that needs to be evaluated and potentially certified. A Válvula has a required alphanumeric tag or identifier.

**Descendiente**:
Any planta/locación, equipo/unidad, or válvula contained beneath a yacimiento.

## Service and access

**Tarea**:
A frontend presentation of a Solicitud de servicio and its Visita de servicio for task-oriented screens. It is not a persisted domain entity and does not replace the canonical service terms.
_Avoid_: using Tarea as the backend aggregate

**Solicitud de servicio**:
A yacimiento-scoped operational request registered by an Administrador for a Cliente. The Administrador selects the service scope, assigns and schedules the visit, and the accepted service creates the active service relationship that grants the Taller Móvil access to the complete Yacimiento descendant tree.

**Visita de servicio**:
A confirmed service appointment scheduled by an Administrador for exactly one Yacimiento and containing one or more valve-scoped work items. A Solicitud de servicio may remain pending without a visit until a date, time, and Taller Móvil are assigned; only an Administrador can assign, unassign, or reassign its Taller Móvil before work starts. Unassignment retains the scheduled date, scope, and work items while making the visit available for reassignment. Simultaneous visits may share a Yacimiento or Planta/locación, but an Equipo/unidad cannot belong to more than one simultaneous visit. As an edge case, the Técnico may add a Válvula from another Yacimiento during the visit only when that Yacimiento belongs to the same Cliente and the Taller Móvil already has access to it; this does not make the visit a multi-Yacimiento scheduling event. The Técnico completes the visit when every Orden de trabajo has an explicit outcome, every evaluated order has complete certificate data, and the Técnico records completion; certificate finalization is a separate step.

**Cliente de servicio**:
The single Cliente for whom an Administrador creates a Solicitud de servicio and who remains the owner of every Yacimiento and Válvula included in that service.

**Orden de trabajo**:
A valve-scoped work item identifying one Válvula to be serviced and certified within a Visita de servicio. Its certificate data begins when the Técnico starts evaluating the Válvula; if the Válvula is not evaluated, no Certificado is created. While the Visita de servicio is open, the work item may hold an editable Borrador de certificado. When the visit closes, the eligible draft becomes a Certificado pendiente or a Certificado finalizado according to the available signatures.
_Avoid_: Solicitud de certificado

**Solicitud de certificado**:
A non-canonical term for an Orden de trabajo. The canonical term is Orden de trabajo. A Válvula can have multiple Ordenes de trabajo over time.

**Selección de servicio**:
The set of assets chosen by an Administrador when organizing a Visita de servicio for a Cliente. The selection may start at a Yacimiento, Planta/locación, Equipo/unidad, or Válvula; selecting an upper-level asset includes all descendant Válvulas at that time. Later additions to the descendant tree are not included automatically, but the Taller Móvil may add a new Válvula during the visit when operationally necessary, including Válvulas outside the originally selected asset tree but belonging to the same Cliente and an accessible Yacimiento.

**Resultado de la Orden de trabajo**:
The independent outcome of servicing one Válvula. A Válvula that cannot be evaluated does not prevent certificates from being generated for the other Válvulas in the same Visita de servicio.

**Alcance de mantenimiento**:
The fixed maintenance-action checklist represented by the certificate template. It may contain selected actions and an optional additional description.

**Repuestos**:
The administrator-maintained replacement-parts checklist used by a Técnico evaluating a Válvula. The Técnico selects zero or more categories and may enter one optional `Otros` description. Each category has a stable identifier; a Visita de servicio uses the catalog version last downloaded before it starts, and its certificates preserve that version and the selected labels. Inventory quantities and technician-entered manufacturer or serial identifiers are outside this context.

**Estado de la Visita de servicio**:
The lifecycle state of a visit: solicitada, programada, aceptada, en curso, completada, or cancelada. A Taller Móvil rejection returns the visit to programada for administrator reassignment; it is not a terminal state. Before work starts, an Administrador may cancel, unassign, or reassign the visit, while the owning Cliente may cancel it before the execution day. A Técnico may mark a visit completed without connectivity; the device can show local completion before the backend receives it, while the backend records completion when the completion operation is synchronized. Local completion immediately closes editing for eligible certificate drafts. Visit completion requires every Orden de trabajo to be evaluada or no evaluada, every evaluated order to have complete certificate data, and one Técnico signature, but does not require the Cliente signature; certificates may therefore remain pending after the visit is completed. These states are distinct from Certificado finalizado.

**Portal del Cliente**:
The Cliente-facing presentation for viewing its data and Yacimientos/Descendientes, signing all certificates from a visit, uploading its logo, and viewing or downloading its certificates. It does not expose visit requests, visit scheduling, operational assignment, hierarchy registration or editing, or technical certificate editing; existing backend capabilities that are not exposed by the portal remain available for future or compatibility use.

## Offline field work and synchronization

**Trabajo offline**:
Field work performed by a Taller Móvil without an active internet connection, including visit execution, Ordenes de trabajo, certificate data, evidence, available signatures, and visit completion. A Taller Móvil session must authenticate online before using a device offline; offline login is not supported. The Técnico selects the signing Técnico's name from the Taller Móvil's available technician list, and the backend validates that selection when synchronized.

**Sincronización offline**:
The process by which a device submits locally recorded field-work operations after connectivity returns. Each operation has a device-generated identity, is safe to retry, and is acknowledged independently by the backend; a visit-level acknowledgement summarizes the state of its operations.

**Sincronización pendiente**:
The state of locally recorded work that has not yet received a backend acknowledgement. Pending work remains on the device and is visible to the Técnico until it is synchronized or becomes a conflict.

**Sincronizado**:
The state of an operation for which the backend has acknowledged the requested result. The device retains a compact acknowledgement receipt after removing the full local payload or media.

**Conflicto de sincronización**:
A pending operation rejected because the server-side visit, access, or certificate state changed while the device was offline. The original local data is preserved and requires an explicit resolution by an Administrador regular or Super administrador—accept, reject, or create a new correction—with a reason recorded in the audit trail; it is never silently overwritten through last-write-wins behavior.

**Estado local de la visita**:
The device's view of a Visita de servicio, which may show the visit as completed before the backend has received its completion operation. Local completion makes certificate drafts read-only even while synchronization is pending. It is distinct from the backend's Estado de la Visita de servicio and must show whether data synchronization is pending, synchronized, or conflicted.

## Operational control and audit

**Métrica operativa**:
An aggregate indicator of current operational activity, such as finalized certificates, completed visits, pending certificates, upcoming expirations, or unassigned visits. It supports administrative monitoring and is not evidence of a specific certificate event.

**Registro de auditoría**:
An immutable record of a state-changing action or sensitive export, preserving its actor, action, target, outcome, server receipt time, and structured change summary; offline actions may also preserve the device event time and correlation identity. Cancellation, assignment changes, correction authorization, conflict resolution, and account-security administration preserve a mandatory reason where applicable. Account invitations, resends, acceptance, administrator-triggered password resets, email changes, enablement, disablement, reactivation, session revocation, and rejected administrative attempts are audited; passwords and ordinary successful logins are not recorded.

**Historial de certificados**:
The complete sequence of persisted certification records for a Válvula, including pending and finalized certificates, which remains separate from operational metrics and the Registro de auditoría. Historical records remain queryable; this context has no archival state that hides or removes them.

## Certificates and evidence

**Plantilla de certificado**:
The versioned certificate layout and field contract represented initially by `SYS_Certificado Modelo1`. A Plantilla de certificado contains the configurable fields, labels, sections, order, field types, and required status used by new Borradores de certificado. Only one version is active at a time. A certificate preserves the version and field definition snapshot used at capture time; historical versions are not available for new work. Its sample values, marks, and annotations are not domain data; the PDF is a presentation produced from the certificate data, not a persisted certificate artifact.
_Avoid_: example certificate, draft layout

**Campo configurable de certificado**:
A field definition belonging to a version of the Plantilla de certificado. It has a stable key, label, section, order, input type, optional catalog choices, and required status. Its captured value belongs to the certificate that used that template version.

**Versión activa de la Plantilla de certificado**:
The single Plantilla de certificado version available for creating new Borradores de certificado. Activating a new version moves the previous active version to historical status; it does not change existing drafts or closed certificates.

**Técnico**:
An individual belonging to the Taller Móvil who performs certificate work. A Taller Móvil may have multiple Técnicos and may temporarily use one shared account; a visit records the selected Técnico's name under `Ejecutó`. Any Técnico belonging to the assigned Taller Móvil may complete and sign the visit.

**Certificado**:
A persisted certification record for one Válvula and its Yacimiento, Planta/locación, and Equipo/unidad context. Its data is editable as a Borrador de certificado while the visit remains open, then its Estado de captura is closed when the visit closes. A closed certificate may be a Certificado pendiente or a Certificado finalizado. A closed certificate cannot be reopened or edited; a correction preserves it and creates a new Orden de trabajo, Visita de servicio, and certificate. A Válvula can have multiple certificados over time.

**Corrección de certificado**:
A correction is an administrator-authorized new certification lineage for the same Válvula: the original certificate remains closed and historical, while a new Orden de trabajo, Visita de servicio, and Certificado capture the corrected result. An Administrador regular or Super administrador may authorize it, and the Taller Móvil may report the need for correction without requiring a connected frontend workflow.

**Borrador de certificado**:
The editable certification data for an evaluated Válvula while its Visita de servicio remains open. It may be synchronized to the backend while still editable. It is not created for an unevaluated Válvula and becomes closed when the visit is completed locally or by the backend.

**Estado de captura**:
The editability state of certificate data. An open Borrador de certificado can be changed while its Visita de servicio is open; a closed certificate cannot be changed or reopened. This state is distinct from Certificado pendiente and Certificado finalizado.

**Certificado pendiente**:
A complete, closed persisted certificate whose required Cliente Firma digitalizada is not yet attached after the Visita de servicio has completed. Its replacement-parts data, catalog version, labels, and other certificate data are frozen while it awaits the signature; incomplete certificate data must be resolved before visit completion and is not a pending certificate. It becomes a Certificado finalizado only after both visit-level signatures are available. A later Cliente signature can finalize eligible pending certificates independently, without reopening them. A pending replacement does not displace an earlier finalized certificate.

**Número de certificado**:
The globally sequential identifier assigned by the backend when a Certificado is finalized. It is shared across all Talleres Móviles belonging to System Solutions and is not scoped to a Yacimiento, Válvula, Taller, or Técnico.

**Técnico ejecutor**:
The Técnico selected from the assigned Taller Móvil's technician list for a Visita de servicio. The certificate records that name under `Ejecutó`; one Técnico Firma digitalizada is captured for the visit and reused for every certificate created from that visit.

**Instantánea de válvula**:
A preserved capture of a Válvula's data for one Certificado, linked to the source Válvula by reference and frozen at finalization. A Válvula can have multiple instantáneas over time, one for each relevant Certificado.
_Avoid_: current valve data, mutable valve copy

**Certificado finalizado**:
A certificate whose required context, execution date, Técnico ejecutor, test information, and both visit-level signatures are complete. Other valve technical fields, photos, maintenance actions, and replacement parts may be absent when unavailable or inapplicable. Finalization is the last certification step and the publication event; there is no separate publication state, and the backend exposes the complete data for presentation as a PDF.

**Vigencia del certificado**:
The validity period of a Certificado finalizado, measured from its Fecha de ejecución through the calendar anniversary one year later. A recalibration creates a new certificate with a new validity period; it does not change the validity or history of the prior certificate.

**Certificado vigente**:
The newest Certificado finalizado for a Válvula whose Vigencia del certificado has not ended. Older and expired certificates remain available as historical records, while Certificados pendientes do not replace the current finalized certificate.

**Firma digitalizada**:
An image-based signature record stored in a Supabase bucket and captured once per Visita de servicio for each signing party. The Técnico draws one signature in the technician PWA and selects their name from the Taller Móvil's technician list; a physically present person may draw a Cliente signature in the technician PWA with their name entered as digital text, or the authenticated Cliente may upload one signature photo from the Cliente panel after the visit. The record preserves the signer name, capture method, account identity when available, timestamp, visit, and image asset, and is reused across every certificate from that visit. The platform does not verify the signer's legal authority or legal validity.
_Avoid_: firma digital, firma del certificado

**Evidencia fotográfica**:
The three canonical valve-photo sections—disassembled valve, assembled valve for testing, and assembled valve with plate and seal. The sections exist on every certificate, but an image may be absent when the corresponding part cannot reasonably be photographed.

**Imagen del certificado**:
An image asset stored in Supabase Storage and referenced by a certificate, such as a valve photo, client logo, or signature. The PDF generated from these assets is not persisted by the backend.

**Asignación de servicio**:
The active relationship between a yacimiento and the Taller Móvil handling its accepted certificate request. A yacimiento has at most one active assignment.

**Acceso del Taller Móvil**:
Access granted to the active Taller Móvil for a yacimiento and its complete descendant tree. It begins when the Taller Móvil accepts the request.

**Historial de relaciones**:
The preserved record of previous service relationships and hierarchy relationships. It supports audit but is not visible to ordinary users.

## Backups

**Backup manual**:
An unencrypted archive generated on demand by the Súper Administrador, either as a complete export or as an export of every record and file related to activity within an inclusive date range. It is delivered immediately as a download and is not retained by System Solutions; M8 does not include restoration.

**Backup completo**:
A Backup manual containing all current application-owned business records and referenced files, including historical, pending, draft, configuration, and synchronization data. It excludes authentication internals, secrets, credentials, and infrastructure configuration.

**Backup por rango de fechas**:
A Backup manual containing every activity within an inclusive date range plus the minimum related records needed to interpret that activity, even when those related records fall outside the range.

**Manifiesto del backup**:
The description included in a Backup manual that records its scope, normalized date boundaries, generation time, record and file counts, checksum when available, and any missing or unreadable files.

**Registro de generación del backup**:
The persisted metadata about a Backup manual request, including the Súper Administrador, time, scope, date range when applicable, counts, checksum when available, warnings, and outcome. It does not retain the archive.

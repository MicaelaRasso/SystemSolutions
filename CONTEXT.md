# SystemSolutions

Domain language for Clientes requesting and scheduling safety-valve certification work from Talleres Móviles across a hierarchy of yacimientos and their equipment.

## People and accounts

**Cliente**:
An individual who creates and owns yacimientos, requests certificates, and has exactly one login.
_Avoid_: organization, tenant, customer account

**Taller Móvil**:
A worker unit belonging to System Solutions that performs certificate work. System Solutions can have multiple Talleres Móviles, and each Taller Móvil can have multiple Técnicos.

**Cuenta**:
The login identity for one person. Each account has exactly one immutable role.
_Avoid_: user, profile

**Rol**:
An exclusive permission category assigned to an account. An account cannot hold more than one role, and its role does not change.

**Administrador regular**:
An administrative account with access to every Cliente and yacimiento that manages ordinary operational requests, scheduling, assignments, and data corrections.

**Super administrador**:
An administrative account with access to every Cliente and yacimiento and the highest administrative permissions, including account, role, Taller Móvil, configuration, exceptional-correction, and audit actions.

## Asset hierarchy

**Yacimiento**:
A geographic area created and owned by a Cliente. It contains one or more Plantas/locaciones and carries its province, name, and free-text Operadora and Contratista attributes.

**Planta/locación**:
A specific installation beneath a Yacimiento. A Planta/locación can contain multiple Equipos/unidades and has a required alphanumeric name.

**Equipo/unidad**:
A specific machine beneath a Planta/locación. An Equipo/unidad can contain multiple Válvulas and has a required alphanumeric name or tag.

**Válvula**:
The device beneath an Equipo/unidad that needs to be evaluated and potentially certified. A Válvula has a required alphanumeric tag or identifier.

**Descendiente**:
Any planta/locación, equipo/unidad, or válvula contained beneath a yacimiento.

## Service and access

**Solicitud de servicio**:
A yacimiento-scoped request from a Cliente to a Taller Móvil. When accepted, it creates the active service relationship and grants the Taller Móvil access to the complete Yacimiento descendant tree.

**Visita de servicio**:
A confirmed service appointment scheduled for exactly one Yacimiento and containing one or more valve-scoped work items. Only an Administrador can assign its Taller Móvil. Simultaneous visits may share a Yacimiento or Planta/locación, but an Equipo/unidad cannot belong to more than one simultaneous visit. As an edge case, the Técnico may add a Válvula from another Yacimiento during the visit only when that Yacimiento belongs to the same Cliente and the Taller Móvil already has access to it; this does not make the visit a multi-Yacimiento scheduling event. The Técnico completes the visit when the Taller Móvil leaves the Yacimiento and the Técnico records completion; certificate finalization is a separate step.

**Cliente de servicio**:
The single Cliente who creates a Solicitud de servicio and remains the owner of every Yacimiento and Válvula included in that service.

**Orden de trabajo**:
A valve-scoped work item identifying one Válvula to be serviced and certified within a Visita de servicio. Its certificate data begins when the Técnico starts evaluating the Válvula; if the Válvula is not evaluated, no Certificado is created. While the Visita de servicio is open, the work item may hold an editable Borrador de certificado. When the visit closes, the eligible draft becomes a Certificado pendiente or a Certificado finalizado according to the available signatures.
_Avoid_: Solicitud de certificado

**Solicitud de certificado**:
A non-canonical term for an Orden de trabajo. The canonical term is Orden de trabajo. A Válvula can have multiple Ordenes de trabajo over time.

**Selección de servicio**:
The set of assets chosen by a Cliente when a Visita de servicio is solicited. A Cliente may select a Yacimiento, Planta/locación, Equipo/unidad, or Válvula; selecting an upper-level asset includes all descendant Válvulas at that time. Later additions to the descendant tree are not included automatically; the Cliente may edit the Solicitud de servicio while it remains editable, but the Taller Móvil may also add the new Válvula during the visit when operationally necessary, including Válvulas outside the originally selected asset tree but belonging to the same Cliente and an accessible Yacimiento.

**Resultado de la Orden de trabajo**:
The independent outcome of servicing one Válvula. A Válvula that cannot be evaluated does not prevent certificates from being generated for the other Válvulas in the same Visita de servicio.

**Alcance de mantenimiento**:
The fixed maintenance-action checklist represented by the certificate template. It may contain selected actions and an optional additional description.

**Repuestos**:
The versioned replacement-parts checklist represented by the certificate template. A Técnico selects zero or more predefined categories and may enter one optional `Otros` description. The MVP catalog has no runtime maintenance mechanism; future catalog changes require a new template/application version. Each category has a stable identifier, and the certificate preserves the catalog version and displayed labels used at capture time. Inventory quantities and technician-entered manufacturer or serial identifiers are outside this context.

**Estado de la Visita de servicio**:
The lifecycle state of a visit: solicitada, programada, aceptada, en curso, completada, or cancelada. A Taller Móvil rejection returns the visit to programada for administrator reassignment; it is not a terminal state. The Cliente may cancel the visit without administrator approval at any time before its execution day. A Técnico may mark a visit completed without connectivity; the device can show local completion before the backend receives it, while the backend records completion when the completion operation is synchronized. Local completion immediately closes editing for eligible certificate drafts. Visit completion requires one Técnico signature, but does not require the Cliente signature; certificates may therefore remain pending after the visit is completed. These states are distinct from Certificado finalizado.

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
A pending operation rejected because the server-side visit, access, or certificate state changed while the device was offline. The original local data is preserved and requires administrative resolution; it is not silently overwritten.

**Estado local de la visita**:
The device's view of a Visita de servicio, which may show the visit as completed before the backend has received its completion operation. Local completion makes certificate drafts read-only even while synchronization is pending. It is distinct from the backend's Estado de la Visita de servicio and must show whether data synchronization is pending, synchronized, or conflicted.

## Certificates and evidence

**Plantilla de certificado**:
The canonical certificate layout and field contract represented by `SYS_Certificado Modelo1`. Its sample values, marks, and annotations are not domain data; the PDF is a presentation produced from the certificate data, not a persisted certificate artifact.
_Avoid_: example certificate, draft layout

**Técnico**:
An individual belonging to the Taller Móvil who performs certificate work. A Taller Móvil may have multiple Técnicos and may temporarily use one shared account; a visit records the selected Técnico's name under `Ejecutó`. Any Técnico belonging to the assigned Taller Móvil may complete and sign the visit.

**Certificado**:
A persisted certification record for one Válvula and its Yacimiento, Planta/locación, and Equipo/unidad context. Its data is editable as a Borrador de certificado while the visit remains open, then its Estado de captura is closed when the visit closes. A closed certificate may be a Certificado pendiente or a Certificado finalizado. A closed certificate cannot be reopened or edited; a correction preserves it and creates a new certificate. A Válvula can have multiple certificados over time.

**Borrador de certificado**:
The editable certification data for an evaluated Válvula while its Visita de servicio remains open. It may be synchronized to the backend while still editable. It is not created for an unevaluated Válvula and becomes closed when the visit is completed locally or by the backend.

**Estado de captura**:
The editability state of certificate data. An open Borrador de certificado can be changed while its Visita de servicio is open; a closed certificate cannot be changed or reopened. This state is distinct from Certificado pendiente and Certificado finalizado.

**Certificado pendiente**:
A closed persisted certificate whose required Cliente Firma digitalizada is not yet attached after the Visita de servicio has completed. Its replacement-parts data, catalog version, labels, and other certificate data are frozen while it awaits signatures; it becomes a Certificado finalizado only after both visit-level signatures are available. A later Cliente signature can finalize eligible pending certificates independently, without reopening them.

**Número de certificado**:
The globally sequential identifier assigned by the backend when a Certificado is finalized. It is shared across all Talleres Móviles belonging to System Solutions and is not scoped to a Yacimiento, Válvula, Taller, or Técnico.

**Técnico ejecutor**:
The Técnico selected from the assigned Taller Móvil's technician list for a Visita de servicio. The certificate records that name under `Ejecutó`; one Técnico Firma digitalizada is captured for the visit and reused for every certificate created from that visit.

**Instantánea de válvula**:
A preserved capture of a Válvula's data for one Certificado, linked to the source Válvula by reference and frozen at finalization. A Válvula can have multiple instantáneas over time, one for each relevant Certificado.
_Avoid_: current valve data, mutable valve copy

**Certificado finalizado**:
A certificate whose required context, execution date, Técnico ejecutor, test information, and both visit-level signatures are complete. Other valve technical fields, photos, maintenance actions, and replacement parts may be absent when unavailable or inapplicable. Finalization is the last certification step; the backend then exposes the complete data for presentation as a PDF.

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

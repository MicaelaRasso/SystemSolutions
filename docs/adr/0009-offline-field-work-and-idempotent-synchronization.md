# Offline field work and idempotent synchronization

**Status: accepted**

The Taller Móvil workflow is available offline through the PWA: a previously authenticated Taller Móvil session can execute visits, manage independent Ordenes de trabajo, capture certificate data, photos, the available visit-level signatures, and mark the visit locally complete. The device stores the work queue and media in IndexedDB, while localStorage is limited to small metadata. When connectivity returns, the device sends one ordered batch per visit, with explicit dependencies between work-item data, assets, signatures, visit completion, and certificate finalization. Every operation receives a device-generated permanent UUID and an idempotency key; replaying an already accepted operation returns its original result and never duplicates data. The backend acknowledges operations and visits separately, accepts independent Ordenes de trabajo independently, assigns the global certificate number only during backend finalization, and treats local certificates as `Certificado pendiente` until that happens. A visit completion operation may make the backend visit `completada` while a separate synchronization-pending indicator shows that some work-item data or the Cliente signature is still missing. Server-side authorization and version conflicts reject affected operations without overwriting the preserved local payload. The device retries automatically with a visible manual retry action, retains only compact acknowledgement receipts after successful synchronization, and does not provide server-to-device recovery for data lost with a device. Devices refresh the authorized working set for the next two days after reconnecting, do not support offline login, allow only one device to work on a given visit at a time, and rely on the operating system's device lock rather than application-level encryption for local data protection.

## Consequences

- Offline completion is intentionally represented by separate local and backend states; users must not interpret local completion as database persistence.
- Certificate numbers cannot be known while offline and are assigned only after synchronization reaches backend finalization.
- A lost device can lose unsynchronized work; this is an accepted operational risk rather than a hidden recovery guarantee.
- Conflict resolution is an administrative workflow, not last-write-wins merging.
- The existing decisions that finalized certificates are immutable and certificate numbers are globally sequential remain unchanged.

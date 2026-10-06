import type { CertificateCaptureCatalogsDto } from "../api/contracts"

export const OFFLINE_SCHEMA_VERSION = 2

export type EstadoOperacionLocal =
  | "guardada_local"
  | "sincronizando"
  | "sincronizada"
  | "conflicto"
  | "fallida"
  | "bloqueada"

export type EstadoLocalVisita = "disponible" | "en_curso_local" | "completada_local"

export interface OperacionOffline {
  operationId: string
  idempotencyKey?: string
  visitId: string
  kind: string
  payload: Record<string, unknown>
  dependencies: string[]
  baseVersions?: Record<string, number>
  schemaVersion: number
  createdAt: string
  deviceTimestamp?: string
  deviceId: string
  estado: EstadoOperacionLocal
  attempts: number
  nextRetryAt?: string
  lastError?: string
  mediaIds?: string[]
  receipt?: {
    serverStatus: string
    serverResult?: unknown
    serverReceivedAt?: string
    acknowledgedAt: string
  }
}

export interface VisitaOffline {
  id: string
  context: unknown
  pinnedCertificateCatalogs?: PinnedCertificateCatalogs
  cachedAt: string
  cachedVersion?: number
  backendStatus?: string
  estadoLocal: EstadoLocalVisita
  synchronizationPending: boolean
  visitAcknowledgement?: VisitAcknowledgement
  claimedByDeviceId?: string
  claimedAt?: string
}

export interface PinnedCertificateCatalogs {
  replacementCatalogVersion: string
  replacementParts: CertificateCaptureCatalogsDto["replacement_parts"]
}

export interface MediaOffline {
  id: string
  visitId: string
  operationId?: string
  kind: "photo" | "signature"
  section?: string
  file?: Blob
  blob?: Blob
  fileName?: string
  contentType?: string
  createdAt: string
}
export type OfflineMedia = MediaOffline & { mediaId?: string }

export interface VisitAcknowledgement {
  visit_id: string
  estado: "sincronizada" | "conflicto" | "pendiente"
  server_received_at: string
  server_acknowledged_at: string
  [key: string]: unknown
}

export interface ResultadoOperacionServidor {
  operation_id: string
  estado: "sincronizada" | "conflicto" | "pendiente"
  result?: unknown
  error_code?: string
  error_message?: string
  server_received_at?: string
  server_acknowledged_at?: string
}

export interface OfflineStore {
  getOperation(operationId: string): Promise<OperacionOffline | undefined>
  listOperations(visitId: string): Promise<OperacionOffline[]>
  saveOperation(operation: OperacionOffline): Promise<void>
  saveVisit(visit: VisitaOffline): Promise<void>
  getVisit(visitId: string): Promise<VisitaOffline | undefined>
  removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]): Promise<void>
  saveMedia?(media: OfflineMedia): Promise<void>
  getMedia?(mediaId: string): Promise<OfflineMedia | undefined>
  removeMedia?(mediaId: string): Promise<void>
  deleteMedia?(mediaId: string): Promise<void>
}

export interface WorkingSetStore extends OfflineStore {
  listVisits(): Promise<VisitaOffline[]>
  deleteVisit(visitId: string): Promise<void>
  removeVisit?(visitId: string): Promise<void>
}

type VisitContextWithCatalogs = {
  certificate_catalogs?: CertificateCaptureCatalogsDto
  visit?: { estado?: string }
}

const visitContext = (context: unknown): VisitContextWithCatalogs | undefined =>
  context && typeof context === "object" && !Array.isArray(context)
    ? (context as VisitContextWithCatalogs)
    : undefined

const pinnedCatalogsFrom = (
  catalogs: CertificateCaptureCatalogsDto | undefined,
): PinnedCertificateCatalogs | undefined =>
  catalogs
    ? {
        replacementCatalogVersion: catalogs.replacement_catalog_version,
        replacementParts: catalogs.replacement_parts.map(({ id, label }) => ({ id, label })),
      }
    : undefined

export function pinVisitCertificateCatalogs(
  visit: VisitaOffline,
  catalogs?: CertificateCaptureCatalogsDto,
): VisitaOffline {
  if (visit.pinnedCertificateCatalogs) return visit
  const available = catalogs ?? visitContext(visit.context)?.certificate_catalogs
  const snapshot = pinnedCatalogsFrom(available)
  if (!snapshot)
    throw new Error("No hay un catálogo de repuestos descargado para iniciar la Visita de servicio")
  return { ...visit, pinnedCertificateCatalogs: snapshot }
}

export function certificateCatalogsForVisit(
  visit: VisitaOffline,
  fallback?: CertificateCaptureCatalogsDto,
): CertificateCaptureCatalogsDto | undefined {
  const base = visitContext(visit.context)?.certificate_catalogs ?? fallback
  if (!base || !visit.pinnedCertificateCatalogs) return base
  return {
    ...base,
    replacement_catalog_version: visit.pinnedCertificateCatalogs.replacementCatalogVersion,
    replacement_parts: visit.pinnedCertificateCatalogs.replacementParts,
  }
}

export function refreshedVisitCatalogs(input: {
  previous?: VisitaOffline
  refreshedContext: unknown
  refreshedCatalogs?: CertificateCaptureCatalogsDto
}): Pick<VisitaOffline, "context" | "pinnedCertificateCatalogs"> {
  const previousContext = visitContext(input.previous?.context)
  const refreshed = visitContext(input.refreshedContext) ?? {}
  const backendWasStarted = input.previous?.backendStatus === "en_curso"
  const serverStarted = backendWasStarted || refreshed.visit?.estado === "en_curso"
  let pinned = input.previous?.pinnedCertificateCatalogs

  if (!pinned && input.previous?.estadoLocal === "en_curso_local") {
    pinned = pinnedCatalogsFrom(previousContext?.certificate_catalogs)
  }
  if (!pinned && serverStarted) {
    const source = backendWasStarted
      ? previousContext?.certificate_catalogs
      : refreshed.certificate_catalogs ?? input.refreshedCatalogs
    pinned = pinnedCatalogsFrom(source)
  }

  const catalogs = input.refreshedCatalogs ?? refreshed.certificate_catalogs
  const availableCatalogs = pinned
    ? {
        ...(catalogs ?? previousContext?.certificate_catalogs),
        replacement_catalog_version: pinned.replacementCatalogVersion,
        replacement_parts: pinned.replacementParts,
      }
    : catalogs ?? previousContext?.certificate_catalogs

  return {
    context: {
      ...(input.refreshedContext && typeof input.refreshedContext === "object"
        ? (input.refreshedContext as Record<string, unknown>)
        : {}),
      ...(availableCatalogs ? { certificate_catalogs: availableCatalogs } : {}),
    },
    pinnedCertificateCatalogs: pinned,
  }
}

export async function syncPendingVisitStartsBeforeRefresh(
  store: WorkingSetStore,
  syncVisit: (visitId: string) => Promise<OperacionOffline[]>,
): Promise<void> {
  const visits = await store.listVisits()
  for (const visit of visits) {
    const operations = await store.listOperations(visit.id)
    const pendingStarts = operations.filter(
      (operation) => operation.kind === "start_visit" && operation.estado !== "sincronizada",
    )
    if (pendingStarts.length === 0) continue
    const remaining = await syncVisit(visit.id)
    for (const operation of pendingStarts) {
      const result = remaining.find(({ operationId }) => operationId === operation.operationId)
      if (result?.estado !== "sincronizada")
        throw new Error("No se pudo confirmar el inicio offline antes de descargar el catálogo")
    }
  }
}

export interface SyncTransport {
  syncVisit(
    visitId: string,
    operations: unknown[],
    deviceId: string,
  ): Promise<{
    operations: ResultadoOperacionServidor[]
    visit_acknowledgement?: VisitAcknowledgement
  }>
  claimVisit?(visitId: string, deviceId: string): Promise<{
    visit_id: string
    device_id: string
    claimed_at: string
    last_seen_at: string
  }>
  uploadMedia?(input: {
    visitId: string
    deviceId: string
    operationId: string
    mediaId: string
    kind: "photo" | "signature"
    party?: "tecnico" | "cliente"
    category?: string
    file: Blob
    fileName?: string
  }): Promise<{
    media_id: string
    image_id: string
    bucket: string
    object_path: string
    content_type: string
    server_received_at: string
  }>
}

export interface OfflineClock {
  now(): string
  id(): string
}

const systemClock: OfflineClock = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
}

const editableAfterCompletion = new Set([
  "start_certificate_draft",
  "update_certificate_draft",
  "capture_evidence",
  "upload_evidence",
  "upload_photo",
])

const retryDelayMs = (attempts: number) =>
  Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1))

const isDue = (operation: OperacionOffline, now: string) =>
  !operation.nextRetryAt || operation.nextRetryAt <= now

const mediaOperationKinds = new Set([
  "capture_evidence",
  "upload_evidence",
  "upload_photo",
  "submit_signature",
])

const hasUploadedReference = (payload: Record<string, unknown>) =>
  typeof payload.object_path === "string" &&
  payload.object_path.length > 0 &&
  typeof payload.image_id === "string" &&
  payload.image_id.length > 0

export const migratePendingOperation = (operation: OperacionOffline): OperacionOffline => {
  if (operation.schemaVersion > OFFLINE_SCHEMA_VERSION) {
    return { ...operation, estado: "bloqueada", lastError: "Versión de operación no compatible" }
  }
  if (operation.schemaVersion === OFFLINE_SCHEMA_VERSION) return operation
  return {
    ...operation,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    idempotencyKey: operation.idempotencyKey ?? operation.operationId,
    deviceTimestamp: operation.deviceTimestamp ?? operation.createdAt,
  }
}

export const reconcileWorkingSet = async (
  store: WorkingSetStore,
  workingSet: {
    certificate_catalogs?: CertificateCaptureCatalogsDto
    visits: Array<{
      visit: Record<string, unknown>
      work_orders: unknown[]
      context: unknown
      certificate_catalogs?: CertificateCaptureCatalogsDto
    }>
  },
  clock: OfflineClock = systemClock,
) => {
  const serverVisits = new Set(workingSet.visits.map((entry) => String(entry.visit.id)))
  const localVisits = await store.listVisits()

  for (const entry of workingSet.visits) {
    const visitId = String(entry.visit.id)
    const existing = await store.getVisit(visitId)
    const localOperations = await store.listOperations(visitId)
    const pending = localOperations.some((operation) => operation.estado !== "sincronizada")
    const catalogs = entry.certificate_catalogs ?? workingSet.certificate_catalogs
    const catalogState = refreshedVisitCatalogs({
      previous: existing,
      refreshedContext: { ...entry, certificate_catalogs: catalogs },
      refreshedCatalogs: catalogs,
    })
    await store.saveVisit({
      id: visitId,
      ...catalogState,
      cachedAt: clock.now(),
      cachedVersion: Number(entry.visit.sync_version) || undefined,
      backendStatus: String(entry.visit.estado ?? existing?.backendStatus ?? ""),
      estadoLocal: existing?.estadoLocal ?? "disponible",
      synchronizationPending: pending,
      visitAcknowledgement: existing?.visitAcknowledgement,
      claimedByDeviceId: existing?.claimedByDeviceId,
      claimedAt: existing?.claimedAt,
    })
  }

  for (const local of localVisits) {
    if (serverVisits.has(local.id)) continue
    const operations = await store.listOperations(local.id)
    if (!operations.some((operation) => operation.estado !== "sincronizada"))
      await store.deleteVisit(local.id)
  }
}

export const hydrateWorkingSet = reconcileWorkingSet

export async function queueOfflineSignatureCapture(input: {
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  visitId: string
  deviceId: string
  party: "tecnico" | "cliente"
  signerName: string
  file: Blob
  mediaId?: string
  dependencies?: string[]
}) {
  if (!input.store.saveMedia) throw new Error("El almacenamiento offline de medios no está disponible")
  const mediaId = input.mediaId ?? crypto.randomUUID()
  await input.store.saveMedia({
    id: mediaId,
    mediaId,
    visitId: input.visitId,
    kind: "signature",
    blob: input.file,
    file: input.file,
    contentType: input.file.type,
    fileName: input.file instanceof File ? input.file.name : `firma-${mediaId}.png`,
    createdAt: new Date().toISOString(),
  })
  const mediaOperation = await input.coordinator.queue(
    input.visitId,
    input.deviceId,
    "upload_evidence",
    {
      media_id: mediaId,
      category: `firma_${input.party}`,
      content_type: input.file.type,
    },
    input.dependencies ?? [],
    { mediaIds: [mediaId] },
  )
  const signatureOperation = await input.coordinator.queue(
    input.visitId,
    input.deviceId,
    "submit_signature",
    {
      party: input.party,
      signer_name: input.signerName,
      image_id: mediaId,
      media_id: mediaId,
      capture_method: "technician_pwa",
    },
    [...(input.dependencies ?? []), mediaOperation.operationId],
  )
  return { mediaId, mediaOperation, signatureOperation }
}

export class OfflineSyncCoordinator {
  constructor(
    private readonly store: OfflineStore,
    private readonly transport: SyncTransport,
    private readonly clock: OfflineClock = systemClock,
  ) {}

  async queue(
    visitId: string,
    deviceId: string,
    kind: string,
    payload: Record<string, unknown>,
    dependencies: string[] = [],
    options: {
      baseVersions?: Record<string, number>
      mediaIds?: string[]
      idempotencyKey?: string
    } = {},
  ): Promise<OperacionOffline> {
    const visit = await this.store.getVisit(visitId)
    if (visit?.estadoLocal === "completada_local" && editableAfterCompletion.has(kind)) {
      throw new Error("La Visita de servicio está completada localmente y el borrador está cerrado")
    }
    const operationId = this.clock.id()
    const createdAt = this.clock.now()
    const operation: OperacionOffline = {
      operationId,
      idempotencyKey: options.idempotencyKey ?? operationId,
      visitId,
      kind,
      payload,
      dependencies,
      baseVersions: options.baseVersions,
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      createdAt,
      deviceTimestamp: createdAt,
      deviceId,
      estado: "guardada_local",
      attempts: 0,
      mediaIds:
        options.mediaIds ??
        [payload.media_id, payload.image_id]
          .filter((value): value is string => typeof value === "string" && value.length > 0),
    }
    await this.store.saveOperation(operation)
    if (visit) {
      visit.synchronizationPending = true
      await this.store.saveVisit(visit)
    }
    return operation
  }

  async markVisitLocallyComplete(visitId: string): Promise<void> {
    const visit = await this.store.getVisit(visitId)
    if (!visit) throw new Error("La Visita de servicio no está disponible en el dispositivo")
    visit.estadoLocal = "completada_local"
    visit.synchronizationPending = true
    await this.store.saveVisit(visit)
  }

  async claimVisit(visitId: string, deviceId: string): Promise<VisitaOffline> {
    const visit = await this.store.getVisit(visitId)
    if (!visit) throw new Error("La Visita de servicio no está disponible en el dispositivo")
    if (visit.claimedByDeviceId && visit.claimedByDeviceId !== deviceId)
      throw new Error("Esta Visita de servicio ya está siendo trabajada en otro dispositivo")
    if (this.transport.claimVisit) {
      const claim = await this.transport.claimVisit(visitId, deviceId)
      visit.claimedAt = claim.claimed_at
    } else if (visit.claimedByDeviceId !== deviceId) {
      await this.transport.syncVisit(visitId, [], deviceId)
      visit.claimedAt = this.clock.now()
    }
    visit.claimedByDeviceId = deviceId
    await this.store.saveVisit(visit)
    return visit
  }

  async sync(
    visitId: string,
    deviceId: string,
    options: { respectBackoff?: boolean } = {},
  ): Promise<OperacionOffline[]> {
    const now = this.clock.now()
    const initial = (await this.store.listOperations(visitId)).map(migratePendingOperation)
    for (const operation of initial) await this.store.saveOperation(operation)

    for (const operation of initial) {
      if (operation.estado === "sincronizando") {
        operation.estado = "fallida"
        operation.lastError = "Sincronización interrumpida; se reintentará con la misma operación"
        await this.store.saveOperation(operation)
      }
    }

    const attempted = new Set<string>()
    for (let layer = 0; layer < initial.length; layer += 1) {
      const current = (await this.store.listOperations(visitId)).map(migratePendingOperation)
      const ready = current
        .filter(
          (operation) =>
            (operation.estado === "guardada_local" || operation.estado === "fallida") &&
            !attempted.has(operation.operationId) &&
            (!options.respectBackoff || isDue(operation, now)) &&
            operation.dependencies.every((dependency) =>
              current.some(
                (candidate) => candidate.operationId === dependency && candidate.estado === "sincronizada",
              ),
            ),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId))
      if (ready.length === 0) break

      for (const operation of ready) {
        attempted.add(operation.operationId)
        operation.estado = "sincronizando"
        operation.attempts += 1
        delete operation.lastError
        await this.store.saveOperation(operation)
      }

      const sendable: OperacionOffline[] = []
      for (const operation of ready) {
        if (!mediaOperationKinds.has(operation.kind)) {
          sendable.push(operation)
          continue
        }
        try {
          const dependencyMedia = operation.dependencies
            .map((dependency) => current.find((candidate) => candidate.operationId === dependency))
            .map((dependency) => dependency?.receipt?.serverResult)
            .find(
              (result): result is Record<string, unknown> =>
                Boolean(result) &&
                typeof result === "object" &&
                hasUploadedReference(result as Record<string, unknown>),
            )
          if (dependencyMedia && !hasUploadedReference(operation.payload)) {
            operation.payload = {
              ...operation.payload,
              media_id: dependencyMedia.media_id ?? operation.payload.media_id,
              image_id: dependencyMedia.image_id,
              bucket: dependencyMedia.bucket,
              object_path: dependencyMedia.object_path,
              content_type: dependencyMedia.content_type,
            }
            await this.store.saveOperation(operation)
          }
          let mediaId = operation.mediaIds?.[0]
          if (!mediaId && typeof operation.payload.media_id === "string")
            mediaId = operation.payload.media_id
          if (!mediaId && typeof operation.payload.image_id === "string")
            mediaId = operation.payload.image_id

          if (!hasUploadedReference(operation.payload)) {
            if (!mediaId || !this.store.getMedia || !this.transport.uploadMedia)
              throw new Error("La operación multimedia no tiene un archivo local para cargar")
            const media = await this.store.getMedia(mediaId)
            if (!media?.file && !media?.blob)
              throw new Error("La operación multimedia perdió su archivo local")
            const uploaded = await this.transport.uploadMedia({
              visitId,
              deviceId,
              operationId: operation.operationId,
              mediaId,
              kind: media.kind,
              party:
                operation.kind === "submit_signature" &&
                (operation.payload.party === "tecnico" || operation.payload.party === "cliente")
                  ? operation.payload.party
                  : undefined,
              category:
                typeof operation.payload.category === "string"
                  ? operation.payload.category
                  : typeof operation.payload.section === "string"
                    ? operation.payload.section
                    : media.section,
              file: media.file ?? media.blob!,
              fileName: media.fileName,
            })
            operation.payload = {
              ...operation.payload,
              media_id: uploaded.media_id,
              image_id: uploaded.image_id,
              bucket: uploaded.bucket,
              object_path: uploaded.object_path,
              content_type: uploaded.content_type,
            }
            await this.store.saveOperation(operation)
          }
          if (!hasUploadedReference(operation.payload))
            throw new Error("La operación multimedia no recibió una referencia Storage válida")
          sendable.push(operation)
        } catch (error) {
          operation.estado = "fallida"
          operation.lastError = error instanceof Error ? error.message : "No se pudo cargar el archivo"
          const timestamp = Date.parse(this.clock.now())
          if (!Number.isNaN(timestamp))
            operation.nextRetryAt = new Date(timestamp + retryDelayMs(operation.attempts)).toISOString()
          await this.store.saveOperation(operation)
        }
      }
      if (sendable.length === 0) break

      let response: Awaited<ReturnType<SyncTransport["syncVisit"]>>
      try {
        response = await this.transport.syncVisit(
          visitId,
          sendable.map((operation) => ({
            operation_id: operation.operationId,
            idempotency_key: operation.idempotencyKey ?? operation.operationId,
            kind: operation.kind,
            dependencies: operation.dependencies,
            schema_version: operation.schemaVersion,
            payload: operation.payload,
            base_versions: operation.baseVersions,
            device_timestamp: operation.deviceTimestamp ?? operation.createdAt,
          })),
          deviceId,
        )
      } catch (error) {
        for (const operation of ready) {
          operation.estado = "fallida"
          operation.lastError = error instanceof Error ? error.message : "No se pudo sincronizar"
          const timestamp = Date.parse(this.clock.now())
          if (!Number.isNaN(timestamp))
            operation.nextRetryAt = new Date(timestamp + retryDelayMs(operation.attempts)).toISOString()
          await this.store.saveOperation(operation)
        }
        break
      }

      let acknowledged = false
      for (const operation of sendable) {
        const result = response.operations.find((item) => item.operation_id === operation.operationId)
        if (!result) {
          operation.estado = "fallida"
          operation.lastError = "El servidor no confirmó la operación"
          await this.store.saveOperation(operation)
          continue
        }
        if (result.estado === "conflicto") {
          operation.estado = "conflicto"
          operation.lastError = result.error_message ?? "Conflicto de sincronización"
          delete operation.nextRetryAt
          await this.store.saveOperation(operation)
          continue
        }
        if (result.estado === "pendiente") {
          operation.estado = "fallida"
          operation.lastError = result.error_message ?? "El servidor dejó la operación pendiente"
          await this.store.saveOperation(operation)
          continue
        }
        operation.estado = "sincronizada"
        delete operation.nextRetryAt
        operation.receipt = {
          serverStatus: result.estado,
          serverResult: result.result,
          serverReceivedAt: result.server_received_at,
          acknowledgedAt: result.server_acknowledged_at ?? this.clock.now(),
        }
        await this.store.removeOperationPayload(operation.operationId, operation.receipt)
        for (const mediaId of operation.mediaIds ?? []) {
          await this.store.removeMedia?.(mediaId)
          await this.store.deleteMedia?.(mediaId)
        }
        acknowledged = true
      }

      const visit = await this.store.getVisit(visitId)
      if (visit && response.visit_acknowledgement) {
        visit.visitAcknowledgement = response.visit_acknowledgement
        visit.backendStatus = String(
          (response.visit_acknowledgement as Record<string, unknown>).backend_status ?? visit.backendStatus ?? "",
        )
        await this.store.saveVisit(visit)
      }
      if (!acknowledged) break
    }

    const remaining = await this.store.listOperations(visitId)
    const visit = await this.store.getVisit(visitId)
    if (visit) {
      visit.synchronizationPending = remaining.some((operation) => operation.estado !== "sincronizada")
      await this.store.saveVisit(visit)
    }
    return remaining
  }

  async retryAutomatically(visitId: string, deviceId: string) {
    return this.sync(visitId, deviceId, { respectBackoff: true })
  }
}

type StoredRecord = OperacionOffline | VisitaOffline

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"))
  })

export class IndexedDbOfflineStore implements WorkingSetStore {
  private readonly database: Promise<IDBDatabase>

  constructor(name = "systemsolutions-offline", version = OFFLINE_SCHEMA_VERSION) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("visits")) db.createObjectStore("visits", { keyPath: "id" })
        if (!db.objectStoreNames.contains("operations")) {
          const operations = db.createObjectStore("operations", { keyPath: "operationId" })
          operations.createIndex("visitId", "visitId", { unique: false })
        }
        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "mediaId" })
          media.createIndex("visitId", "visitId", { unique: false })
          media.createIndex("operationId", "operationId", { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"))
    })
  }

  private async store(name: "visits" | "operations" | "media", mode: IDBTransactionMode) {
    const db = await this.database
    return db.transaction(name, mode).objectStore(name)
  }

  async getOperation(operationId: string) {
    return (await requestResult(await this.store("operations", "readonly").then((s) => s.get(operationId)))) as
      | OperacionOffline
      | undefined
  }

  async listOperations(visitId: string) {
    const records = (await requestResult(
      await this.store("operations", "readonly").then((s) => s.index("visitId").getAll(visitId)),
    )) as StoredRecord[]
    return records as OperacionOffline[]
  }

  async saveOperation(operation: OperacionOffline) {
    await requestResult(await this.store("operations", "readwrite").then((s) => s.put(operation)))
  }

  async saveVisit(visit: VisitaOffline) {
    await requestResult(await this.store("visits", "readwrite").then((s) => s.put(visit)))
  }

  async getVisit(visitId: string) {
    return (await requestResult(await this.store("visits", "readonly").then((s) => s.get(visitId)))) as
      | VisitaOffline
      | undefined
  }

  async listVisits() {
    return (await requestResult(await this.store("visits", "readonly").then((s) => s.getAll()))) as VisitaOffline[]
  }

  async removeVisit(visitId: string) {
    await requestResult(await this.store("visits", "readwrite").then((s) => s.delete(visitId)))
  }

  async deleteVisit(visitId: string) {
    return this.removeVisit(visitId)
  }

  async removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]) {
    const operation = await this.getOperation(operationId)
    if (!operation) return
    await this.saveOperation({ ...operation, payload: {}, receipt, estado: "sincronizada" })
  }

  async saveMedia(media: OfflineMedia) {
    await requestResult(
      await this.store("media", "readwrite").then((s) =>
        s.put({ ...media, mediaId: media.mediaId ?? media.id }),
      ),
    )
  }

  async getMedia(mediaId: string) {
    return (await requestResult(await this.store("media", "readonly").then((s) => s.get(mediaId)))) as
      | OfflineMedia
      | undefined
  }

  async removeMedia(mediaId: string) {
    await requestResult(await this.store("media", "readwrite").then((s) => s.delete(mediaId)))
  }

  async deleteMedia(mediaId: string) {
    return this.removeMedia(mediaId)
  }
}

export const OFFLINE_SCHEMA_VERSION = 1

export type EstadoOperacionLocal =
  "guardada_local" | "sincronizando" | "sincronizada" | "conflicto" | "fallida"

export type EstadoLocalVisita = "disponible" | "en_curso_local" | "completada_local"

export interface OperacionOffline {
  operationId: string
  visitId: string
  kind: string
  payload: Record<string, unknown>
  dependencies: string[]
  schemaVersion: number
  createdAt: string
  deviceId: string
  estado: EstadoOperacionLocal
  attempts: number
  lastError?: string
  receipt?: {
    serverStatus: string
    serverResult?: unknown
    acknowledgedAt: string
  }
}

export interface VisitaOffline {
  id: string
  context: unknown
  cachedAt: string
  estadoLocal: EstadoLocalVisita
  synchronizationPending: boolean
}

export interface ResultadoOperacionServidor {
  operation_id: string
  estado: "sincronizada" | "conflicto" | "pendiente"
  result?: unknown
  error_message?: string
}

export interface OfflineStore {
  getOperation(operationId: string): Promise<OperacionOffline | undefined>
  listOperations(visitId: string): Promise<OperacionOffline[]>
  saveOperation(operation: OperacionOffline): Promise<void>
  saveVisit(visit: VisitaOffline): Promise<void>
  getVisit(visitId: string): Promise<VisitaOffline | undefined>
  removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]): Promise<void>
}

export interface SyncTransport {
  syncVisit(
    visitId: string,
    operations: unknown[],
    deviceId: string,
  ): Promise<{
    operations: ResultadoOperacionServidor[]
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

/**
 * Coordinates one visit's local work without making IndexedDB part of the
 * business interface. Pending payloads survive retries; acknowledged entries
 * are reduced to receipts only.
 */
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
  ): Promise<OperacionOffline> {
    const operation: OperacionOffline = {
      operationId: this.clock.id(),
      visitId,
      kind,
      payload,
      dependencies,
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      createdAt: this.clock.now(),
      deviceId,
      estado: "guardada_local",
      attempts: 0,
    }
    await this.store.saveOperation(operation)
    const visit = await this.store.getVisit(visitId)
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

  async sync(visitId: string, deviceId: string): Promise<OperacionOffline[]> {
    const operations = (await this.store.listOperations(visitId)).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId),
    )

    // A reload may interrupt a request after its durable "syncing" marker was saved.
    // Replay it with the same permanent operation id; the server contract is idempotent.
    for (const operation of operations) {
      if (operation.estado === "sincronizando") {
        operation.estado = "fallida"
        operation.lastError = "Sincronización interrumpida; se reintentará con la misma operación"
        await this.store.saveOperation(operation)
      }
    }

    // Submit dependency layers in order. Each acknowledged layer is durable before
    // its dependents become eligible, including dependents queued in the same session.
    const attempted = new Set<string>()
    for (let layer = 0; layer < operations.length; layer += 1) {
      const current = await this.store.listOperations(visitId)
      const ready = current
        .filter(
          (operation) =>
            (operation.estado === "guardada_local" || operation.estado === "fallida") &&
            !attempted.has(operation.operationId) &&
            operation.dependencies.every((dependency) =>
              current.some(
                (candidate) =>
                  candidate.operationId === dependency && candidate.estado === "sincronizada",
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

      let response: { operations: ResultadoOperacionServidor[] }
      try {
        response = await this.transport.syncVisit(
          visitId,
          ready.map((operation) => ({
            operation_id: operation.operationId,
            kind: operation.kind,
            dependencies: operation.dependencies,
            schema_version: operation.schemaVersion,
            payload: operation.payload,
            device_timestamp: operation.createdAt,
          })),
          deviceId,
        )
      } catch (error) {
        for (const operation of ready) {
          operation.estado = "fallida"
          operation.lastError = error instanceof Error ? error.message : "No se pudo sincronizar"
          await this.store.saveOperation(operation)
        }
        break
      }

      let acknowledged = false
      for (const operation of ready) {
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
        operation.receipt = {
          serverStatus: result.estado,
          serverResult: result.result,
          acknowledgedAt: this.clock.now(),
        }
        await this.store.removeOperationPayload(operation.operationId, operation.receipt)
        acknowledged = true
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
}

type StoredRecord = OperacionOffline | VisitaOffline

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"))
  })

/** IndexedDB adapter used by the Taller Móvil PWA. No full payload is stored in localStorage. */
export class IndexedDbOfflineStore implements OfflineStore {
  private readonly database: Promise<IDBDatabase>

  constructor(name = "systemsolutions-offline", version = OFFLINE_SCHEMA_VERSION) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("visits"))
          db.createObjectStore("visits", { keyPath: "id" })
        if (!db.objectStoreNames.contains("operations")) {
          const operations = db.createObjectStore("operations", { keyPath: "operationId" })
          operations.createIndex("visitId", "visitId", { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"))
    })
  }

  private async store(name: "visits" | "operations", mode: IDBTransactionMode) {
    const db = await this.database
    return db.transaction(name, mode).objectStore(name)
  }

  async getOperation(operationId: string) {
    return (await requestResult(
      await this.store("operations", "readonly").then((s) => s.get(operationId)),
    )) as OperacionOffline | undefined
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
    return (await requestResult(
      await this.store("visits", "readonly").then((s) => s.get(visitId)),
    )) as VisitaOffline | undefined
  }

  async removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]) {
    const operation = await this.getOperation(operationId)
    if (!operation) return
    await this.saveOperation({
      ...operation,
      payload: {},
      receipt,
      estado: "sincronizada",
    })
  }
}

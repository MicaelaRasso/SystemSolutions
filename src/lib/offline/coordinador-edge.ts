import { edgeApi, type SyncVisitInput } from "@/lib/api"

import { OfflineSyncCoordinator, type OfflineStore } from "./sync"

/**
 * Coordinador de sincronización contra las Edge Functions. Lo comparten la agenda de campo y la
 * pantalla de sincronización para que ambas suban los archivos (fotos y firmas) antes de enviar
 * las operaciones y conserven la clave de idempotencia de cada una.
 */
export function crearCoordinadorEdge(store: OfflineStore) {
  return new OfflineSyncCoordinator(store, {
    async uploadMedia({ visitId, deviceId, operationId, mediaId, kind, party, category, file, fileName }) {
      const media = await store.getMedia?.(mediaId)
      return edgeApi.offline.uploadMedia(visitId, {
        deviceId,
        operationId,
        mediaId,
        kind,
        party,
        category,
        file: (media?.file ?? media?.blob ?? file) as Blob,
        fileName: media?.fileName ?? fileName,
      })
    },
    async syncVisit(visitId, operations, currentDeviceId) {
      const response = await edgeApi.offline.syncVisit(visitId, {
        deviceId: currentDeviceId,
        operations: operations.map((raw) => {
          const operation = raw as {
            operation_id: string
            kind: string
            payload: Record<string, unknown>
            schema_version: number
            dependencies: string[]
            device_timestamp: string
            idempotency_key?: string
            base_versions?: Record<string, number>
          }
          return {
            operationId: operation.operation_id,
            kind: operation.kind as SyncVisitInput["operations"][number]["kind"],
            payload: operation.payload,
            schemaVersion: operation.schema_version,
            dependencies: operation.dependencies,
            deviceTimestamp: operation.device_timestamp,
            idempotencyKey: operation.idempotency_key,
            baseVersions: operation.base_versions,
          }
        }),
      })
      return {
        operations: response.operations,
        visit_acknowledgement: response.visit_acknowledgement,
      }
    },
    claimVisit: (visitId, currentDeviceId) => edgeApi.offline.claimVisit(visitId, currentDeviceId),
  })
}

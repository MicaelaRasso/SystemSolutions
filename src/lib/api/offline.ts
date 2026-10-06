import type { EdgeAccessClient } from "../services/edge"
import {
  offlineWorkingSetDtoSchema,
  offlineClaimVisitDtoSchema,
  offlineMediaUploadDtoSchema,
  syncVisitDtoSchema,
  syncVisitInputSchema,
  type SyncVisitInput,
} from "./contracts"

export const offlineQueryKeys = {
  all: ["edge", "offline"] as const,
  workingSet: () => [...offlineQueryKeys.all, "working-set"] as const,
}

export const offlineInvalidations = [offlineQueryKeys.all] as const

const photoCategories = new Set(["desarmada", "ensamblada_prueba", "placa_precinto"])

export function createOfflineApi(edge: EdgeAccessClient) {
  return {
    workingSet: (deviceId: string) =>
      edge.request("offline/working-set", offlineWorkingSetDtoSchema, {
        method: "POST",
        body: JSON.stringify({ device_id: deviceId }),
      }),

    claimVisit(visitId: string, deviceId: string) {
      return edge.request(`visits/${visitId}/claim`, offlineClaimVisitDtoSchema, {
        method: "POST",
        body: JSON.stringify({ device_id: deviceId }),
      })
    },

    uploadMedia(
      visitId: string,
      input: {
        deviceId: string
        operationId: string
        mediaId: string
        kind: "photo" | "signature"
        party?: "tecnico" | "cliente"
        category?: string
        file: Blob
        fileName?: string
      },
    ) {
      if (input.kind === "photo" && (!input.category || !photoCategories.has(input.category)))
        throw new Error("A valid certificate evidence category is required")
      if (
        input.kind === "signature" &&
        (!input.party || (input.category && input.category !== `firma_${input.party}`))
      )
        throw new Error("A signature category must match its party")

      const form = new FormData()
      form.set("device_id", input.deviceId)
      form.set("operation_id", input.operationId)
      form.set("media_id", input.mediaId)
      form.set("kind", input.kind)
      if (input.party) form.set("party", input.party)
      if (input.category) form.set("category", input.category)
      form.set("file", input.file, input.fileName ?? `${input.mediaId}.bin`)
      return edge.request(`visits/${visitId}/media`, offlineMediaUploadDtoSchema, {
        method: "POST",
        body: form,
      })
    },

    async syncVisit(visitId: string, input: SyncVisitInput) {
      const data = syncVisitInputSchema.parse(input)
      return edge.request(`visits/${visitId}/sync`, syncVisitDtoSchema, {
        method: "POST",
        body: JSON.stringify({
          device_id: data.deviceId,
          operations: data.operations.map((operation) => ({
            operation_id: operation.operationId,
            kind: operation.kind,
            payload: operation.payload,
            ...(operation.idempotencyKey
              ? { idempotency_key: operation.idempotencyKey }
              : {}),
            schema_version: operation.schemaVersion,
            dependencies: operation.dependencies,
            device_timestamp: operation.deviceTimestamp,
            base_versions: operation.baseVersions,
          })),
        }),
      })
    },
  }
}

export type OfflineApi = ReturnType<typeof createOfflineApi>

import type { EdgeAccessClient } from "../services/edge"
import {
  offlineWorkingSetDtoSchema,
  syncVisitDtoSchema,
  syncVisitInputSchema,
  type SyncVisitInput,
} from "./contracts"

export const offlineQueryKeys = {
  all: ["edge", "offline"] as const,
  workingSet: () => [...offlineQueryKeys.all, "working-set"] as const,
}

export const offlineInvalidations = [offlineQueryKeys.all] as const

export function createOfflineApi(edge: EdgeAccessClient) {
  return {
    workingSet: () => edge.request("offline/working-set", offlineWorkingSetDtoSchema),

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
            schema_version: operation.schemaVersion,
            dependencies: operation.dependencies,
            device_timestamp: operation.deviceTimestamp,
          })),
        }),
      })
    },
  }
}

export type OfflineApi = ReturnType<typeof createOfflineApi>

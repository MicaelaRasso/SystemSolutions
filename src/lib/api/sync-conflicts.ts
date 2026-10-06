import { z } from "zod"

import type { EdgeAccessClient } from "../services/edge"

export const workshopConflictOutcomesSchema = z.object({
  items: z.array(z.object({
    conflict_id: z.string().uuid(),
    operation_id: z.string().uuid(),
    visit_id: z.string().uuid(),
    operation_kind: z.string(),
    resolution_action: z.enum(["accepted", "rejected", "correction_authorized"]),
    resolution_reason: z.string(),
    resolved_at: z.string(),
    result: z.record(z.string(), z.unknown()),
  })),
})

export const syncConflictsSchema = z.object({ items: z.array(z.record(z.string(), z.unknown())) })

export function createSyncConflictsApi(edge: EdgeAccessClient) {
  return {
    workshopOutcomes() {
      return edge.request("offline/conflict-outcomes", workshopConflictOutcomesSchema)
    },
    list() {
      return edge.request("conflicts", syncConflictsSchema)
    },
    get(conflictId: string) {
      return edge.request(`conflicts/${conflictId}`, z.record(z.string(), z.unknown()))
    },
    resolve(conflictId: string, input: {
      action: "accept" | "reject" | "correction"
      reason: string
      source_certificate_id?: string
      provider_id?: string
      starts_at?: string
      ends_at?: string
    }) {
      return edge.request(`conflicts/${conflictId}/resolve`, z.record(z.string(), z.unknown()), {
        method: "POST",
        body: JSON.stringify(input),
      })
    },
  }
}

export type SyncConflictsApi = ReturnType<typeof createSyncConflictsApi>

import { describe, expect, it } from "vitest"

import type { OfflineStore, OperacionOffline, VisitaOffline } from "./sync"
import { OfflineSyncCoordinator } from "./sync"

class MemoryStore implements OfflineStore {
  operations = new Map<string, OperacionOffline>()
  visits = new Map<string, VisitaOffline>()

  async getOperation(id: string) {
    return this.operations.get(id)
  }
  async listOperations(visitId: string) {
    return [...this.operations.values()].filter((operation) => operation.visitId === visitId)
  }
  async saveOperation(operation: OperacionOffline) {
    this.operations.set(operation.operationId, { ...operation })
  }
  async saveVisit(visit: VisitaOffline) {
    this.visits.set(visit.id, { ...visit })
  }
  async getVisit(id: string) {
    return this.visits.get(id)
  }
  async removeOperationPayload(id: string, receipt: OperacionOffline["receipt"]) {
    const operation = this.operations.get(id)
    if (operation) this.operations.set(id, { ...operation, payload: {}, dependencies: [], receipt, estado: "sincronizada" })
  }
}

const clock = (() => {
  let sequence = 0
  return {
    now: () => `2026-09-25T12:00:0${sequence++}.000Z`,
    id: () => `operation-${sequence++}`,
  }
})()

describe("OfflineSyncCoordinator", () => {
  it("replays ordered operations and compacts acknowledged payloads", async () => {
    const store = new MemoryStore()
    await store.saveVisit({
      id: "visit-1",
      context: {},
      cachedAt: "2026-09-25T11:00:00.000Z",
      estadoLocal: "en_curso_local",
      synchronizationPending: true,
    })
    const batches: unknown[][] = []
    const coordinator = new OfflineSyncCoordinator(
      store,
      {
        syncVisit: async (_visitId, operations) => {
          batches.push(operations)
          return {
            operations: (operations as { operation_id: string }[]).map((operation) => ({
              operation_id: operation.operation_id,
              estado: "sincronizada" as const,
              result: { accepted: true },
            })),
          }
        },
      },
      clock,
    )
    const first = await coordinator.queue("visit-1", "device-1", "work_order_outcome", { outcome: "evaluada" })
    await coordinator.queue("visit-1", "device-1", "start_certificate_draft", { work_order_id: "wo-1" }, [first.operationId])

    await coordinator.sync("visit-1", "device-1")
    expect(batches[0]).toHaveLength(1)
    expect((await store.getOperation(first.operationId))?.payload).toEqual({})

    await coordinator.sync("visit-1", "device-1")
    expect(batches[1]).toHaveLength(1)
  })

  it("preserves a conflicted payload and keeps local completion separate", async () => {
    const store = new MemoryStore()
    await store.saveVisit({
      id: "visit-2",
      context: {},
      cachedAt: "2026-09-25T11:00:00.000Z",
      estadoLocal: "en_curso_local",
      synchronizationPending: false,
    })
    const coordinator = new OfflineSyncCoordinator(
      store,
      {
        syncVisit: async (_visitId, operations) => ({
          operations: [{
            operation_id: (operations[0] as { operation_id: string }).operation_id,
            estado: "conflicto",
            error_message: "La visita fue reasignada",
          }],
        }),
      },
      { now: () => "2026-09-25T12:00:00.000Z", id: () => "conflict-op" },
    )
    await coordinator.queue("visit-2", "device-1", "complete_visit", { local_completed_at: "2026-09-25T11:59:00.000Z" })
    await coordinator.markVisitLocallyComplete("visit-2")
    await coordinator.sync("visit-2", "device-1")

    expect((await store.getVisit("visit-2"))?.estadoLocal).toBe("completada_local")
    expect((await store.getOperation("conflict-op"))?.estado).toBe("conflicto")
    expect((await store.getOperation("conflict-op"))?.payload).toEqual({ local_completed_at: "2026-09-25T11:59:00.000Z" })
  })
})

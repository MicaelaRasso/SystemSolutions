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
    if (operation) this.operations.set(id, { ...operation, payload: {}, receipt, estado: "sincronizada" })
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
  it("sends dependencies in order and compacts acknowledged payloads to receipts", async () => {
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
    expect((await store.getVisit("visit-1"))?.synchronizationPending).toBe(true)

    await coordinator.sync("visit-1", "device-1")
    expect(batches[0]).toHaveLength(1)
    expect((await store.getOperation(first.operationId))?.payload).toEqual({})
    expect((await store.getOperation(first.operationId))?.receipt?.serverResult).toEqual({ accepted: true })

    // The dependent is sent only after the parent's durable acknowledgement,
    // without requiring a second manual synchronization.
    expect(batches).toHaveLength(2)
    expect(batches[1]).toHaveLength(1)
    expect((batches[1][0] as { operation_id: string }).operation_id).not.toBe(first.operationId)
    expect((await store.getVisit("visit-1"))?.synchronizationPending).toBe(false)
  })

  it("flushes dependency layers in a single sync request", async () => {
    const store = new MemoryStore()
    const sent: string[][] = []
    const coordinator = new OfflineSyncCoordinator(
      store,
      {
        syncVisit: async (_visitId, operations) => {
          const ids = (operations as { operation_id: string }[]).map((operation) => operation.operation_id)
          sent.push(ids)
          return { operations: ids.map((operation_id) => ({ operation_id, estado: "sincronizada" as const })) }
        },
      },
      { now: () => "2026-09-25T12:00:00.000Z", id: (() => { let id = 0; return () => `layer-${id++}` })() },
    )
    const parent = await coordinator.queue("visit-layer", "device-1", "work_order_outcome", { outcome: "evaluada" })
    await coordinator.queue("visit-layer", "device-1", "start_certificate_draft", {}, [parent.operationId])

    await coordinator.sync("visit-layer", "device-1")

    expect(sent).toEqual([[parent.operationId], ["layer-1"]])
  })

  it("persists a network failure and retries with the same operation id", async () => {
    const store = new MemoryStore()
    const operation = {
      operationId: "retry-op",
      visitId: "visit-retry",
      kind: "complete_visit",
      payload: { completed: true },
      dependencies: [],
      schemaVersion: 1,
      createdAt: "2026-09-25T12:00:00.000Z",
      deviceId: "device-1",
      estado: "guardada_local" as const,
      attempts: 0,
    }
    await store.saveOperation(operation)
    const requests: string[] = []
    let fail = true
    const coordinator = new OfflineSyncCoordinator(store, {
      syncVisit: async (_visitId, operations) => {
        const id = (operations[0] as { operation_id: string }).operation_id
        requests.push(id)
        if (fail) throw new Error("network unavailable")
        return { operations: [{ operation_id: id, estado: "sincronizada" }] }
      },
    })

    const failed = await coordinator.sync("visit-retry", "device-1")
    expect(failed[0]).toMatchObject({ estado: "fallida", attempts: 1, lastError: "network unavailable" })
    fail = false
    const retried = await coordinator.sync("visit-retry", "device-1")

    expect(requests).toEqual(["retry-op", "retry-op"])
    expect(retried[0]).toMatchObject({ estado: "sincronizada", attempts: 2, payload: {} })
  })

  it("recovers an interrupted syncing operation and retains dependencies in its receipt", async () => {
    const store = new MemoryStore()
    const operation: OperacionOffline = {
      operationId: "interrupted-op",
      visitId: "visit-interrupted",
      kind: "complete_visit",
      payload: { completed: true },
      dependencies: ["prior-op"],
      schemaVersion: 1,
      createdAt: "2026-09-25T12:00:00.000Z",
      deviceId: "device-1",
      estado: "sincronizando",
      attempts: 1,
    }
    await store.saveOperation({ ...operation, dependencies: [] })
    // A prerequisite receipt may already be compacted; the dependent should still
    // retain its dependency metadata after its own payload is removed.
    await store.saveOperation(operation)
    await store.saveOperation({
      ...operation,
      operationId: "prior-op",
      payload: {},
      dependencies: [],
      estado: "sincronizada",
      receipt: { serverStatus: "sincronizada", acknowledgedAt: "2026-09-25T12:00:00.000Z" },
    })
    const coordinator = new OfflineSyncCoordinator(store, {
      syncVisit: async (_visitId, operations) => ({
        operations: (operations as { operation_id: string }[]).map(({ operation_id }) => ({
          operation_id,
          estado: "sincronizada",
        })),
      }),
    })

    const result = await coordinator.sync("visit-interrupted", "device-1")
    expect(result.find(({ operationId }) => operationId === "interrupted-op")).toMatchObject({
      estado: "sincronizada",
      payload: {},
      dependencies: ["prior-op"],
      attempts: 2,
    })
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

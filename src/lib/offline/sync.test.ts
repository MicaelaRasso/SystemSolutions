import { describe, expect, it } from "vitest"

import type { OfflineMedia, OfflineStore, OperacionOffline, VisitaOffline } from "./sync"
import { OfflineSyncCoordinator, queueOfflineSignatureCapture } from "./sync"

class MemoryStore implements OfflineStore {
  operations = new Map<string, OperacionOffline>()
  visits = new Map<string, VisitaOffline>()
  media = new Map<string, OfflineMedia>()

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
  async listVisits() {
    return [...this.visits.values()]
  }
  async removeVisit(id: string) {
    this.visits.delete(id)
  }
  async deleteVisit(id: string) {
    this.visits.delete(id)
  }
  async saveMedia(media: OfflineMedia) {
    this.media.set(media.mediaId ?? media.id, media)
  }
  async getMedia(id: string) {
    return this.media.get(id)
  }
  async removeMedia(id: string) {
    this.media.delete(id)
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

  it("prevents certificate edits after local completion", async () => {
    const store = new MemoryStore()
    await store.saveVisit({
      id: "closed-visit",
      context: {},
      cachedAt: "2026-09-25T11:00:00.000Z",
      estadoLocal: "completada_local",
      synchronizationPending: true,
    })
    const coordinator = new OfflineSyncCoordinator(store, { syncVisit: async () => ({ operations: [] }) })

    await expect(
      coordinator.queue("closed-visit", "device-1", "update_certificate_draft", { notes: "late" }),
    ).rejects.toThrow("borrador está cerrado")
  })

  it("persists offline signature media and submits it after the media operation", async () => {
    const store = new MemoryStore()
    const coordinator = new OfflineSyncCoordinator(store, { syncVisit: async () => ({ operations: [] }) }, {
      now: () => "2026-09-25T12:00:00.000Z",
      id: (() => { let id = 0; return () => `signature-op-${id++}` })(),
    })
    const file = new Blob(["signature"], { type: "image/png" })

    const queued = await queueOfflineSignatureCapture({
      store,
      coordinator,
      visitId: "visit-signature",
      deviceId: "device-1",
      party: "tecnico",
      signerName: "Ana Técnica",
      file,
      mediaId: "media-signature-1",
    })

    expect((await store.getMedia("media-signature-1"))?.blob).toBe(file)
    expect(queued.mediaOperation.kind).toBe("upload_evidence")
    expect(Object.keys(queued.mediaOperation.payload)).not.toContain(["media", "name"].join("_"))
    expect(queued.signatureOperation.kind).toBe("submit_signature")
    expect(queued.signatureOperation.dependencies).toEqual([queued.mediaOperation.operationId])
    expect(queued.signatureOperation.payload).toMatchObject({
      image_id: "media-signature-1",
      media_id: "media-signature-1",
      signer_name: "Ana Técnica",
    })
  })

  it("uploads IndexedDB media before sending and compacts it only after acknowledgement", async () => {
    const store = new MemoryStore()
    const uploadCalls: unknown[] = []
    let sentPayload: Record<string, unknown> | undefined
    const coordinator = new OfflineSyncCoordinator(store, {
      uploadMedia: async (input) => {
        uploadCalls.push(input)
        return {
          media_id: input.mediaId,
          image_id: input.mediaId,
          bucket: "certificate-signatures",
          object_path: `visits/${input.visitId}/tecnico/${input.mediaId}.png`,
          content_type: "image/png",
          server_received_at: "2026-09-25T12:00:01.000Z",
        }
      },
      syncVisit: async (_visitId, operations) => {
        sentPayload = (operations[0] as { payload: Record<string, unknown> }).payload
        return {
          operations: [{ operation_id: "media-op", estado: "sincronizada", result: { accepted: true } }],
        }
      },
    }, { now: () => "2026-09-25T12:00:00.000Z", id: () => "unused" })
    await store.saveMedia({
      id: "media-1",
      mediaId: "media-1",
      visitId: "visit-media",
      operationId: "media-op",
      kind: "signature",
      blob: new Blob(["signature"], { type: "image/png" }),
      contentType: "image/png",
      createdAt: "2026-09-25T11:59:00.000Z",
    })
    await store.saveOperation({
      operationId: "media-op",
      visitId: "visit-media",
      kind: "submit_signature",
      payload: { media_id: "media-1", party: "tecnico", signer_name: "Ana" },
      dependencies: ["prior-op"],
      schemaVersion: 2,
      createdAt: "2026-09-25T12:00:00.000Z",
      deviceTimestamp: "2026-09-25T12:00:00.000Z",
      deviceId: "device-1",
      estado: "guardada_local",
      attempts: 0,
      mediaIds: ["media-1"],
    })
    await store.saveOperation({
      operationId: "prior-op",
      visitId: "visit-media",
      kind: "work_order_outcome",
      payload: {},
      dependencies: [],
      schemaVersion: 2,
      createdAt: "2026-09-25T11:58:00.000Z",
      deviceId: "device-1",
      estado: "sincronizada",
      attempts: 1,
    })

    await coordinator.sync("visit-media", "device-1")

    expect(uploadCalls).toHaveLength(1)
    expect(sentPayload).toMatchObject({
      party: "tecnico",
      image_id: "media-1",
      bucket: "certificate-signatures",
      object_path: "visits/visit-media/tecnico/media-1.png",
    })
    expect(store.media.has("media-1")).toBe(false)
  })

  it("copies the acknowledged upload reference into a dependent signature operation", async () => {
    const store = new MemoryStore()
    await store.saveMedia({
      id: "media-2",
      mediaId: "media-2",
      visitId: "visit-signature-dependency",
      kind: "signature",
      blob: new Blob(["signature"], { type: "image/png" }),
      createdAt: "2026-09-25T12:00:00.000Z",
    })
    const sent: { kind: string; payload: Record<string, unknown>; dependencies: string[] }[] = []
    const coordinator = new OfflineSyncCoordinator(store, {
      uploadMedia: async ({ mediaId, visitId }) => ({
        media_id: mediaId,
        image_id: mediaId,
        bucket: "certificate-signatures",
        object_path: `visits/${visitId}/tecnico/${mediaId}.png`,
        content_type: "image/png",
        server_received_at: "2026-09-25T12:00:01.000Z",
      }),
      syncVisit: async (_visitId, operations) => {
        const current = operations as {
          operation_id: string
          kind: string
          payload: Record<string, unknown>
          dependencies: string[]
        }[]
        sent.push(...current)
        return {
          operations: current.map((operation) => ({
            operation_id: operation.operation_id,
            estado: "sincronizada" as const,
            result:
              operation.kind === "upload_evidence"
                ? {
                    media_id: "media-2",
                    image_id: "media-2",
                    bucket: "certificate-signatures",
                    object_path: "visits/visit-signature-dependency/tecnico/media-2.png",
                  }
                : { accepted: true },
          })),
        }
      },
    })
    const media = await coordinator.queue(
      "visit-signature-dependency",
      "device-1",
      "upload_evidence",
      { media_id: "media-2", category: "firma_tecnico" },
      [],
      { mediaIds: ["media-2"] },
    )
    await coordinator.queue(
      "visit-signature-dependency",
      "device-1",
      "submit_signature",
      { media_id: "media-2", image_id: "media-2", party: "tecnico", signer_name: "Ana" },
      [media.operationId],
    )

    await coordinator.sync("visit-signature-dependency", "device-1")

    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      kind: "submit_signature",
      dependencies: [media.operationId],
      payload: {
        bucket: "certificate-signatures",
        object_path: "visits/visit-signature-dependency/tecnico/media-2.png",
        image_id: "media-2",
      },
    })
  })
})

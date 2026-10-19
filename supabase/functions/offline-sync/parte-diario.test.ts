import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const uploadStorageObject = vi.hoisted(() => vi.fn())

vi.mock("../_shared/storage.ts", () => ({
  uploadStorageObject,
  validateStorageObject: () => ({
    ok: true,
    metadata: { objectName: "placeholder", contentType: "image/png", size: 7 },
  }),
}))

import type { RouteHandler } from "../_shared/transport.ts"

const visitId = "00000000-0000-0000-0000-000000000201"
const deviceId = "00000000-0000-0000-0000-000000000202"
const mediaId = "00000000-0000-0000-0000-000000000203"
const operationId = "00000000-0000-0000-0000-000000000204"

let handler: RouteHandler

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn(), env: { get: vi.fn() } })
  handler = (await import("./index.ts")).offlineSyncHandler
})

afterAll(() => vi.unstubAllGlobals())

const context = (
  request: Request,
  route: string[],
  rpc: ReturnType<typeof vi.fn>,
  body: Record<string, unknown>,
) => ({
  request,
  route,
  body,
  actor: { id: deviceId, authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

describe("offline Parte diario synchronization", () => {
  it("uploads PD photos to a controlled visit path", async () => {
    uploadStorageObject.mockResolvedValue(undefined)
    const rpc = vi.fn().mockResolvedValue({
      data: { visit_id: visitId, device_id: deviceId },
      error: null,
    })
    const file = new File(["pngdata"], "parte.png", { type: "image/png" })

    await expect(
      handler(
        context(
          new Request(`https://example.test/visits/${visitId}/media`, { method: "POST" }),
          ["visits", visitId, "media"],
          rpc,
          {
            device_id: deviceId,
            operation_id: operationId,
            media_id: mediaId,
            kind: "photo",
            category: "parte_diario",
            file,
          },
        ),
      ),
    ).resolves.toMatchObject({
      data: {
        media_id: mediaId,
        bucket: "certificate-evidence",
        object_path: `visits/${visitId}/parte-diario/${mediaId}.png`,
      },
      error: null,
    })
    expect(uploadStorageObject).toHaveBeenCalledWith(
      "certificate-evidence",
      `visits/${visitId}/parte-diario/${mediaId}.png`,
      file,
    )
  })

  it("preserves cross-kind operation order and restores input acknowledgement order", async () => {
    const regularOperation = { operation_id: "regular-id", kind: "work_order_outcome", payload: {} }
    const setCodeOperation = { operation_id: "set-code-id", kind: "set_part_diario", payload: { codigo: "PD123" } }
    const imageOperation = { operation_id: "image-id", kind: "attach_part_diario_image", payload: { codigo: "PD123" } }
    const laterRegularOperation = { operation_id: "later-regular-id", kind: "complete_visit", payload: {} }
    const rpc = vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      return Promise.resolve({
        data: {
          visit_id: visitId,
          operations: (args.operations as Array<{ operation_id: string }>).map((operation) => ({
            operation_id: operation.operation_id,
            estado: "sincronizada",
          })),
          visit_acknowledgement: { estado: "sincronizada" },
        },
        error: null,
      })
    })

    const result = await handler(
      context(
        new Request(`https://example.test/visits/${visitId}/sync`, { method: "POST" }),
        ["visits", visitId, "sync"],
        rpc,
        { device_id: deviceId, operations: [regularOperation, setCodeOperation, imageOperation, laterRegularOperation] },
      ),
    )

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "api_sync_visit_batch",
      "api_sync_visit_part_diario_batch",
      "api_sync_visit_batch",
    ])
    expect(result).toMatchObject({
      data: {
        operations: [
          { operation_id: "regular-id" },
          { operation_id: "set-code-id" },
          { operation_id: "image-id" },
          { operation_id: "later-regular-id" },
        ],
      },
      error: null,
    })
  })
})

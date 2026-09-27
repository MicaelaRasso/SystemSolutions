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

const visitId = "00000000-0000-0000-0000-000000000001"
const deviceId = "00000000-0000-0000-0000-000000000002"
const operationId = "00000000-0000-0000-0000-000000000003"
const mediaId = "00000000-0000-0000-0000-000000000004"

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

describe("offline-sync media route", () => {
  it("claims the visit and uploads to a controlled signature path", async () => {
    uploadStorageObject.mockResolvedValue(undefined)
    const rpc = vi.fn().mockResolvedValue({
      data: { visit_id: visitId, device_id: deviceId },
      error: null,
    })
    const file = new File(["pngdata"], "signature.png", { type: "image/png" })

    await expect(
      handler(
        context(
          new Request("https://example.test/functions/v1/offline-sync/visits/media/media", {
            method: "POST",
          }),
          ["visits", visitId, "media"],
          rpc,
          {
            device_id: deviceId,
            operation_id: operationId,
            media_id: mediaId,
            kind: "signature",
            party: "tecnico",
            file,
          },
        ),
      ),
    ).resolves.toMatchObject({
      data: {
        media_id: mediaId,
        image_id: mediaId,
        bucket: "certificate-signatures",
        object_path: `visits/${visitId}/tecnico/${mediaId}.png`,
      },
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_claim_visit_device", {
      target_visit: visitId,
      target_device: deviceId,
    })
    expect(uploadStorageObject).toHaveBeenCalledWith(
      "certificate-signatures",
      `visits/${visitId}/tecnico/${mediaId}.png`,
      file,
    )
  })
})

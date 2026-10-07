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

  it("rejects evidence without one of the certificate photo sections before claiming the visit", async () => {
    vi.clearAllMocks()
    const rpc = vi.fn()
    const file = new File(["pngdata"], "evidence.png", { type: "image/png" })

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
            kind: "photo",
            category: "unknown_section",
            file,
          },
        ),
      ),
    ).rejects.toThrow("A valid certificate evidence category is required")
    expect(rpc).not.toHaveBeenCalled()
    expect(uploadStorageObject).not.toHaveBeenCalled()
  })

  it("rejects a signature category that does not match its signing party", async () => {
    vi.clearAllMocks()
    const rpc = vi.fn()
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
            category: "firma_cliente",
            file,
          },
        ),
      ),
    ).rejects.toThrow("A signature category must match its party")
    expect(rpc).not.toHaveBeenCalled()
    expect(uploadStorageObject).not.toHaveBeenCalled()
  })
})

describe("offline-sync working set route", () => {
  it("records the working device when loading the offline working set", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { visits: [] }, error: null })

    await expect(
      handler(
        context(
          new Request("https://example.test/functions/v1/offline-sync/offline/working-set", {
            method: "POST",
          }),
          ["offline", "working-set"],
          rpc,
          { device_id: deviceId },
        ),
      ),
    ).resolves.toMatchObject({ data: { visits: [] }, error: null })
    expect(rpc).toHaveBeenCalledWith("api_offline_working_set_for_device", {
      target_device: deviceId,
    })
  })

  it("rejects a working set request without a UUID device identity", async () => {
    const rpc = vi.fn()
    await expect(
      handler(
        context(
          new Request("https://example.test/functions/v1/offline-sync/offline/working-set", {
            method: "POST",
          }),
          ["offline", "working-set"],
          rpc,
          { device_id: "invalid" },
        ),
      ),
    ).rejects.toThrow("A valid device_id is required")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the legacy GET working-set route available", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { visits: [] }, error: null })
    await expect(
      handler(
        context(
          new Request("https://example.test/functions/v1/offline-sync/offline/working-set"),
          ["offline", "working-set"],
          rpc,
          {},
        ),
      ),
    ).resolves.toMatchObject({ data: { visits: [] }, error: null })
    expect(rpc).toHaveBeenCalledWith("api_offline_working_set")
  })
})

describe("offline-sync visit identity validation", () => {
  it("claims a visit using the same device identity supplied by its session", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { visit_id: visitId, device_id: deviceId },
      error: null,
    })

    await expect(
      handler(
        context(
          new Request(`https://example.test/functions/v1/offline-sync/visits/${visitId}/claim`, {
            method: "POST",
          }),
          ["visits", visitId, "claim"],
          rpc,
          { device_id: deviceId },
        ),
      ),
    ).resolves.toMatchObject({ data: { visit_id: visitId, device_id: deviceId }, error: null })
    expect(rpc).toHaveBeenCalledWith("api_claim_visit_device", {
      target_visit: visitId,
      target_device: deviceId,
    })
  })

  it.each([
    { route: ["visits", "invalid", "claim"], body: { device_id: deviceId } },
    { route: ["visits", visitId, "claim"], body: { device_id: "invalid" } },
    { route: ["visits", visitId, "sync"], body: { device_id: "invalid", operations: [] } },
    { route: ["visits", visitId, "sync"], body: { device_id: deviceId, operations: null } },
  ])("rejects invalid visit identity or sync operation shape before RPC", async ({ route, body }) => {
    const rpc = vi.fn()

    await expect(
      handler(
        context(
          new Request(`https://example.test/functions/v1/offline-sync/${route.join("/")}`, {
            method: "POST",
          }),
          route,
          rpc,
          body,
        ),
      ),
    ).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends offline operations together with the claiming device identity", async () => {
    const operations = [{ operation_id: operationId, kind: "complete_visit", payload: {} }]
    const rpc = vi.fn().mockResolvedValue({ data: { visit_id: visitId, operations: [] }, error: null })

    await handler(
      context(
        new Request(`https://example.test/functions/v1/offline-sync/visits/${visitId}/sync`, {
          method: "POST",
        }),
        ["visits", visitId, "sync"],
        rpc,
        { device_id: deviceId, operations },
      ),
    )

    expect(rpc).toHaveBeenCalledWith("api_sync_visit_batch", {
      target_visit: visitId,
      target_device: deviceId,
      operations,
    })
  })

  it("preserves selected Técnico signature identity in the device-bound sync batch", async () => {
    const operations = [
      {
        operation_id: operationId,
        kind: "submit_signature",
        payload: {
          party: "tecnico",
          signer_name: "Ana Técnica",
          bucket: "certificate-signatures",
          object_path: `visits/${visitId}/tecnico/${mediaId}.png`,
          image_id: mediaId,
        },
      },
    ]
    const rpc = vi.fn().mockResolvedValue({ data: { visit_id: visitId, operations: [] }, error: null })

    await handler(
      context(
        new Request(`https://example.test/functions/v1/offline-sync/visits/${visitId}/sync`, {
          method: "POST",
        }),
        ["visits", visitId, "sync"],
        rpc,
        { device_id: deviceId, operations },
      ),
    )

    expect(rpc).toHaveBeenCalledWith("api_sync_visit_batch", {
      target_visit: visitId,
      target_device: deviceId,
      operations,
    })
  })
})

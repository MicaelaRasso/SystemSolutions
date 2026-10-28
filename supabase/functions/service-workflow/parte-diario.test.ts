import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const { downloadStorageObject, removeStorageObject, uploadStorageObject, validateStorageObject } =
  vi.hoisted(() => ({
    downloadStorageObject: vi.fn(),
    removeStorageObject: vi.fn(),
    uploadStorageObject: vi.fn(),
    validateStorageObject: vi.fn(),
  }))

vi.mock("../_shared/storage.ts", () => ({
  downloadStorageObject,
  removeStorageObject,
  uploadStorageObject,
  validateStorageObject,
}))

import type { RouteHandler } from "../_shared/transport.ts"

const visitId = "00000000-0000-0000-0000-000000000101"
const imageId = "00000000-0000-0000-0000-000000000102"
const actorId = "00000000-0000-0000-0000-000000000103"

let handler: RouteHandler

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn(), env: { get: vi.fn() } })
  handler = (await import("./index.ts")).serviceWorkflowHandler
})

afterAll(() => vi.unstubAllGlobals())

const context = (
  request: Request,
  route: string[],
  rpc: ReturnType<typeof vi.fn>,
  body: Record<string, unknown> = {},
) => ({
  request,
  route,
  body,
  actor: { id: actorId, authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

describe("service-workflow Parte diario routes", () => {
  it("stores an alphanumeric code on the visit through the authorized RPC", async () => {
    const result = { visit_id: visitId, codigo: "PD123" }
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null })

    await expect(
      handler(
        context(
          new Request(`https://example.test/visits/${visitId}/parte-diario`, { method: "PUT" }),
          ["visits", visitId, "parte-diario"],
          rpc,
          { codigo: " PD123 " },
        ),
      ),
    ).resolves.toEqual({ data: result, error: null })

    expect(rpc).toHaveBeenCalledWith("api_set_visit_parte_diario", {
      target_visit: visitId,
      pd_code: "PD123",
    })
  })

  it("rejects a non-alphanumeric code before calling the database", async () => {
    const rpc = vi.fn()
    await expect(
      handler(
        context(
          new Request(`https://example.test/visits/${visitId}/parte-diario`, { method: "PUT" }),
          ["visits", visitId, "parte-diario"],
          rpc,
          { codigo: "PD 123" },
        ),
      ),
    ).rejects.toThrow("A valid alphanumeric Parte diario code is required")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("uploads several photos under controlled paths and registers each by PD code", async () => {
    uploadStorageObject.mockResolvedValue(undefined)
    validateStorageObject.mockImplementation(({ objectName, contentType, size }) => ({
      ok: true,
      metadata: { objectName, contentType, size },
    }))
    const rpc = vi.fn().mockResolvedValue({
      data: { image_id: imageId, pd_code: "PD123" },
      error: null,
    })
    const file = new File(["jpegdata"], "parte.jpg", { type: "image/jpeg" })

    await expect(
      handler(
        context(
          new Request(`https://example.test/visits/${visitId}/parte-diario/images`, {
            method: "POST",
          }),
          ["visits", visitId, "parte-diario", "images"],
          rpc,
          { codigo: "PD123", image_id: imageId, file },
        ),
      ),
    ).resolves.toMatchObject({ data: { image_id: imageId, pd_code: "PD123" }, error: null })

    expect(uploadStorageObject).toHaveBeenCalledWith(
      "certificate-evidence",
      `visits/${visitId}/parte-diario/${imageId}.jpg`,
      file,
    )
    expect(rpc).toHaveBeenCalledWith("api_register_visit_parte_diario_image", {
      target_visit: visitId,
      pd_code: "PD123",
      target_image_id: imageId,
      bucket_name: "certificate-evidence",
      asset_path: `visits/${visitId}/parte-diario/${imageId}.jpg`,
    })
  })

  it("returns gateway download paths for private images after the authorized visit read succeeds", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        visit_id: visitId,
        codigo: "PD123",
        images: [{ id: imageId, bucket: "certificate-evidence", object_path: `visits/${visitId}/parte-diario/${imageId}.jpg` }],
      },
      error: null,
    })

    await expect(
      handler(
        context(
          new Request(`https://example.test/visits/${visitId}/parte-diario`),
          ["visits", visitId, "parte-diario"],
          rpc,
        ),
      ),
    ).resolves.toMatchObject({
      data: {
        codigo: "PD123",
        images: [{ download_path: `visits/${visitId}/parte-diario/images/${imageId}` }],
      },
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_visit_parte_diario", { target_visit: visitId })
    expect(downloadStorageObject).not.toHaveBeenCalled()
  })

  it("proxies image bytes through the authorized Edge route", async () => {
    downloadStorageObject.mockResolvedValue(new Blob(["image-bytes"], { type: "image/jpeg" }))
    const rpc = vi.fn().mockResolvedValue({
      data: {
        visit_id: visitId,
        codigo: "PD123",
        images: [{ id: imageId, bucket: "certificate-evidence", object_path: `visits/${visitId}/parte-diario/${imageId}.jpg` }],
      },
      error: null,
    })

    const response = await handler(
      context(
        new Request(`https://example.test/visits/${visitId}/parte-diario/images/${imageId}`),
        ["visits", visitId, "parte-diario", "images", imageId],
        rpc,
      ),
    )

    expect(response).toBeInstanceOf(Response)
    if (!(response instanceof Response)) throw new Error("Expected an image response")
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.text()).resolves.toBe("image-bytes")
    expect(downloadStorageObject).toHaveBeenCalledWith(
      "certificate-evidence",
      `visits/${visitId}/parte-diario/${imageId}.jpg`,
    )
  })
})

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  uploadStorageObject: vi.fn(),
  removeStorageObject: vi.fn(),
  validateStorageObject: vi.fn(
    (input: { objectName: unknown; contentType: unknown; size: unknown }) => ({
      ok: true as const,
      metadata: {
        objectName: input.objectName as string,
        contentType: input.contentType as string,
        size: input.size as number,
      },
    }),
  ),
}))

vi.mock("../_shared/storage.ts", () => storage)

import type { RouteHandler } from "../_shared/transport.ts"

let handler: RouteHandler

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn(), env: { get: vi.fn() } })
  handler = (await import("./index.ts")).certificateFieldHandler
})

afterAll(() => vi.unstubAllGlobals())

const visitId = "00000000-0000-0000-0000-000000000001"

const context = (
  body: Record<string, unknown>,
  rpc: ReturnType<typeof vi.fn>,
  route = ["visits", visitId, "signatures"],
  method = "POST",
) => ({
  request: new Request(`https://example.test/functions/v1/certificate-field/${route.join("/")}`, {
    method,
  }),
  route,
  body,
  actor: { id: "00000000-0000-0000-0000-000000000002", authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

describe("certificate signature upload seam", () => {
  it("requires an administrator correction reason and routes the new visit authorization", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { correction_id: visitId }, error: null })
    const route = ["certificates", visitId, "corrections"]

    await expect(handler(context({ provider_id: visitId, starts_at: "2099-03-10T09:00:00Z", ends_at: "2099-03-10T10:00:00Z", reason: "  Recalibración  " }, rpc, route))).resolves.toEqual({ data: { correction_id: visitId }, error: null })
    expect(rpc).toHaveBeenCalledWith("api_authorize_certificate_correction", {
      source_certificate_id: visitId,
      provider_id: visitId,
      visit_starts_at: "2099-03-10T09:00:00Z",
      visit_ends_at: "2099-03-10T10:00:00Z",
      action_reason: "Recalibración",
    })
    await expect(handler(context({ provider_id: visitId, starts_at: "2099-03-10T09:00:00Z", ends_at: "2099-03-10T10:00:00Z", reason: " " }, rpc, route))).rejects.toThrow("A source certificate")
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("routes Cliente certificate downloads through the scoped export RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { certificate: { id: "certificate-1" } }, error: null })

    await expect(
      handler(context({}, rpc, ["certificates", "certificate-1", "download"], "GET")),
    ).resolves.toEqual({ data: { certificate: { id: "certificate-1" } }, error: null })

    expect(rpc).toHaveBeenCalledWith("api_cliente_certificate_export", {
      certificate_id: "certificate-1",
    })
  })

  it("reads the owning Cliente pending set through its dedicated RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { visits: [] }, error: null })

    await expect(
      handler(context({}, rpc, ["clients", "me", "pending-certificates"], "GET")),
    ).resolves.toEqual({ data: { visits: [] }, error: null })

    expect(rpc).toHaveBeenCalledWith("api_cliente_pending_certificates")
  })

  it("requires image bytes and never registers a client-provided reference", async () => {
    const rpc = vi.fn()
    const response = await handler(
      context(
        {
          party: "tecnico",
          signer_name: "Ana",
          bucket: "other-bucket",
          object_path: "other/path.png",
        },
        rpc,
      ),
    )

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect(storage.uploadStorageObject).not.toHaveBeenCalled()
  })

  it("requires a selected Técnico name before uploading a Técnico signature", async () => {
    const rpc = vi.fn()
    const response = await handler(
      context(
        {
          file: new File(["signature"], "signature.png", { type: "image/png" }),
          party: "tecnico",
          signer_name: "   ",
        },
        rpc,
      ),
    )

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect(storage.uploadStorageObject).not.toHaveBeenCalled()
  })

  it("uploads to a server-generated path and registers that exact path", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { signature_id: "signature-1", finalized_certificates: [] },
      error: null,
    })
    const file = new File(["signature"], "anything.bin", { type: "image/png" })

    await expect(
      handler(
        context(
          {
            file,
            party: "tecnico",
            signer_name: "Ana",
            bucket: "attacker-controlled",
            object_path: "attacker/path.png",
          },
          rpc,
        ),
      ),
    ).resolves.toEqual({
      data: { signature_id: "signature-1", finalized_certificates: [] },
      error: null,
    })

    expect(storage.uploadStorageObject).toHaveBeenCalledTimes(1)
    const [bucket, objectPath, uploadedFile] = storage.uploadStorageObject.mock.calls[0]
    expect(bucket).toBe("certificate-signatures")
    expect(objectPath).toMatch(new RegExp(`^visits/${visitId}/tecnico/[0-9a-f-]{36}\\.png$`))
    expect(uploadedFile).toBe(file)
    expect(rpc).toHaveBeenCalledWith("api_submit_visit_signature", {
      target_visit: visitId,
      signing_party: "tecnico",
      signer_name: "Ana",
      bucket_name: "certificate-signatures",
      asset_path: objectPath,
      capture_method: "pwa_tecnico",
    })
  })

  it("registers the pending Cliente panel capture method for a completed visit", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { signature_id: "signature-2", finalized_certificates: [] },
      error: null,
    })
    const file = new File(["signature"], "signature.png", { type: "image/png" })

    await handler(
      context(
        { file, party: "cliente", signer_name: "Cliente Uno", capture_method: "panel_cliente" },
        rpc,
      ),
    )

    expect(rpc).toHaveBeenCalledWith(
      "api_submit_visit_signature",
      expect.objectContaining({ signing_party: "cliente", capture_method: "panel_cliente" }),
    )
  })

  it("rejects capture methods that do not belong to the signing party", async () => {
    const rpc = vi.fn()
    await expect(
      handler(
        context(
          {
            file: new File(["signature"], "signature.png", { type: "image/png" }),
            party: "tecnico",
            signer_name: "Ana",
            capture_method: "panel_cliente",
          },
          rpc,
        ),
      ),
    ).rejects.toThrow("Invalid Técnico capture method")

    expect(rpc).not.toHaveBeenCalled()
    expect(storage.uploadStorageObject).not.toHaveBeenCalled()
  })

  it("removes an uploaded object when metadata registration is rejected", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "signature already exists" },
    })
    const file = new File(["signature"], "signature.png", { type: "image/png" })

    await handler(context({ file, party: "cliente", signer_name: "Cliente" }, rpc))

    expect(rpc).toHaveBeenCalledWith(
      "api_submit_visit_signature",
      expect.objectContaining({
        signing_party: "cliente",
        capture_method: "pwa_cliente_presencial",
      }),
    )

    expect(storage.removeStorageObject).toHaveBeenCalledWith(
      "certificate-signatures",
      expect.stringMatching(new RegExp(`^visits/${visitId}/cliente/[0-9a-f-]{36}\\.png$`)),
    )
  })
})

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  uploadStorageObject: vi.fn(),
  removeStorageObject: vi.fn(),
  createSignedStorageUrl: vi.fn(
    async (bucket: string, objectName: string) => `https://storage.example.test/${bucket}/${objectName}?token=t`,
  ),
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
  query = "",
) => ({
  request: new Request(`https://example.test/functions/v1/certificate-field/${route.join("/")}${query}`, {
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
  it("passes a validated Parte diario filter to the Cliente certificate history RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { certificates: [] }, error: null })

    await expect(
      handler(context({}, rpc, ["valves", visitId, "certificates"], "GET", "?pd_code=PD123")),
    ).resolves.toEqual({ data: { certificates: [] }, error: null })
    expect(rpc).toHaveBeenCalledWith("api_valvula_certificates_by_pd", {
      target_valvula: visitId,
      pd_code: "PD123",
    })

    await expect(
      handler(context({}, rpc, ["valves", visitId, "certificates"], "GET", "?pd_code=PD%20123")),
    ).rejects.toThrow("pd_code must be alphanumeric")
    expect(rpc).toHaveBeenCalledTimes(1)
  })

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

  it("removes the retried upload when the signature was already registered (P1)", async () => {
    storage.removeStorageObject.mockClear()
    const registered = {
      signature_id: visitId,
      image_id: visitId,
      finalized_certificates: [],
      already_registered: true,
    }
    const rpc = vi.fn().mockResolvedValue({ data: registered, error: null })
    const file = new File(["signature"], "signature.png", { type: "image/png" })

    await expect(
      handler(context({ file, party: "tecnico", signer_name: "Tomás" }, rpc)),
    ).resolves.toEqual({ data: registered, error: null })

    expect(storage.removeStorageObject).toHaveBeenCalledWith(
      "certificate-signatures",
      expect.stringMatching(new RegExp(`^visits/${visitId}/tecnico/[0-9a-f-]{36}\\.png$`)),
    )
  })
})

describe("signed image URLs in certificate reads (D7)", () => {
  const certificateId = "00000000-0000-0000-0000-0000000000c1"
  const signed = (bucket: string, path: string) => `https://storage.example.test/${bucket}/${path}?token=t`
  const finalized = () => ({
    certificate: {
      id: certificateId,
      evidencia_fotografica: {
        desarmada: { bucket: "certificate-evidence", image_id: "i1", object_path: "visits/v/evidence/i1.png" },
      },
    },
    images: [{ id: "i2", bucket: "certificate-evidence", categoria: "parte_diario", object_path: "visits/v/parte-diario/i2.png" }],
    signatures: [{ parte: "tecnico", image: { id: "s1", bucket: "certificate-signatures", object_path: "visits/v/tecnico/s1.png" } }],
    client_logo: null,
    other: { bucket: "attachments", object_path: "private/doc.pdf" },
  })

  for (const [route, rpcName] of [
    ["finalized", "api_finalized_certificate"],
    ["download", "api_cliente_certificate_export"],
  ] as const) {
    it(`adds a signed url to every evidence, image and signature reference (${route})`, async () => {
      const rpc = vi.fn().mockResolvedValue({ data: finalized(), error: null })
      const result = (await handler(context({}, rpc, ["certificates", certificateId, route], "GET"))) as {
        data: ReturnType<typeof finalized> & Record<string, never>
      }
      expect(rpc).toHaveBeenCalledWith(rpcName, { certificate_id: certificateId })
      const data = result.data as unknown as {
        certificate: { evidencia_fotografica: { desarmada: { url?: string } } }
        images: { url?: string }[]
        signatures: { image: { url?: string } }[]
        other: { url?: string }
      }
      expect(data.certificate.evidencia_fotografica.desarmada.url).toBe(
        signed("certificate-evidence", "visits/v/evidence/i1.png"),
      )
      expect(data.images[0].url).toBe(signed("certificate-evidence", "visits/v/parte-diario/i2.png"))
      expect(data.signatures[0].image.url).toBe(signed("certificate-signatures", "visits/v/tecnico/s1.png"))
      // Solo buckets de imágenes del certificado: nunca adjuntos privados.
      expect(data.other.url).toBeUndefined()
    })
  }

  it("keeps the response when a signed url cannot be created", async () => {
    storage.createSignedStorageUrl.mockRejectedValueOnce(new Error("storage down"))
    const rpc = vi.fn().mockResolvedValue({ data: { images: [{ bucket: "certificate-evidence", object_path: "visits/v/x.png" }] }, error: null })
    const result = (await handler(context({}, rpc, ["certificates", certificateId, "finalized"], "GET"))) as {
      data: { images: { url?: string }[] }
    }
    expect(result.data.images[0].url).toBeUndefined()
  })

  it("passes RPC errors through unchanged", async () => {
    const error = { message: "denied", code: "42501" }
    const rpc = vi.fn().mockResolvedValue({ data: null, error })
    await expect(handler(context({}, rpc, ["certificates", certificateId, "finalized"], "GET"))).resolves.toEqual({
      data: null,
      error,
    })
  })
})

describe("historial de certificados de varias Válvulas en un solo pedido", () => {
  const valvulaA = "00000000-0000-0000-0000-00000000000a"
  const valvulaB = "00000000-0000-0000-0000-00000000000b"

  it("consulta el historial de cada Válvula y devuelve uno por id, sin las que fallan", async () => {
    const rpc = vi.fn(async (_name: string, args: { target_valvula: string }) =>
      args.target_valvula === valvulaA
        ? { data: { current_certificate_id: null, certificates: [{ certificate: { id: "c-1" } }] }, error: null }
        : { data: null, error: { message: "Válvula fuera del alcance", code: "42501" } },
    )

    await expect(
      handler(context({ valve_ids: [valvulaA, valvulaB, valvulaA] }, rpc, ["certificates", "valve-histories"])),
    ).resolves.toEqual({
      data: {
        histories: [
          { valve_id: valvulaA, current_certificate_id: null, certificates: [{ certificate: { id: "c-1" } }] },
        ],
        failed_valve_ids: [valvulaB],
      },
      error: null,
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith("api_valvula_certificates_by_pd", { target_valvula: valvulaA, pd_code: null })
  })

  it("rechaza una lista vacía, ids inválidos o más de 200 Válvulas", async () => {
    const rpc = vi.fn()
    const pedir = (valveIds: unknown) =>
      handler(context({ valve_ids: valveIds }, rpc, ["certificates", "valve-histories"]))

    await expect(pedir([])).rejects.toThrow("valve_ids")
    await expect(pedir(["no-es-uuid"])).rejects.toThrow("valve_ids")
    await expect(pedir("x")).rejects.toThrow("valve_ids")
    const muchas = Array.from({ length: 201 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`)
    await expect(pedir(muchas)).rejects.toThrow("valve_ids")
    expect(rpc).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createCertificatesApi } from "./certificates"

describe("visit signature uploads", () => {
  it("sends the explicit Cliente panel capture method with the image", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ signature_id: "signature-1", finalized_certificates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createCertificatesApi(edge).uploadVisitSignature("visit-1", {
      party: "cliente",
      captureMethod: "panel_cliente",
      signerName: "Cliente Uno",
      file: new File(["signature"], "firma.png", { type: "image/png" }),
    })

    const [, init] = request.mock.calls[0]
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get("capture_method")).toBe("panel_cliente")
  })

  it("keeps the Técnico capture request on the existing in-person method", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ signature_id: "signature-1", finalized_certificates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createCertificatesApi(edge).uploadVisitSignature("visit-1", {
      party: "tecnico",
      signerName: "Técnico Uno",
      file: new File(["signature"], "firma.png", { type: "image/png" }),
    })

    const [, init] = request.mock.calls[0]
    expect((init?.body as FormData).has("capture_method")).toBe(false)
  })
})

describe("typed pending Cliente certificate read", () => {
  it("routes and parses the server-owned pending visit contract", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          visits: [
            {
              visit: { id: "visit-1", estado: "completada" },
              yacimiento: { id: "yac-1", nombre: "Norte" },
              work_orders: [{ id: "order-1", estado: "evaluada" }],
              pending_certificates: [{ id: "certificate-1", estado: "pendiente" }],
              pending_certificate_count: 1,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(createCertificatesApi(edge).pendingClientSignatureVisits()).resolves.toEqual({
      visits: [
        expect.objectContaining({
          visit: { id: "visit-1", estado: "completada" },
          pending_certificate_count: 1,
        }),
      ],
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/certificate-field/clients/me/pending-certificates",
      expect.anything(),
    )
  })

  it("rejects a response that omits the server-derived pending count", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          visits: [
            {
              visit: { id: "visit-1" },
              yacimiento: { id: "yac-1", nombre: "Norte" },
              work_orders: [],
              pending_certificates: [],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(createCertificatesApi(edge).pendingClientSignatureVisits()).rejects.toThrow()
  })
})

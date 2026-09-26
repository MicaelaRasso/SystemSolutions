import { describe, expect, it, vi } from "vitest"

import { EdgeTransport, createEdgeFunctionRegistry } from "./edge-transport"

describe("EdgeTransport", () => {
  it("selects configured function URLs and falls back to service-access", () => {
    const registry = createEdgeFunctionRegistry({
      serviceAccessUrl: "https://example.test/functions/v1/service-access/",
      functionUrls: { "asset-access": "https://assets.test/functions/v1/asset-access/" },
    })

    expect(registry).toEqual({
      "identity-admin": "https://example.test/functions/v1/service-access",
      "asset-access": "https://assets.test/functions/v1/asset-access",
      "service-workflow": "https://example.test/functions/v1/service-access",
      "certificate-field": "https://example.test/functions/v1/service-access",
      "offline-sync": "https://example.test/functions/v1/service-access",
      "service-access": "https://example.test/functions/v1/service-access",
    })
  })

  it("sends Auth, apikey, correlation, and JSON headers and parses JSON", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
    const transport = new EdgeTransport({
      serviceAccessUrl: "https://example.test/service-access",
      anonKey: "publishable-key",
      auth: () => ({ auth: { getSession } }) as never,
      correlationId: "correlation-1",
      request,
    })

    await expect(
      transport.request("service-workflow", "requests", {
        method: "POST",
        body: JSON.stringify({ name: "request" }),
      }),
    ).resolves.toEqual({ accepted: true })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/service-access/requests",
      expect.objectContaining({
        method: "POST",
        headers: {
          apikey: "publishable-key",
          authorization: "Bearer session-token",
          "content-type": "application/json",
          "x-correlation-id": "correlation-1",
        },
        body: JSON.stringify({ name: "request" }),
      }),
    )
  })

  it("maps structured and non-JSON HTTP errors", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Denied" }), { status: 403 }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
    const transport = new EdgeTransport({
      serviceAccessUrl: "https://example.test/service-access",
      request,
    })

    await expect(transport.request("identity-admin", "context")).rejects.toMatchObject({
      message: "Denied",
      code: "unauthorized",
    })
    await expect(transport.request("identity-admin", "context")).rejects.toMatchObject({
      message: "La Edge Function rechazó la solicitud",
      code: "network",
    })
  })
})

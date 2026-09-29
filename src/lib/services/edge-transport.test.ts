import { describe, expect, it, vi } from "vitest"

import { EdgeTransport, createEdgeFunctionRegistry } from "./edge-transport"

const functionUrls = {
  "identity-admin": "https://identity.test/functions/v1/identity-admin",
  "asset-access": "https://assets.test/functions/v1/asset-access",
  "service-workflow": "https://workflow.test/functions/v1/service-workflow",
  "certificate-field": "https://certificates.test/functions/v1/certificate-field",
  "offline-sync": "https://offline.test/functions/v1/offline-sync",
  "backup-export": "https://backup.test/functions/v1/backup-export",
}

describe("EdgeTransport", () => {
  it("uses one direct URL for each owning function", () => {
    expect(createEdgeFunctionRegistry({ functionUrls })).toEqual(functionUrls)
    expect(createEdgeFunctionRegistry({ baseUrl: "https://project.test" })).toEqual({
      "identity-admin": "https://project.test/functions/v1/identity-admin",
      "asset-access": "https://project.test/functions/v1/asset-access",
      "service-workflow": "https://project.test/functions/v1/service-workflow",
      "certificate-field": "https://project.test/functions/v1/certificate-field",
      "offline-sync": "https://project.test/functions/v1/offline-sync",
      "backup-export": "https://project.test/functions/v1/backup-export",
    })
  })

  it("sends Auth, apikey, correlation, and JSON headers to the selected owner", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
    const transport = new EdgeTransport({
      functionUrls,
      publishableKey: "publishable-key",
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
      "https://workflow.test/functions/v1/service-workflow/requests",
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

  it("does not invent an owner URL when Supabase is unconfigured", async () => {
    const transport = new EdgeTransport({ functionUrls: {} })
    await expect(transport.request("identity-admin", "context")).rejects.toMatchObject({
      code: "network",
    })
  })

  it("maps structured and non-JSON HTTP errors", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Denied" }), { status: 403 }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
    const transport = new EdgeTransport({ functionUrls, request })

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

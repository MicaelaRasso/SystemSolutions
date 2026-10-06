import { describe, expect, it, vi } from "vitest"

import type { RpcResult, ServiceRoleClient } from "./db.ts"
import { handleRequest } from "./transport.ts"

const actor = { id: "account-1", authorization: "Bearer valid-token" }

const request = (method = "POST", path = "/offline-sync/visits/visit-1/media") =>
  new Request(`https://example.test/functions/v1${path}`, {
    method,
    headers: { authorization: actor.authorization, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: "{}" }),
  })

const dependencies = (result: RpcResult, events: string[] = []) => {
  const rpc = vi.fn(async (name: string) => {
    events.push(`rpc:${name}`)
    return result
  })
  const db = { rpc } as unknown as ServiceRoleClient
  return {
    rpc,
    authenticateRequest: vi.fn(async () => actor),
    createServiceRoleClient: vi.fn(async () => db),
  }
}

describe("shared transport account-state check", () => {
  it("denies a disabled account before a handler can perform Storage side effects", async () => {
    const events: string[] = []
    const deps = dependencies(
      { data: null, error: { code: "42501", message: "Cuenta is not active" } },
      events,
    )
    const handler = vi.fn(async () => {
      events.push("storage-upload")
      return new Response("uploaded")
    })

    const response = await handleRequest(request(), "offline-sync", handler, deps)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Cuenta is not active" })
    expect(deps.rpc).toHaveBeenCalledExactlyOnceWith("api_context")
    expect(handler).not.toHaveBeenCalled()
    expect(events).toEqual(["rpc:api_context"])
  })

  it("rejects a non-active context even if the RPC returns without an error", async () => {
    const deps = dependencies({
      data: [{ cuenta_id: actor.id, estado: "pendiente" }],
      error: null,
    })
    const handler = vi.fn(async () => new Response("should not run"))

    const response = await handleRequest(request(), "offline-sync", handler, deps)

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it("checks account state before dispatching an active account", async () => {
    const events: string[] = []
    const deps = dependencies({
      data: [{ cuenta_id: actor.id, estado: "activa" }],
      error: null,
    }, events)
    const handler = vi.fn(async () => {
      events.push("handler")
      return new Response("ok")
    })

    const response = await handleRequest(request(), "offline-sync", handler, deps)

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(events).toEqual(["rpc:api_context", "handler"])
  })

  it("fails closed when current account state cannot be verified", async () => {
    const deps = dependencies({
      data: null,
      error: { code: "08006", message: "database unavailable" },
    })
    const handler = vi.fn(async () => new Response("should not run"))

    const response = await handleRequest(request(), "offline-sync", handler, deps)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "Unable to verify account access" })
    expect(handler).not.toHaveBeenCalled()
  })
})

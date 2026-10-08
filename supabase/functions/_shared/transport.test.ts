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
    expect(deps.rpc).toHaveBeenNthCalledWith(1, "api_context")
    expect(deps.rpc).toHaveBeenNthCalledWith(2, "record_sensitive_rejection", expect.objectContaining({ action_name: "access_denied" }))
    expect(handler).not.toHaveBeenCalled()
    expect(events).toEqual(["rpc:api_context", "rpc:record_sensitive_rejection"])
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

describe("shared transport rejected sensitive attempt auditing", () => {
  const activeAccount = { data: [{ cuenta_id: actor.id, estado: "activa" }], error: null }
  const denied = { data: null, error: { code: "42501", message: "Only an active Administrador can perform this action" } }

  it("records authorization denials on sensitive mutation routes and preserves the original response", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(activeAccount)
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce({ data: null, error: { code: "08006", message: "audit unavailable" } })
    const db = { rpc } as unknown as ServiceRoleClient
    const response = await handleRequest(
      request("POST", "/service-workflow/visits/00000000-0000-0000-0000-000000000001/cancel"),
      "service-workflow",
      async () => denied,
      {
        authenticateRequest: vi.fn(async () => actor),
        createServiceRoleClient: vi.fn(async () => db),
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: denied.error.message })
    expect(rpc).toHaveBeenNthCalledWith(2, "record_sensitive_rejection", expect.objectContaining({
      action_name: "access_denied",
      target_type: "visita_servicio",
      target_id: "00000000-0000-0000-0000-000000000001",
    }))
  })

  it("does not record form validation failures or ordinary reads", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(activeAccount)
      .mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Invalid input" } })
    const db = { rpc } as unknown as ServiceRoleClient
    const response = await handleRequest(
      request("POST", "/service-workflow/visits/00000000-0000-0000-0000-000000000001/cancel"),
      "service-workflow",
      async () => ({ data: null, error: { code: "22023", message: "Invalid input" } }),
      {
        authenticateRequest: vi.fn(async () => actor),
        createServiceRoleClient: vi.fn(async () => db),
      },
    )
    expect(response.status).toBe(400)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("does not record denied ordinary audit reads", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce(activeAccount)
      .mockResolvedValueOnce(denied)
    const db = { rpc } as unknown as ServiceRoleClient
    const response = await handleRequest(
      request("GET", "/audit-log/audit"),
      "audit-log",
      async () => denied,
      {
        authenticateRequest: vi.fn(async () => actor),
        createServiceRoleClient: vi.fn(async () => db),
      },
    )
    expect(response.status).toBe(403)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

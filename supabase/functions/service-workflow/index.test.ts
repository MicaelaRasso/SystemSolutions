import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { RouteHandler } from "../_shared/transport.ts"

const operationId = "00000000-0000-0000-0000-000000000001"
const clientId = "00000000-0000-0000-0000-000000000002"

const operation = {
  id: operationId,
  solicitud_id: "00000000-0000-0000-0000-000000000006",
  numero_solicitud: 12,
  estado: "solicitada",
  starts_at: "2026-09-10T11:00:00.000Z",
  ends_at: "2026-09-10T12:00:00.000Z",
  cliente: { id: clientId, nombre: "Cliente" },
  yacimiento: { id: "00000000-0000-0000-0000-000000000003", nombre: "Yacimiento" },
  taller_movil: { id: "00000000-0000-0000-0000-000000000007", nombre: "Taller" },
  ordenes: { total: 1, pendientes: 1, evaluadas: 0, no_evaluadas: 0 },
}

const listEnvelope = {
  items: [operation],
  total: 1,
  limit: 1,
  offset: 0,
  has_more: false,
}
const workOrderDetail = {
  work_order: { id: "00000000-0000-0000-0000-000000000008" },
  valve: {
    id: "00000000-0000-0000-0000-000000000009",
    equipo_id: "00000000-0000-0000-0000-000000000010",
    nombre: "V-10",
  },
  context: {
    yacimiento: { id: "00000000-0000-0000-0000-000000000003", nombre: "Yacimiento" },
    planta: {
      id: "00000000-0000-0000-0000-000000000011",
      yacimiento_id: "00000000-0000-0000-0000-000000000003",
      nombre: "Planta",
    },
    equipo: {
      id: "00000000-0000-0000-0000-000000000010",
      planta_id: "00000000-0000-0000-0000-000000000011",
      nombre: "Equipo",
    },
  },
}
const detailEnvelope = {
  operation,
  visit: { visit: { id: operationId, estado: "solicitada" }, work_orders: [workOrderDetail] },
  request: { request: { id: "request-1" }, selected_valves: [] },
  work_orders: [workOrderDetail],
}

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
  actor: { id: clientId, authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

describe("service-workflow operations read routes", () => {
  it("calls api_operations and returns the validated list envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: listEnvelope, error: null })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations?status=solicitada&limit=1&offset=0",
    )

    await expect(handler(context(request, ["operations"], rpc))).resolves.toEqual({
      data: listEnvelope,
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_operations", {
      from_date: null,
      to_date: null,
      status_filter: "solicitada",
      workshop_filter: null,
      client_filter: null,
      search_text: null,
      limit_count: 1,
      offset_count: 0,
    })
  })

  it("calls api_operation and returns the validated detail envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: detailEnvelope, error: null })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations/" + operationId,
    )

    await expect(handler(context(request, ["operations", operationId], rpc))).resolves.toEqual({
      data: detailEnvelope,
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_operation", { target_visit: operationId })
  })

  it("passes filters and pagination to the list RPC without mutating requests", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...listEnvelope, items: [], total: 8, limit: 100, offset: 7, has_more: true },
      error: null,
    })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations?from=2026-09-01&to=2026-09-30&status=programada%2Ccompletada&workshop_id=" +
        operationId +
        "&client_id=" +
        clientId +
        "&q=valve&limit=100&offset=7",
    )

    await expect(handler(context(request, ["operations"], rpc))).resolves.toEqual({
      data: { ...listEnvelope, items: [], total: 8, limit: 100, offset: 7, has_more: true },
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_operations", {
      from_date: "2026-09-01",
      to_date: "2026-09-30",
      status_filter: "programada,completada",
      workshop_filter: operationId,
      client_filter: clientId,
      search_text: "valve",
      limit_count: 100,
      offset_count: 7,
    })
  })

  it("rejects an invalid operation UUID before calling the detail RPC", async () => {
    const rpc = vi.fn()
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations/not-a-uuid",
    )

    await expect(
      handler(context(request, ["operations", "not-a-uuid"], rpc)),
    ).rejects.toMatchObject({
      status: 400,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns 404 for an absent detail without treating it as a malformed response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations/" + operationId,
    )

    const response = await handler(context(request, ["operations", operationId], rpc))
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Operation not found" })
  })

  it("rejects malformed RPC data before returning it", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...listEnvelope, items: [{ ...operation, estado: "invalid" }] },
      error: null,
    })
    const request = new Request("https://example.test/functions/v1/service-workflow/operations")

    await expect(handler(context(request, ["operations"], rpc))).rejects.toMatchObject({
      status: 502,
    })
  })

  it("rejects a detail response without the canonical request envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        operation: detailEnvelope.operation,
        visit: detailEnvelope.visit,
        service_request: detailEnvelope.request,
        work_orders: detailEnvelope.work_orders,
      },
      error: null,
    })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations/" + operationId,
    )

    await expect(handler(context(request, ["operations", operationId], rpc))).rejects.toMatchObject(
      {
        status: 502,
      },
    )
  })

  it("accepts SQL detail work orders and rejects malformed nested orders", async () => {
    const validRpc = vi.fn().mockResolvedValue({ data: detailEnvelope, error: null })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/operations/" + operationId,
    )

    await expect(handler(context(request, ["operations", operationId], validRpc))).resolves.toEqual(
      { data: detailEnvelope, error: null },
    )

    const malformedRpc = vi.fn().mockResolvedValue({
      data: {
        ...detailEnvelope,
        work_orders: [{ ...workOrderDetail, context: { ...workOrderDetail.context, equipo: {} } }],
      },
      error: null,
    })
    await expect(
      handler(context(request, ["operations", operationId], malformedRpc)),
    ).rejects.toMatchObject({ status: 502 })
  })

  it.each(["POST", "PATCH"])("%s operations are 404 and do not execute an RPC", async (method) => {
    const rpc = vi.fn()
    const route = method === "POST" ? ["operations"] : ["operations", operationId]
    const request = new Request("https://example.test/functions/v1/service-workflow/operations", {
      method,
    })

    const response = await handler(context(request, route, rpc))
    expect(response.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("service-workflow mutation routes", () => {
  it.each([
    {
      name: "edits a service request",
      method: "PATCH",
      route: ["requests", clientId],
      body: { selections: [{ kind: "valvula", id: operationId }] },
      rpcName: "api_update_service_request",
      rpcArgs: { request_id: clientId, selections: [{ kind: "valvula", id: operationId }] },
    },
    {
      name: "schedules a visit",
      method: "POST",
      route: ["requests", clientId, "schedule"],
      body: {
        taller_movil_id: clientId,
        starts_at: "2099-01-01T09:00:00Z",
        ends_at: "2099-01-01T10:00:00Z",
      },
      rpcName: "api_schedule_visit",
      rpcArgs: {
        request_id: clientId,
        provider_id: clientId,
        visit_starts_at: "2099-01-01T09:00:00Z",
        visit_ends_at: "2099-01-01T10:00:00Z",
      },
    },
    {
      name: "accepts a visit",
      method: "POST",
      route: ["visits", operationId, "accept"],
      body: {},
      rpcName: "api_accept_visit",
      rpcArgs: { visit_id: operationId },
    },
    {
      name: "rejects a visit",
      method: "POST",
      route: ["visits", operationId, "reject"],
      body: {},
      rpcName: "api_reject_visit",
      rpcArgs: { visit_id: operationId },
    },
    {
      name: "cancels a visit",
      method: "POST",
      route: ["visits", operationId, "cancel"],
      body: {},
      rpcName: "api_cancel_visit",
      rpcArgs: { visit_id: operationId },
    },
    {
      name: "starts a visit",
      method: "POST",
      route: ["visits", operationId, "start"],
      body: {},
      rpcName: "api_start_visit",
      rpcArgs: { visit_id: operationId },
    },
    {
      name: "completes a visit",
      method: "POST",
      route: ["visits", operationId, "complete"],
      body: {},
      rpcName: "api_complete_visit",
      rpcArgs: { visit_id: operationId },
    },
    {
      name: "adds a work order",
      method: "POST",
      route: ["visits", operationId, "work-orders"],
      body: { valvula_id: clientId },
      rpcName: "api_add_work_order",
      rpcArgs: { visit_id: operationId, target_valvula: clientId },
    },
    {
      name: "updates a work order outcome",
      method: "PATCH",
      route: ["work-orders", operationId],
      body: { outcome: "no_evaluada", not_evaluated_reason: "No access" },
      rpcName: "api_update_work_order",
      rpcArgs: {
        work_order_id: operationId,
        outcome: "no_evaluada",
        not_evaluated_reason: "No access",
      },
    },
  ])("$name through the Edge RPC seam", async ({ method, route, body, rpcName, rpcArgs }) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })
    const request = new Request(
      "https://example.test/functions/v1/service-workflow/" + route.join("/"),
      {
        method,
      },
    )

    await expect(handler(context(request, route, rpc, body))).resolves.toEqual({
      data: { ok: true },
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith(rpcName, rpcArgs)
  })
})

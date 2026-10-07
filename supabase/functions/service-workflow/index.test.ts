import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { RouteHandler } from "../_shared/transport.ts"

const operationId = "00000000-0000-0000-0000-000000000001"
const clientId = "00000000-0000-0000-0000-000000000002"
const replacementCatalogVersionId = "00000000-0000-0000-0000-000000000003"
const deviceId = "00000000-0000-0000-0000-000000000004"

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

describe("service-workflow visits read route", () => {
  it("routes the canonical visit list through api_visits", async () => {
    const visits = [{ visit: { id: operationId, estado: "programada" }, work_orders: [] }]
    const rpc = vi.fn().mockResolvedValue({ data: visits, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/visits")

    await expect(handler(context(request, ["visits"], rpc))).resolves.toEqual({
      data: visits,
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_visits")
  })
})

describe("service-workflow audit read routes", () => {
  it("returns the audit list envelope without requiring an export format", async () => {
    const auditEnvelope = { items: [], total: 0, limit: 100, offset: 0, has_more: false }
    const rpc = vi.fn().mockResolvedValue({ data: auditEnvelope, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/audit")

    await expect(handler(context(request, ["audit"], rpc))).resolves.toEqual({
      data: auditEnvelope,
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_audit_events", {
      from_date: null,
      to_date: null,
      actor_filter: null,
      action_filter: null,
      target_type_filter: null,
      outcome_filter: null,
      client_filter: null,
      yacimiento_filter: null,
      visit_filter: null,
      certificate_filter: null,
      limit_count: 100,
      offset_count: 0,
    })
  })

  it("requires an export format only for the audit export route", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { items: [], total: 0, limit: 100, offset: 0, has_more: false },
      error: null,
    })
    const request = new Request("https://example.test/functions/v1/service-workflow/audit/export")

    const response = await handler(context(request, ["audit", "export"], rpc))

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "format must be json or csv" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns complete matching event rows as JSON attachments", async () => {
    const event = {
      id: "audit-id",
      actor_cuenta_id: "actor-id",
      actor_email: "admin@example.test",
      actor_rol: "super_administrador",
      accion: "visita_completada",
      tipo_objetivo: "visita_servicio",
      objetivo_id: "visit-id",
      resultado: "exitoso",
      recibida_en: "2026-10-07T12:00:00Z",
      evento_dispositivo_en: "2026-10-07T11:55:00Z",
      identidad_correlacion: "trace-123",
      resumen_cambio: { estado_nuevo: "completada" },
      identificadores_relacionados: { solicitud_id: "request-id" },
      certificado_id: "certificate-id",
      cliente_cuenta_id: "client-id",
      yacimiento_id: "deposit-id",
      yacimiento_nombre: "Yacimiento Norte",
    }
    const rpc = vi.fn().mockResolvedValue({ data: { items: [event], total: 1 }, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/audit/export?action=visita_completada&format=json")
    const response = await handler(context(request, ["audit", "export"], rpc)) as Response

    expect(rpc).toHaveBeenCalledWith("api_audit_export", expect.objectContaining({ action_filter: "visita_completada" }))
    expect(response.headers.get("content-disposition")).toContain("auditoria.json")
    await expect(response.json()).resolves.toEqual([event])
  })

  it("renders CSV with quoted event details and trace identifiers", async () => {
    const event = {
      id: "audit-id",
      actor_cuenta_id: "actor-id",
      actor_email: "admin@example.test",
      actor_rol: "super_administrador",
      accion: "visita_completada",
      tipo_objetivo: "visita_servicio",
      objetivo_id: "visit-id",
      resultado: "exitoso",
      recibida_en: "2026-10-07T12:00:00Z",
      evento_dispositivo_en: "2026-10-07T11:55:00Z",
      identidad_correlacion: "trace-123",
      resumen_cambio: { comentario: 'Revisión, "aprobada"' },
      identificadores_relacionados: { solicitud_id: "request-id" },
      certificado_id: "certificate-id",
      cliente_cuenta_id: "client-id",
      yacimiento_id: "deposit-id",
      yacimiento_nombre: "Yacimiento Norte",
    }
    const rpc = vi.fn().mockResolvedValue({ data: { items: [event], total: 1 }, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/audit/export?visit_id=visit-id&format=csv")
    const response = await handler(context(request, ["audit", "export"], rpc)) as Response
    const csv = await response.text()

    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("auditoria.csv")
    expect(csv).toContain("ID de correlación")
    expect(csv).toContain("trace-123")
    expect(csv).toContain('""comentario""')
    expect(csv).toContain('Revisión, \\\""aprobada\\\""')
    expect(rpc).toHaveBeenCalledWith("api_audit_export", expect.objectContaining({ visit_filter: "visit-id" }))
  })
})

describe("service-workflow operational metrics route", () => {
  it("passes the selected period to the role-scoped metrics RPC", async () => {
    const metrics = {
      from: "2026-10-01",
      to: "2026-10-31",
      finalized_certificates: 2,
      completed_visits: 3,
      pending_certificates: 4,
      expiring_certificates: 5,
      unassigned_visits: 6,
    }
    const rpc = vi.fn().mockResolvedValue({ data: metrics, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/admin/metrics?from=2026-10-01&to=2026-10-31")

    await expect(handler(context(request, ["admin", "metrics"], rpc))).resolves.toEqual({
      data: metrics,
      error: null,
    })
    expect(rpc).toHaveBeenCalledWith("api_admin_metrics", {
      period_from: "2026-10-01",
      period_to: "2026-10-31",
    })
  })
})

describe("service-workflow administrative certificate history routes", () => {
  it("passes all searchable history filters, including visit signature state", async () => {
    const envelope = { items: [], total: 0, limit: 50, offset: 0 }
    const rpc = vi.fn().mockResolvedValue({ data: envelope, error: null })
    const request = new Request("https://example.test/functions/v1/service-workflow/admin/certificates?client_id=client-1&yacimiento_id=field-1&plant_id=plant-1&valve_id=valve-1&state=pendiente&signature_state=partial&valid_until=2027-10-07&q=V-1&limit=50&offset=0")

    await expect(handler(context(request, ["admin", "certificates"], rpc))).resolves.toEqual({ data: envelope, error: null })
    expect(rpc).toHaveBeenCalledWith("api_admin_certificate_history", {
      client_filter: "client-1", yacimiento_filter: "field-1", plant_filter: "plant-1", valve_filter: "valve-1",
      state_filter: "pendiente", signature_state_filter: "partial", valid_until_filter: "2027-10-07",
      search_text: "V-1", limit_count: 50, offset_count: 0,
    })
  })

  it("uses the audited administrative download RPC for pending or finalized certificates", async () => {
    const detail = { certificate: { id: operationId, estado: "pendiente" }, history: [], audit_events: [] }
    const rpc = vi.fn().mockResolvedValue({ data: detail, error: null })
    const request = new Request(`https://example.test/functions/v1/service-workflow/admin/certificates/${operationId}/download`)

    await expect(handler(context(request, ["admin", "certificates", operationId, "download"], rpc))).resolves.toEqual({ data: detail, error: null })
    expect(rpc).toHaveBeenCalledWith("api_admin_certificate_export", { certificate_id: operationId })
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
      name: "assigns an unassigned visit",
      method: "POST",
      route: ["visits", operationId, "assign"],
      body: { taller_movil_id: clientId, starts_at: null, ends_at: null, reason: "Cobertura disponible" },
      rpcName: "api_assign_visit",
      rpcArgs: { visit_id: operationId, provider_id: clientId, action_reason: "Cobertura disponible", visit_starts_at: null, visit_ends_at: null },
    },
    {
      name: "unassigns a visit",
      method: "POST",
      route: ["visits", operationId, "unassign"],
      body: { reason: "Cambio operativo" },
      rpcName: "api_unassign_visit",
      rpcArgs: { visit_id: operationId, action_reason: "Cambio operativo" },
    },
    {
      name: "reassigns a visit",
      method: "POST",
      route: ["visits", operationId, "reassign"],
      body: { taller_movil_id: clientId, starts_at: null, ends_at: null, reason: "Cambio de cobertura" },
      rpcName: "api_reassign_visit",
      rpcArgs: { visit_id: operationId, provider_id: clientId, action_reason: "Cambio de cobertura", visit_starts_at: null, visit_ends_at: null },
    },
    {
      name: "cancels a visit as an administrator",
      method: "POST",
      route: ["visits", operationId, "cancel-administrator"],
      body: { reason: "El Cliente modificó su agenda" },
      rpcName: "api_admin_cancel_visit",
      rpcArgs: { visit_id: operationId, action_reason: "El Cliente modificó su agenda" },
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
      body: { replacement_catalog_version_id: replacementCatalogVersionId, device_id: deviceId },
      rpcName: "api_start_visit_with_catalog",
      rpcArgs: {
        visit_id: operationId,
        replacement_catalog_version_id: replacementCatalogVersionId,
        target_device: deviceId,
      },
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

  it("rejects visit start without a device claim and downloaded catalog", async () => {
    const rpc = vi.fn()
    const route = ["visits", operationId, "start"]
    const request = new Request(
      `https://example.test/functions/v1/service-workflow/${route.join("/")}`,
      { method: "POST" },
    )

    await expect(handler(context(request, route, rpc, {}))).rejects.toThrow(
      "A valid replacement catalog version and device_id are required",
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it("authorizes an Administrador before creating the selected Cliente's request", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { request: { id: "request-1" }, selected_valves: [] }, error: null })
    const route = ["admin", "requests"]
    const request = new Request("https://example.test/functions/v1/service-workflow/admin/requests", {
      method: "POST",
    })

    await expect(handler(context(request, route, rpc, {
      cliente_cuenta_id: clientId,
      yacimiento_id: operationId,
      selections: [{ kind: "equipo", id: operationId }],
    }))).resolves.toMatchObject({ error: null })
    expect(rpc).toHaveBeenNthCalledWith(1, "api_actor_is_admin", {})
    expect(rpc).toHaveBeenNthCalledWith(2, "api_admin_create_service_request", {
      target_client: clientId,
      target_yacimiento: operationId,
      selections: [{ kind: "equipo", id: operationId }],
    })
  })

  it("denies non-administrators at the Edge route before the mutation RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const route = ["admin", "requests"]
    const request = new Request("https://example.test/functions/v1/service-workflow/admin/requests", {
      method: "POST",
    })

    await expect(handler(context(request, route, rpc, {}))).rejects.toMatchObject({ status: 403 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("api_actor_is_admin", {})
  })
})

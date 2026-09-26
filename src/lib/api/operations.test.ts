import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import {
  operationDetailDtoSchema,
  operationListDtoSchema,
  operationStatusSchema,
  operationSummarySchema,
} from "./contracts"
import { createOperationsApi, serializeOperationFilters } from "./operations"

const operation = {
  id: "visit-1",
  solicitud_id: "request-1",
  numero_solicitud: 10,
  estado: "programada" as const,
  starts_at: "2026-10-01T11:00:00.000Z",
  ends_at: "2026-10-01T12:00:00.000Z",
  cliente: { id: "client-1", nombre: "Cliente" },
  yacimiento: { id: "field-1", nombre: "Campo" },
  taller_movil: { id: "workshop-1", nombre: "Taller" },
  ordenes: { total: 2, pendientes: 1, evaluadas: 1, no_evaluadas: 0 },
}

const list = {
  items: [operation],
  total: 1,
  limit: 25,
  offset: 0,
  has_more: false,
}

const workOrder = {
  id: "work-order-1",
  visita_id: "visit-1",
  valvula_id: "valve-1",
  estado: "pendiente" as const,
}

const operationWorkOrder = {
  work_order: workOrder,
  valve: { id: "valve-1", equipo_id: "equipment-1", nombre: "V-10" },
  context: {
    yacimiento: { id: "field-1", cliente_cuenta_id: "client-1", nombre: "Campo" },
    planta: { id: "plant-1", yacimiento_id: "field-1", nombre: "Planta" },
    equipo: { id: "equipment-1", planta_id: "plant-1", nombre: "Equipo" },
  },
}

const detail = {
  operation,
  visit: { visit: { id: "visit-1" }, work_orders: [workOrder] },
  request: { request: { id: "request-1" }, selected_valves: [] },
  work_orders: [operationWorkOrder],
}

const client = (payload: unknown) => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
  return { edge: new EdgeAccessClient({ baseUrl: "https://example.test", request }), request }
}

describe("canonical operations contracts", () => {
  it.each(["solicitada", "programada", "aceptada", "en_curso", "completada", "cancelada"])(
    "accepts canonical status %s",
    (status) => {
      expect(operationStatusSchema.parse(status)).toBe(status)
      expect(operationSummarySchema.safeParse({ ...operation, estado: status }).success).toBe(true)
    },
  )

  it("validates the exact list and detail envelopes", () => {
    expect(operationListDtoSchema.parse(list)).toEqual(list)
    expect(operationDetailDtoSchema.parse(detail)).toEqual(detail)
  })

  it("rejects the flat projection and legacy operation fields", () => {
    expect(
      operationSummarySchema.safeParse({
        ...operation,
        empresa_id: "client-1",
        yacimiento_id: "field-1",
      }).success,
    ).toBe(false)
    expect(operationListDtoSchema.safeParse([operation]).success).toBe(false)
    expect(
      operationListDtoSchema.safeParse({ ...list, items: [{ ...operation, taller_id: null }] })
        .success,
    ).toBe(false)
  })

  it("keeps VisitDto orders flat but requires rich detail orders", () => {
    expect(
      operationDetailDtoSchema.safeParse({ ...detail, work_orders: [workOrder] }).success,
    ).toBe(false)
    expect(operationDetailDtoSchema.safeParse(detail).success).toBe(true)
  })

  it("rejects malformed list and detail responses", () => {
    expect(operationListDtoSchema.safeParse({ ...list, total: "1" }).success).toBe(false)
    expect(
      operationDetailDtoSchema.safeParse({
        ...detail,
        request: { request: { id: "request-1" } },
      }).success,
    ).toBe(false)
  })
})

describe("operations adapter", () => {
  it("serializes every supported filter with canonical query names", () => {
    expect(
      serializeOperationFilters({
        from: "2026-10-01",
        to: "2026-10-31",
        status: ["programada", "en_curso"],
        workshopId: "workshop-1",
        clientId: "client-1",
        q: " V-10 ",
        limit: 25,
        offset: 50,
      }).toString(),
    ).toBe(
      "from=2026-10-01&to=2026-10-31&status=programada%2Cen_curso&workshop_id=workshop-1&client_id=client-1&q=V-10&limit=25&offset=50",
    )
  })

  it("exposes only list and get", async () => {
    const { edge, request } = client(detail)
    const api = createOperationsApi(edge)

    expect(Object.keys(api)).toEqual(["list", "get"])
    await api.get("visit-1")
    expect(request).toHaveBeenCalledWith(
      "https://example.test/operations/visit-1",
      expect.anything(),
    )
  })

  it("validates list responses and forwards all filters", async () => {
    const { edge, request } = client(list)

    await expect(
      createOperationsApi(edge).list({
        from: "2026-10-01",
        to: "2026-10-31",
        status: ["programada", "en_curso"],
        workshopId: "workshop-1",
        clientId: "client-1",
        q: "  V-10  ",
        limit: 25,
        offset: 50,
      }),
    ).resolves.toEqual(list)

    expect(request).toHaveBeenCalledWith(
      "https://example.test/operations?from=2026-10-01&to=2026-10-31&status=programada%2Cen_curso&workshop_id=workshop-1&client_id=client-1&q=V-10&limit=25&offset=50",
      expect.anything(),
    )
  })

  it("rejects malformed successful responses at the Edge seam", async () => {
    const { edge } = client({ ...detail, operation: { ...operation, estado: "pendiente" } })

    await expect(createOperationsApi(edge).get("visit-1")).rejects.toMatchObject({
      code: "network",
    })
  })
})

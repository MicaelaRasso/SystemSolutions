import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { edgeApi } from "./index"
import { createCertificatesApi } from "./certificates"
import { createHierarchyApi } from "./hierarchy"
import { createOfflineApi } from "./offline"
import { createServiceRequestsApi } from "./service-requests"
import { createServiceWorkflowApi } from "./service-workflow"
import { createSignaturesApi } from "./signatures"
import { createValvesApi } from "./valves"
import { createVisitsApi } from "./visits"
import { createWorkOrdersApi } from "./work-orders"
import { createYacimientosApi } from "./yacimientos"

const client = (payload: unknown, request = vi.fn<typeof fetch>()) => {
  request.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
  return { edge: new EdgeAccessClient({ baseUrl: "https://example.test", request }), request }
}

describe("capability Edge clients", () => {
  it("registers focused modules as delegates of the existing typed APIs", async () => {
    const yacimientos = client([
      {
        id: "yac-1",
        cliente_cuenta_id: "client-1",
        nombre: "Norte",
      },
    ])
    await createYacimientosApi(yacimientos.edge).listYacimientos()

    const valves = client({
      valve: {
        id: "valve-1",
        equipo_id: "equipment-1",
        nombre: "V-10",
        marca: null,
        numero_serie: null,
        modelo: null,
        tipo: null,
        diametro_entrada: null,
        clase_entrada: null,
        diametro_salida: null,
        clase_salida: null,
        rosca: null,
        razon_disponibilidad: null,
      },
      revisions: [],
    })
    await createValvesApi(valves.edge).valve("valve-1")

    const requests = client([])
    await createServiceRequestsApi(requests.edge).listRequests()

    const visits = client([])
    await createVisitsApi(visits.edge).listVisits()

    const workOrders = client({ work_order: { id: "work-order-1" } })
    await createWorkOrdersApi(workOrders.edge).addWorkOrder("visit-1", "valve-1")

    const signatures = client({ signature_id: "signature-1", finalized_certificates: [] })
    await createSignaturesApi(signatures.edge).submitVisitSignature("visit-1", {
      party: "tecnico",
      signerName: "Ana",
      bucket: "signatures",
      objectPath: "visit-1/tecnico.png",
    })

    const offline = client({ visits: [] })
    await createOfflineApi(offline.edge).workingSet()

    expect(yacimientos.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/asset-access/yacimientos",
      expect.anything(),
    )
    expect(valves.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/asset-access/valves/valve-1",
      expect.anything(),
    )
    expect(requests.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/requests",
      expect.anything(),
    )
    expect(visits.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits",
      expect.anything(),
    )
    expect(workOrders.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits/visit-1/work-orders",
      expect.anything(),
    )
    expect(signatures.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/certificate-field/visits/visit-1/signatures",
      expect.anything(),
    )
    expect(offline.request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/offline-sync/offline/working-set",
      expect.anything(),
    )
  })

  it("keeps certificate history in certificates and never adds a Tarea route", async () => {
    const { edge, request } = client({ visit: { id: "visit-1" }, work_orders: [] })

    await createServiceWorkflowApi(edge).visit("visit-1")

    expect(createValvesApi(edge)).not.toHaveProperty("valveHistory")
    expect(createCertificatesApi(edge)).toHaveProperty("valveHistory")
    expect(Object.keys(edgeApi)).not.toContain("tarea")
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.test/functions/v1/service-workflow/visits/visit-1",
    ])
  })

  it("maps only the supported Yacimiento tree fields to the legacy view model", async () => {
    const { edge } = client({
      yacimiento: {
        id: "yac-1",
        cliente_cuenta_id: "client-1",
        nombre: "Norte",
        provincia: "Neuquén",
        operadora: "Op",
      },
      plantas: [{ id: "plant-1", yacimiento_id: "yac-1", nombre: "Planta A" }],
      equipos: [{ id: "equipment-1", planta_id: "plant-1", nombre: "EQ-1" }],
      valvulas: [{ id: "valve-1", equipo_id: "equipment-1", nombre: "V-10" }],
    })

    await expect(createHierarchyApi(edge).tree("yac-1")).resolves.toEqual({
      id: "yac-1",
      empresaId: "client-1",
      nombre: "Norte",
      provincia: "Neuquén",
      operadora: "Op",
      plantas: [
        {
          id: "plant-1",
          yacimientoId: "yac-1",
          nombre: "Planta A",
          equipos: [
            {
              id: "equipment-1",
              plantaId: "plant-1",
              nombre: "EQ-1",
              valvulas: [{ id: "valve-1", equipoId: "equipment-1", tag: "V-10", certificados: 0 }],
            },
          ],
        },
      ],
    })
  })

  it("fetches and parses a valve detail with its immutable revisions", async () => {
    const { edge, request } = client({
      valve: {
        id: "valve-1",
        equipo_id: "equipment-1",
        nombre: "V-10",
        marca: "Acme",
        numero_serie: "SN-10",
        modelo: null,
        tipo: "compuerta",
        diametro_entrada: "2 in",
        clase_entrada: "150",
        diametro_salida: "2 in",
        clase_salida: "150",
        rosca: null,
        razon_disponibilidad: null,
      },
      revisions: [
        { id: "revision-1", datos: { marca: "Acme" }, created_at: "2026-09-25T12:00:00Z" },
      ],
    })

    await expect(createHierarchyApi(edge).valve("valve-1")).resolves.toMatchObject({
      valve: { id: "valve-1", marca: "Acme", razon_disponibilidad: null },
      revisions: [{ id: "revision-1", datos: { marca: "Acme" } }],
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/asset-access/valves/valve-1",
      expect.objectContaining({ headers: expect.objectContaining({ apikey: "" }) }),
    )
  })

  it("serializes and parses a valve technical update", async () => {
    const response = {
      valve: {
        id: "valve-1",
        equipo_id: "equipment-1",
        nombre: "V-10",
        marca: null,
        numero_serie: null,
        modelo: null,
        tipo: null,
        diametro_entrada: null,
        clase_entrada: null,
        diametro_salida: null,
        clase_salida: null,
        rosca: null,
        razon_disponibilidad: "not_found",
      },
      revisions: [],
    }
    const { edge, request } = client(response)

    await expect(
      createHierarchyApi(edge).updateValve("valve-1", {
        name: "V-10",
        marca: null,
        numero_serie: null,
        modelo: null,
        tipo: null,
        diametro_entrada: null,
        clase_entrada: null,
        diametro_salida: null,
        clase_salida: null,
        rosca: null,
        razon_disponibilidad: "not_found",
      }),
    ).resolves.toEqual(response)
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/asset-access/valves/valve-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "V-10",
          marca: null,
          numero_serie: null,
          modelo: null,
          tipo: null,
          diametro_entrada: null,
          clase_entrada: null,
          diametro_salida: null,
          clase_salida: null,
          rosca: null,
          razon_disponibilidad: "not_found",
        }),
      }),
    )
  })

  it("serializes schedule commands at the service-workflow boundary", async () => {
    const { edge, request } = client({ visit: { id: "visit-1" }, work_orders: [] })

    await createServiceWorkflowApi(edge).schedule("request-1", {
      tallerMovilId: "workshop-1",
      startsAt: "2026-10-01T08:00:00Z",
      endsAt: "2026-10-01T12:00:00Z",
    })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/requests/request-1/schedule",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          taller_movil_id: "workshop-1",
          starts_at: "2026-10-01T08:00:00Z",
          ends_at: "2026-10-01T12:00:00Z",
        }),
      }),
    )
  })

  it("serializes offline operation names without exposing fetch to the PWA", async () => {
    const { edge, request } = client({
      visit_id: "visit-1",
      operations: [{ operation_id: "operation-1", estado: "sincronizada" }],
    })

    await createOfflineApi(edge).syncVisit("visit-1", {
      deviceId: "device-1",
      operations: [
        {
          operationId: "operation-1",
          kind: "complete_visit",
          payload: { completed_at: "2026-10-01T12:00:00Z" },
          schemaVersion: 1,
        },
      ],
    })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/offline-sync/visits/visit-1/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          device_id: "device-1",
          operations: [
            {
              operation_id: "operation-1",
              kind: "complete_visit",
              payload: { completed_at: "2026-10-01T12:00:00Z" },
              schema_version: 1,
            },
          ],
        }),
      }),
    )
  })
})

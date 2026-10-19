import { beforeEach, describe, expect, it, vi } from "vitest"

const { edgeApi } = vi.hoisted(() => ({
  edgeApi: {
    visits: { visit: vi.fn() },
    serviceRequests: {
      updateRequest: vi.fn(),
      createRequest: vi.fn(),
      createAdministrativeRequest: vi.fn(),
    },
    serviceWorkflow: {
      updateRequestMetadata: vi.fn(),
      schedule: vi.fn(),
      assignVisit: vi.fn(),
      unassignVisit: vi.fn(),
      reassignVisit: vi.fn(),
    },
    identity: { context: vi.fn() },
    operations: { get: vi.fn() },
  },
}))

vi.mock("@/lib/api", () => ({ edgeApi }))
vi.mock("@/lib/services", () => ({ services: {} }))

import { guardarSolicitudYVisita, type OperationRead } from "./queries"

describe("guardarSolicitudYVisita", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    edgeApi.visits.visit.mockResolvedValue({ visit: { solicitud_id: "request-1" } })
    edgeApi.serviceRequests.updateRequest.mockRejectedValue(
      new Error("Only the owning Cliente can edit a service request"),
    )
    edgeApi.serviceWorkflow.updateRequestMetadata.mockResolvedValue({})
    edgeApi.serviceWorkflow.schedule.mockResolvedValue({ visit: { id: "visit-1" } })
    edgeApi.operations.get.mockResolvedValue({ operation: { id: "visit-1" } })
  })

  it("lets an administrator edit an existing task schedule without editing Cliente-owned selection", async () => {
    const operation = {
      operation: {
        id: "visit-1",
        starts_at: "2026-10-20T11:00:00.000Z",
        ends_at: "2026-10-20T12:00:00.000Z",
        taller_movil: { id: "workshop-1" },
      },
    } as unknown as OperationRead

    await expect(
      guardarSolicitudYVisita(operation, {
        empresaId: "client-1",
        yacimientoId: "field-1",
        plantaId: "plant-1",
        equipoId: "equipment-1",
        tallerId: "workshop-1",
        contacto: "Contacto",
        telefono: "123",
        fechaSolicitud: "2026-10-19",
        fechaEjecucion: "2026-10-21",
        horario: "09:30",
        tipo: "Certificación",
        detalle: "Servicio",
        condiciones: [],
        adjuntos: [],
        estado: "asignada",
      }),
    ).resolves.toBeDefined()

    expect(edgeApi.serviceRequests.updateRequest).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.updateRequestMetadata).toHaveBeenCalledWith("request-1", expect.objectContaining({
      fecha_ejecucion: "2026-10-21",
      horario: "09:30",
    }))
    expect(edgeApi.serviceWorkflow.schedule).toHaveBeenCalledWith("request-1", {
      tallerMovilId: "workshop-1",
      startsAt: "2026-10-21T12:30:00.000Z",
      endsAt: "2026-10-21T13:30:00.000Z",
    })
  })
})

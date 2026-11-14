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
      rescheduleVisit: vi.fn(),
      createAdministrativeRequestWithVisit: vi.fn(),
    },
    identity: { context: vi.fn() },
    operations: { get: vi.fn() },
  },
}))

vi.mock("@/lib/api", () => ({ edgeApi }))
vi.mock("@/lib/services", () => ({ services: {} }))

import { INVALIDAR_TAREAS, consultaEmpresa, guardarSolicitudYVisita, type OperationRead } from "./queries"

function operacion(tallerId?: string): OperationRead {
  return {
    operation: {
      id: "visit-2",
      starts_at: "2026-10-20T11:00:00.000Z",
      ends_at: "2026-10-20T12:00:00.000Z",
      taller_movil: tallerId ? { id: tallerId } : null,
    },
  } as unknown as OperationRead
}

const DATOS = {
  empresaId: "client-1",
  yacimientoId: "field-1",
  plantaId: "plant-1",
  equipoId: "equipment-1",
  tallerId: "workshop-1",
  contacto: "Contacto",
  telefono: "123",
  fechaSolicitud: "2026-10-19",
  fechaEjecucion: "2026-10-20",
  horario: "08:00",
  tipo: "Certificación",
  detalle: "Servicio",
  condiciones: [],
  adjuntos: [],
  estado: "asignada" as const,
}

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
      fecha_solicitud: "2026-10-19",
      fecha_ejecucion: "2026-10-21",
      horario: "09:30",
    }))
    // Se reprograma la visita editada, no la primera visita programada de la solicitud.
    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.reassignVisit).toHaveBeenCalledWith("visit-1", {
      tallerMovilId: "workshop-1",
      reason: expect.stringMatching(/\S/),
      startsAt: "2026-10-21T12:30:00.000Z",
      endsAt: "2026-10-21T13:30:00.000Z",
    })
  })

  it("reprograma por su id una visita de seguimiento de una solicitud aceptada", async () => {
    await guardarSolicitudYVisita(operacion("workshop-1"), { ...DATOS, horario: "10:00" })

    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.reassignVisit).toHaveBeenCalledWith(
      "visit-2",
      expect.objectContaining({
        tallerMovilId: "workshop-1",
        startsAt: "2026-10-20T13:00:00.000Z",
        endsAt: "2026-10-20T14:00:00.000Z",
      }),
    )
    expect(edgeApi.operations.get).toHaveBeenCalledWith("visit-2")
  })

  it("al desasignar y cambiar la fecha reprograma la visita editada antes de desasignarla", async () => {
    await guardarSolicitudYVisita(
      operacion("workshop-1"),
      { ...DATOS, tallerId: undefined, fechaEjecucion: "2026-10-22" },
      "Sin disponibilidad",
    )

    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.reassignVisit).toHaveBeenCalledWith(
      "visit-2",
      expect.objectContaining({ tallerMovilId: "workshop-1", startsAt: "2026-10-22T11:00:00.000Z" }),
    )
    expect(edgeApi.serviceWorkflow.unassignVisit).toHaveBeenCalledWith("visit-2", {
      reason: "Sin disponibilidad",
    })
  })

  it("reprograma por su id una visita sin taller cuando cambia la fecha", async () => {
    await guardarSolicitudYVisita(operacion(), {
      ...DATOS,
      tallerId: undefined,
      fechaEjecucion: "2026-10-22",
    })

    expect(edgeApi.serviceWorkflow.rescheduleVisit).toHaveBeenCalledWith("visit-2", {
      reason: expect.stringMatching(/\S/),
      startsAt: "2026-10-22T11:00:00.000Z",
      endsAt: "2026-10-22T12:00:00.000Z",
    })
    expect(edgeApi.serviceWorkflow.assignVisit).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.reassignVisit).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
    expect(edgeApi.operations.get).toHaveBeenCalledWith("visit-2")
  })

  it("no reprograma una visita sin taller si la fecha y el horario no cambian", async () => {
    const operation = operacion()
    await expect(
      guardarSolicitudYVisita(operation, { ...DATOS, tallerId: undefined }),
    ).resolves.toBe(operation)
    expect(edgeApi.serviceWorkflow.rescheduleVisit).not.toHaveBeenCalled()
  })

  it("manda null al borrar el horario para que el merge de metadata no conserve el anterior", async () => {
    await guardarSolicitudYVisita(operacion("workshop-1"), { ...DATOS, horario: undefined })

    expect(edgeApi.serviceWorkflow.updateRequestMetadata).toHaveBeenCalledWith(
      "request-1",
      expect.objectContaining({ horario: null }),
    )
  })
})

describe("guardarSolicitudYVisita (alta)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    edgeApi.identity.context.mockResolvedValue({ rol: "administrador_regular" })
    edgeApi.operations.get.mockResolvedValue({ operation: { id: "visit-9" } })
  })

  it("crea la solicitud, su metadata y la visita en una sola operación atómica", async () => {
    edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit.mockResolvedValue({
      request: { id: "request-9" },
      selected_valves: [],
      scheduled_visit: { visit: { id: "visit-9" }, work_orders: [] },
    })

    await expect(guardarSolicitudYVisita(undefined, DATOS)).resolves.toEqual({
      operation: { id: "visit-9" },
    })

    expect(edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit).toHaveBeenCalledTimes(1)
    expect(edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit).toHaveBeenCalledWith({
      clientId: "client-1",
      yacimientoId: "field-1",
      selections: [{ kind: "equipo", id: "equipment-1" }],
      metadata: expect.objectContaining({
        contacto: "Contacto",
        fecha_solicitud: "2026-10-19",
        fecha_ejecucion: "2026-10-20",
        horario: "08:00",
      }),
      visit: {
        tallerMovilId: "workshop-1",
        startsAt: "2026-10-20T11:00:00.000Z",
        endsAt: "2026-10-20T12:00:00.000Z",
      },
    })
    // Sin llamadas sueltas que puedan dejar una solicitud huérfana o duplicarla al reintentar.
    expect(edgeApi.serviceRequests.createAdministrativeRequest).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.updateRequestMetadata).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
    expect(edgeApi.operations.get).toHaveBeenCalledWith("visit-9")
  })

  it("crea la solicitud sin visita cuando no se elige taller", async () => {
    edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit.mockResolvedValue({
      request: { id: "request-9" },
      selected_valves: [],
      scheduled_visit: null,
    })

    await expect(
      guardarSolicitudYVisita(undefined, { ...DATOS, tallerId: undefined }),
    ).resolves.toBeUndefined()

    expect(edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit).toHaveBeenCalledWith(
      expect.objectContaining({ visit: undefined }),
    )
    expect(edgeApi.operations.get).not.toHaveBeenCalled()
  })

  it("si falla el alta atómica no hace ninguna otra escritura", async () => {
    edgeApi.serviceWorkflow.createAdministrativeRequestWithVisit.mockRejectedValue(
      new Error("conflict"),
    )

    await expect(guardarSolicitudYVisita(undefined, DATOS)).rejects.toThrow("conflict")
    expect(edgeApi.serviceRequests.createAdministrativeRequest).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.updateRequestMetadata).not.toHaveBeenCalled()
    expect(edgeApi.serviceWorkflow.schedule).not.toHaveBeenCalled()
  })
})

describe("INVALIDAR_TAREAS", () => {
  it("incluye las consultas de service-workflow (solicitudes y visitas)", () => {
    expect(INVALIDAR_TAREAS).toContainEqual(["edge", "service-workflow"])
  })
})

describe("consultaEmpresa", () => {
  it("no consulta sin id: evita el GET clients/ (403) mientras carga la cuenta del Cliente", () => {
    expect(consultaEmpresa("").enabled).toBe(false)
    expect(consultaEmpresa("client-1").enabled).toBe(true)
  })
})

import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi } from "./service-workflow"

const client = (payload: unknown, request = vi.fn<typeof fetch>()) => {
  request.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
  return {
    api: createServiceWorkflowApi(
      new EdgeAccessClient({ baseUrl: "https://example.test", request }),
    ),
    request,
  }
}

const visit = {
  visit: { id: "visit-1", estado: "programada" },
  work_orders: [],
}

describe("service-workflow: alta atómica de solicitud y visita", () => {
  it("manda la solicitud, la metadata y la visita en un solo POST admin/requests", async () => {
    const response = {
      request: { id: "request-1" },
      selected_valves: [],
      scheduled_visit: visit,
    }
    const { api, request } = client(response)

    await expect(
      api.createAdministrativeRequestWithVisit({
        clientId: "client-1",
        yacimientoId: "yacimiento-1",
        selections: [{ kind: "equipo", id: "equipment-1" }],
        metadata: { contacto: "Ana", horario: null },
        visit: {
          tallerMovilId: "workshop-1",
          startsAt: "2026-10-20T11:00:00.000Z",
          endsAt: "2026-10-20T12:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({ request: { id: "request-1" }, scheduled_visit: visit })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/admin/requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          cliente_cuenta_id: "client-1",
          yacimiento_id: "yacimiento-1",
          selections: [{ kind: "equipo", id: "equipment-1" }],
          metadata: { contacto: "Ana", horario: null },
          taller_movil_id: "workshop-1",
          starts_at: "2026-10-20T11:00:00.000Z",
          ends_at: "2026-10-20T12:00:00.000Z",
        }),
      }),
    )
  })

  it("sin visita manda los campos de la visita en null y acepta scheduled_visit null", async () => {
    const { api, request } = client({
      request: { id: "request-1" },
      selected_valves: [],
      scheduled_visit: null,
    })

    await expect(
      api.createAdministrativeRequestWithVisit({
        clientId: "client-1",
        yacimientoId: "yacimiento-1",
        selections: [{ kind: "equipo", id: "equipment-1" }],
        metadata: {},
      }),
    ).resolves.toMatchObject({ scheduled_visit: null })
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      taller_movil_id: null,
      starts_at: null,
      ends_at: null,
    })
  })
})

describe("service-workflow: reprogramación de una visita", () => {
  it("manda la nueva ventana y el motivo a POST visits/:id/reschedule", async () => {
    const { api, request } = client({ visit: visit.visit })

    await api.rescheduleVisit("visit-1", {
      reason: "Cambio de fecha",
      startsAt: "2026-10-22T11:00:00.000Z",
      endsAt: "2026-10-22T12:00:00.000Z",
    })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits/visit-1/reschedule",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          starts_at: "2026-10-22T11:00:00.000Z",
          ends_at: "2026-10-22T12:00:00.000Z",
          reason: "Cambio de fecha",
        }),
      }),
    )
  })

  it("rechaza una ventana sin fechas antes de llamar a la Edge Function", async () => {
    const { api, request } = client({})

    await expect(
      api.rescheduleVisit("visit-1", { reason: "x", startsAt: "", endsAt: "" }),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})

describe("service-workflow: adjuntos de la visita", () => {
  it("P8: sirve los adjuntos firmados por el Storage local desde la URL pública de Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321")
    try {
      const adjunto = {
        id: "adj-1",
        nombre: "plano.pdf",
        tipo: "application/pdf",
        bucket: "attachments",
        object_path: "requests/r1/plano.pdf",
      }
      const { api } = client([
        { ...adjunto, url: "http://kong:8000/storage/v1/object/sign/attachments/requests/r1/plano.pdf?token=t" },
        { ...adjunto, id: "adj-2", url: "https://proyecto.supabase.co/storage/v1/object/sign/attachments/x.pdf?token=t" },
      ])

      const adjuntos = await api.visitAttachments("visit-1")

      expect(adjuntos.map((a) => a.url)).toEqual([
        "http://127.0.0.1:55321/storage/v1/object/sign/attachments/requests/r1/plano.pdf?token=t",
        "https://proyecto.supabase.co/storage/v1/object/sign/attachments/x.pdf?token=t",
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("service-workflow: válvulas agregadas en campo (A1)", () => {
  it("agrega una válvula existente con el id de orden generado en el dispositivo", async () => {
    const { api, request } = client({
      work_order: { id: "wo-1", valvula_id: "valve-1", valvula_nombre: "PSV-1" },
    })

    await expect(api.addWorkOrder("visit-1", "valve-1", "wo-1")).resolves.toMatchObject({
      work_order: { id: "wo-1", valvula_nombre: "PSV-1" },
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits/visit-1/work-orders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ valvula_id: "valve-1", work_order_id: "wo-1" }),
      }),
    )
  })

  it("sin id de orden mantiene el cuerpo anterior", async () => {
    const { api, request } = client({ work_order: { id: "wo-1" } })

    await api.addWorkOrder("visit-1", "valve-1")
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ valvula_id: "valve-1" }) }),
    )
  })
})

describe("service-workflow: alta de válvula en campo (A2)", () => {
  it("manda la válvula, el equipo existente y los ids del dispositivo a visits/:id/valves", async () => {
    const { api, request } = client({
      work_order: { id: "wo-1", valvula_id: "valve-1" },
      valvula: { id: "valve-1", equipo_id: "equipo-1", nombre: "PSV-9" },
    })

    await expect(
      api.createFieldValve("visit-1", {
        valvulaId: "valve-1",
        equipoId: "equipo-1",
        workOrderId: "wo-1",
        valvula: { nombre: "PSV-9", marca: "Crosby", presion_operacion: 12.5 },
      }),
    ).resolves.toMatchObject({ work_order: { id: "wo-1" }, valvula: { nombre: "PSV-9" } })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits/visit-1/valves",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          valvula_id: "valve-1",
          equipo_id: "equipo-1",
          work_order_id: "wo-1",
          valvula: { nombre: "PSV-9", marca: "Crosby", presion_operacion: 12.5 },
        }),
      }),
    )
  })

  it("rechaza una válvula sin TAG antes de llamar a la Edge Function", async () => {
    const { api, request } = client({})

    await expect(
      api.createFieldValve("visit-1", {
        valvulaId: "valve-1",
        equipoId: "equipo-1",
        workOrderId: "wo-1",
        valvula: { nombre: "  " },
      }),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})

describe("service-workflow: cierre administrativo de una visita vencida (E4)", () => {
  const closed = {
    visit: { id: "visit-1", estado: "completada", cierre_administrativo_motivo: "Sin firma" },
    work_orders: [],
    follow_up_visit_id: "visit-2",
    finalized_certificates: [],
    incomplete_certificate_ids: ["cert-1"],
    already_closed: false,
  }

  it("manda el motivo y la visita de seguimiento a POST visits/:id/close-administrator", async () => {
    const { api, request } = client(closed)

    await expect(
      api.closeVisitAsAdministrator("visit-1", {
        reason: " Sin firma ",
        tallerMovilId: "workshop-1",
        startsAt: "2026-11-20T11:00:00.000Z",
        endsAt: "2026-11-20T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      visit: { estado: "completada" },
      follow_up_visit_id: "visit-2",
      incomplete_certificate_ids: ["cert-1"],
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/visits/visit-1/close-administrator",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "Sin firma",
          taller_movil_id: "workshop-1",
          starts_at: "2026-11-20T11:00:00.000Z",
          ends_at: "2026-11-20T12:00:00.000Z",
        }),
      }),
    )
  })

  it("sin válvulas para seguimiento manda taller, inicio y fin en null", async () => {
    const { api, request } = client({ ...closed, follow_up_visit_id: null })

    await api.closeVisitAsAdministrator("visit-1", { reason: "Sin firma" })

    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          reason: "Sin firma",
          taller_movil_id: null,
          starts_at: null,
          ends_at: null,
        }),
      }),
    )
  })

  it("exige el motivo antes de llamar a la Edge Function", async () => {
    const { api, request } = client(closed)

    await expect(api.closeVisitAsAdministrator("visit-1", { reason: "  " })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})

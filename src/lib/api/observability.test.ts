import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createObservabilityApi } from "./observability"

describe("administrative audit capability", () => {
  it("requests the selected dashboard period and validates all five operational metrics", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      from: "2026-10-01",
      to: "2026-10-31",
      finalized_certificates: 1,
      completed_visits: 2,
      pending_certificates: 3,
      expiring_certificates: 4,
      unassigned_visits: 5,
    }), { status: 200 }))
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(createObservabilityApi(edge).metrics("2026-10-01", "2026-10-31")).resolves.toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      finalized_certificates: 1,
      completed_visits: 2,
      pending_certificates: 3,
      expiring_certificates: 4,
      unassigned_visits: 5,
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/admin/metrics?from=2026-10-01&to=2026-10-31",
      expect.any(Object),
    )
  })

  it("reads visit audit events through the service-workflow Edge route with the display contract", async () => {
    const event = {
      id: "audit-1",
      actor_cuenta_id: "admin-1",
      actor_email: "admin@example.test",
      actor_rol: "administrador_regular",
      accion: "visita_completada",
      tipo_objetivo: "visita_servicio",
      objetivo_id: "visit-1",
      resultado: "exitoso",
      recibida_en: "2026-10-05T15:00:00Z",
      evento_dispositivo_en: "2026-10-05T14:55:00Z",
      identidad_correlacion: "correlation-1",
      resumen_cambio: { estado_anterior: "en_curso", estado_nuevo: "completada" },
      identificadores_relacionados: { taller_movil_id: "workshop-1" },
    }
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [event], total: 1, limit: 100, offset: 0, has_more: false }),
        { status: 200 },
      ),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(createObservabilityApi(edge).audit.list({ visitId: "visit-1" })).resolves.toMatchObject({
      items: [
        {
          actor_cuenta_id: "admin-1",
          actor_email: "admin@example.test",
          accion: "visita_completada",
          tipo_objetivo: "visita_servicio",
          objetivo_id: "visit-1",
          resultado: "exitoso",
          recibida_en: "2026-10-05T15:00:00Z",
        },
      ],
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/audit?visit_id=visit-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "",
          "x-correlation-id": expect.any(String),
        }),
      }),
    )
  })

  it("sends every role-scoped audit filter and paging option to the Edge route", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 50, has_more: false }), { status: 200 }),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createObservabilityApi(edge).audit.list({
      from: "2026-10-01",
      to: "2026-10-31",
      actorId: "actor-1",
      action: "visita_completada",
      targetType: "visita_servicio",
      outcome: "fallido",
      clientId: "client-1",
      yacimientoId: "deposit-1",
      visitId: "visit-1",
      certificateId: "certificate-1",
      limit: 50,
      offset: 50,
    })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/audit?from=2026-10-01&to=2026-10-31&actor_id=actor-1&action=visita_completada&target_type=visita_servicio&outcome=fallido&client_id=client-1&yacimiento_id=deposit-1&visit_id=visit-1&certificate_id=certificate-1&limit=50&offset=50",
      expect.any(Object),
    )
  })

  it("exports the currently applied filters in the selected format", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200 }))
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createObservabilityApi(edge).audit.export({
      from: "2026-10-01",
      to: "2026-10-07",
      actorId: "actor-id",
      action: "visita_completada",
      targetType: "visita_servicio",
      outcome: "exitoso",
      clientId: "client-id",
      yacimientoId: "deposit-id",
      visitId: "visit-id",
      certificateId: "certificate-id",
    }, "csv")

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/audit/export?from=2026-10-01&to=2026-10-07&actor_id=actor-id&action=visita_completada&target_type=visita_servicio&outcome=exitoso&client_id=client-id&yacimiento_id=deposit-id&visit_id=visit-id&certificate_id=certificate-id&format=csv",
      expect.any(Object),
    )
  })
})

describe("administrative certificate history capability", () => {
  it("sends the complete history filter set through the administrative Edge route", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), { status: 200 }),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createObservabilityApi(edge).certificates.list({
      client_id: "client-1", yacimiento_id: "field-1", plant_id: "plant-1", valve_id: "valve-1",
      state: "pendiente", signature_state: "partial", valid_until: "2027-10-07", q: " válvula ", limit: 50, offset: 0,
    })

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/admin/certificates?client_id=client-1&yacimiento_id=field-1&plant_id=plant-1&valve_id=valve-1&state=pendiente&signature_state=partial&valid_until=2027-10-07&q=+v%C3%A1lvula+&limit=50&offset=0",
      expect.any(Object),
    )
  })

  it("uses the administrative download capability for any persisted certificate state", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }))
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createObservabilityApi(edge).certificates.download("certificate-1")

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/service-workflow/admin/certificates/certificate-1/download",
      expect.any(Object),
    )
  })
})

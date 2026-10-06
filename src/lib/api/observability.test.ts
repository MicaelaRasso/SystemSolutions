import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createObservabilityApi } from "./observability"

describe("administrative audit capability", () => {
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
})

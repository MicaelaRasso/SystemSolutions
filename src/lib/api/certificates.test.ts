import { describe, expect, it, vi } from "vitest"

import type { EdgeAccessClient } from "../services/edge"
import { visitSignatureDtoSchema } from "./contracts"
import { createCertificatesApi } from "./certificates"

const sourceId = "11111111-1111-4111-8111-111111116314"
const providerId = "22222222-2222-4222-8222-222222226305"

describe("certificate correction API", () => {
  it("sends a reason and a new visit window to the authorization command", async () => {
    const request = vi.fn().mockResolvedValue({ correction_id: sourceId })
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    await api.authorizeCorrection(sourceId, {
      providerId,
      startsAt: "2099-03-10T09:00:00Z",
      endsAt: "2099-03-10T10:00:00Z",
      reason: "  Recalibración  ",
    })

    expect(request).toHaveBeenCalledWith(
      `certificates/${sourceId}/corrections`,
      expect.anything(),
      {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          starts_at: "2099-03-10T09:00:00Z",
          ends_at: "2099-03-10T10:00:00Z",
          reason: "Recalibración",
        }),
      },
    )
  })

  it("rejects a reversed visit window before calling Edge", async () => {
    const request = vi.fn()
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    expect(() => api.authorizeCorrection(sourceId, {
      providerId,
      startsAt: "2099-03-10T10:00:00Z",
      endsAt: "2099-03-10T09:00:00Z",
      reason: "Recalibración",
    })).toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})

describe("valve certificate history contract", () => {
  it("accepts `is_current: null` for a certificate pending the Cliente signature (D6)", async () => {
    const { valveCertificateHistoryDtoSchema } = await import("./contracts")
    const parsed = valveCertificateHistoryDtoSchema.safeParse({
      current_certificate_id: null,
      certificates: [
        {
          certificate: { id: sourceId, estado: "pendiente" },
          status: "pendiente",
          is_current: null,
          validity: null,
        },
      ],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.certificates[0].is_current).toBe(false)
  })
})

describe("historial de varias Válvulas en un pedido", () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`)

  it("pide los historiales en lotes de 100 y junta las respuestas", async () => {
    const request = vi.fn(async (_path: string, _schema: unknown, init: { body: string }) => {
      const { valve_ids } = JSON.parse(init.body) as { valve_ids: string[] }
      return {
        histories: valve_ids.map((id) => ({ valve_id: id, current_certificate_id: null, certificates: [] })),
        failed_valve_ids: [],
      }
    })
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    const resultado = await api.valveHistories(ids(150))

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "certificates/valve-histories",
      "certificates/valve-histories",
    ])
    expect(request.mock.calls.map((call) => JSON.parse(call[2].body).valve_ids.length)).toEqual([100, 50])
    expect(resultado.histories.map((h) => h.valve_id)).toEqual(ids(150))
  })

  it("sin la ruta nueva en el servidor (404) vuelve a pedir Válvula por Válvula", async () => {
    const { ServiceError } = await import("../services/contracts")
    const [a, b] = ids(2)
    const request = vi.fn(async (path: string) => {
      if (path === "certificates/valve-histories") throw new ServiceError("Route not found", "not_found")
      if (path === `valves/${b}/certificates`) throw new ServiceError("Sin acceso", "unauthorized")
      return { current_certificate_id: null, certificates: [] }
    })
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    await expect(api.valveHistories([a, b])).resolves.toEqual({
      histories: [{ valve_id: a, current_certificate_id: null, certificates: [] }],
      failed_valve_ids: [b],
    })
  })

  it("no pide nada si no hay Válvulas", async () => {
    const request = vi.fn()
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    await expect(api.valveHistories([])).resolves.toEqual({ histories: [], failed_valve_ids: [] })
    expect(request).not.toHaveBeenCalled()
  })
})

describe("firma de una visita en «Requiere finalización» (E4)", () => {
  it("informa si la firma completó la visita vencida", () => {
    expect(
      visitSignatureDtoSchema.parse({
        signature_id: "signature-1",
        finalized_certificates: [],
        visit_completed: true,
      }).visit_completed,
    ).toBe(true)
    expect(
      visitSignatureDtoSchema.parse({ signature_id: "signature-1", finalized_certificates: [] })
        .visit_completed,
    ).toBeUndefined()
  })
})

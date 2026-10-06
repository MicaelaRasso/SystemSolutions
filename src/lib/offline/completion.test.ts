import { describe, expect, it } from "vitest"

import { visitCompletionBlocker } from "./completion"

const workOrder = (id: string, estado: string, certificate_id?: string | null) => ({
  id,
  estado,
  certificate_id,
})

const operation = (input: {
  operationId: string
  kind: string
  payload: Record<string, unknown>
  createdAt?: string
}) => ({
  operationId: input.operationId,
  kind: input.kind,
  payload: input.payload,
  createdAt: input.createdAt ?? "2026-10-06T12:00:00.000Z",
  estado: "guardada_local",
})

const completeCertificate = {
  fecha_ejecucion: "2026-10-06",
  tecnico_ejecutor: "Técnico A",
  datos_tecnicos: {
    ensayos: {
      sp_inicial: { valor: 1, unidad: "bar" },
      sp_apertura: { valor: 2, unidad: "bar" },
      presion_cierre: { valor: 3, unidad: "bar" },
      patron: { id: "pattern-1" },
    },
  },
  campos_personalizados: { resultado: "ok" },
}

describe("offline visit completion preflight", () => {
  it("requires an explicit outcome for every work order", () => {
    expect(visitCompletionBlocker([workOrder("order-2", "pendiente"), workOrder("order-1", "evaluada", "cert-1")], []))
      .toContain("Todas las Órdenes de trabajo")
  })

  it("uses the latest queued outcome when working offline", () => {
    expect(visitCompletionBlocker(
      [workOrder("order-1", "pendiente")],
      [operation({
        operationId: "outcome-1",
        kind: "work_order_outcome",
        payload: { work_order_id: "order-1", outcome: "evaluada" },
      })],
    )).toContain("Borrador de certificado")
  })

  it("accepts evaluated work with a complete queued certificate and unevaluated work without a certificate", () => {
    expect(visitCompletionBlocker(
      [workOrder("order-1", "pendiente"), workOrder("order-2", "no_evaluada")],
      [
        operation({
          operationId: "outcome-1",
          kind: "work_order_outcome",
          payload: { work_order_id: "order-1", outcome: "evaluada" },
        }),
        operation({
          operationId: "draft-1",
          kind: "start_certificate_draft",
          payload: {
            work_order_id: "order-1",
            certificate_id: "cert-1",
            template_snapshot: { campos: [{ clave: "resultado", obligatorio: true }] },
          },
        }),
        operation({
          operationId: "update-1",
          kind: "update_certificate_draft",
          payload: { certificate_id: "cert-1", data: completeCertificate },
        }),
      ],
    )).toBeUndefined()
  })

  it("rejects a certificate draft attached to an unevaluated order", () => {
    expect(visitCompletionBlocker(
      [workOrder("order-1", "no_evaluada")],
      [operation({
        operationId: "draft-1",
        kind: "start_certificate_draft",
        payload: { work_order_id: "order-1", certificate_id: "cert-1" },
      })],
    )).toContain("no evaluada")
  })

  it("blocks a draft that exists but has incomplete certificate data", () => {
    expect(visitCompletionBlocker(
      [workOrder("order-1", "evaluada", "cert-1")],
      [operation({
        operationId: "update-1",
        kind: "update_certificate_draft",
        payload: { certificate_id: "cert-1", data: { fecha_ejecucion: "2026-10-06" } },
      })],
    )).toContain("Completá y guardá")
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { useCertificate } = vi.hoisted(() => ({ useCertificate: vi.fn() }))
vi.mock("@/lib/api/hooks", () => ({ useEdgeAdminCertificate: (...args: unknown[]) => useCertificate(...args) }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "current-id" }) }))

import Page from "./page"

const render = () => renderToStaticMarkup(createElement(Page))

describe("administrative certificate detail screen", () => {
  beforeEach(() => useCertificate.mockReset())

  it("renders loading, error, and missing-record states", () => {
    useCertificate.mockReturnValue({ isLoading: true, isError: false })
    expect(render()).toContain("animate-pulse")
    useCertificate.mockReturnValue({ isLoading: false, isError: true, error: new Error("offline") })
    expect(render()).toContain("offline")
    useCertificate.mockReturnValue({ isLoading: false, isError: false, data: undefined })
    expect(render()).toContain("Certificado no encontrado")
  })

  it("shows earlier and later same-Válvula records, audit events, and the administrative download", () => {
    useCertificate.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        certificate: { id: "current-id", estado: "pendiente", fecha_ejecucion: "2026-10-01", numero: null },
        history: [
          { id: "older-id", estado: "finalizado", fecha_ejecucion: "2025-10-01", numero: 10 },
          { id: "current-id", estado: "pendiente", fecha_ejecucion: "2026-10-01", numero: null },
        ],
        audit_events: [{
          id: "event-id", accion: "firma_visita_registrada", resultado: "exitoso", recibida_en: "2026-10-01T10:00:00Z",
          actor_cuenta_id: "actor-id", identidad_correlacion: "corr-1", resumen_cambio: { parte: "cliente" }, identificadores_relacionados: { visita_id: "visit-id" },
        }],
      },
    })
    const html = render()
    expect(html).toContain("Descargar Certificado")
    expect(html).toContain("Historial de la Válvula")
    expect(html).toContain("finalizado")
    expect(html).toContain("pendiente")
    expect(html).toContain("/admin/certificados/older-id")
    expect(html).toContain("firma_visita_registrada")
    expect(html).not.toContain("Correcciones")
  })

  it("renders an explicit empty state when the certificate has no related audit events", () => {
    useCertificate.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { certificate: { id: "current-id" }, history: [], audit_events: [] },
    })
    expect(render()).toContain("No hay eventos relacionados")
  })
})

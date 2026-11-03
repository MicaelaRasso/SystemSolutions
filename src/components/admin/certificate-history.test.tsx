import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { useCertificates } = vi.hoisted(() => ({ useCertificates: vi.fn() }))
vi.mock("@/lib/api/hooks", () => ({
  useEdgeAdminCertificates: (...args: unknown[]) => useCertificates(...args),
}))

import { CertificateHistory } from "./certificate-history"

const render = () => renderToStaticMarkup(createElement(CertificateHistory))

describe("administrative certificate history screen", () => {
  beforeEach(() => useCertificates.mockReset())

  it("shows loading and error states", () => {
    useCertificates.mockReturnValue({ isLoading: true, isError: false })
    expect(render()).toContain("animate-pulse")

    useCertificates.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("offline"),
    })
    expect(render()).toContain("offline")
  })

  it("shows the empty state and every required filter including Parte Diario (PD)", () => {
    useCertificates.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], total: 0, limit: 50, offset: 0 },
    })
    const html = render()
    expect(html).toContain("No hay certificados")
    expect(html).toContain("Cliente (ID de Cuenta)")
    expect(html).toContain("Yacimiento (ID)")
    expect(html).toContain("Planta/locación (ID)")
    expect(html).toContain("Válvula (ID)")
    expect(html).toContain("Parte Diario (PD)")
    expect(html).toContain("Estado de firma")
    expect(html).toContain("Vigencia del certificado hasta")
  })

  it("renders pending records alongside finalized records with Parte Diario, detail and download actions", () => {
    useCertificates.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [
          {
            id: "pending-id",
            estado: "pendiente",
            pd: "PD1234",
            signature_state: "partial",
            valvula_nombre: "V-1",
            yacimiento_nombre: "Y-1",
            created_at: "2026-10-01",
          },
          {
            id: "final-id",
            estado: "finalizado",
            pd: "PD5678",
            signature_state: "complete",
            valvula_nombre: "V-1",
            yacimiento_nombre: "Y-1",
            created_at: "2026-09-01",
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      },
    })
    const html = render()
    expect(html).toContain("pendiente")
    expect(html).toContain("finalizado")
    expect(html).toContain("PD1234")
    expect(html).toContain("PD5678")
    expect(html).toContain("Una")
    expect(html).toContain("Ambas")
    expect(html).toContain("/admin/certificados/pending-id")
    expect(html).toContain("Descargar")
  })
})

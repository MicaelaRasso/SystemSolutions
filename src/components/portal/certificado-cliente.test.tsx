import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ServiceError } from "@/lib/services/contracts"

const { useHistory, useExport } = vi.hoisted(() => ({ useHistory: vi.fn(), useExport: vi.fn() }))
vi.mock("@/lib/api/hooks", () => ({
  useEdgeValveCertificateHistory: (...args: unknown[]) => useHistory(...args),
  useEdgeClientCertificateExport: (...args: unknown[]) => useExport(...args),
}))

import { CertificadoCliente } from "./certificado-cliente"

const render = () =>
  renderToStaticMarkup(
    createElement(CertificadoCliente, { certificadoId: "c-1", valvulaId: "v-1" }),
  )

const historial = (entrada: Record<string, unknown>) => ({
  isLoading: false,
  isError: false,
  data: { certificates: [{ certificate: { id: "c-1" }, ...entrada }] },
})

const sinExportacion = { isLoading: false, isError: false, data: undefined }

describe("certificado en el portal del cliente", () => {
  beforeEach(() => {
    useHistory.mockReset()
    useExport.mockReset()
  })

  it("previsualiza un pendiente con la leyenda y sin descarga", () => {
    useHistory.mockReturnValue(
      historial({
        certificate: { id: "c-1", estado: "pendiente" },
        status: "pendiente",
        validity: null,
      }),
    )
    useExport.mockReturnValue(sinExportacion)
    const html = render()
    expect(useExport).toHaveBeenCalledWith(undefined)
    expect(html).toContain("REQUIERE FIRMA")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Descargar PDF/)
    expect(html).toContain("Faltan firmas")
  })

  it("habilita la descarga de un certificado firmado y vigente", () => {
    useHistory.mockReturnValue(
      historial({
        certificate: { id: "c-1", estado: "finalizado" },
        status: "vigente",
        validity: { valid_until: "2999-01-01", is_valid: true },
      }),
    )
    useExport.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        certificate: { id: "c-1", estado: "finalizado", numero: 3, fecha_ejecucion: "2026-02-04" },
        snapshot: {},
        signatures: [
          { parte: "tecnico", nombre_firmante: "Técnico Demo" },
          { parte: "cliente", nombre_firmante: "Cliente Demo" },
        ],
        images: [],
        validity: { valid_until: "2999-01-01" },
      },
    })
    const html = render()
    expect(useExport).toHaveBeenCalledWith("c-1")
    expect(html).not.toContain("REQUIERE FIRMA")
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Descargar PDF/)
    expect(html).toContain("26-02-0003")
  })

  it("trata la exportación rechazada como firma pendiente", () => {
    useHistory.mockReturnValue(
      historial({
        certificate: { id: "c-1", estado: "finalizado" },
        status: "vigente",
        validity: { valid_until: "2999-01-01" },
      }),
    )
    useExport.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new ServiceError("no", "not_found"),
    })
    expect(render()).toContain("REQUIERE FIRMA")
  })

  it("no muestra un certificado vencido", () => {
    useHistory.mockReturnValue(
      historial({
        certificate: { id: "c-1", estado: "finalizado" },
        status: "historico",
        validity: { valid_until: "2020-01-01", is_valid: false },
      }),
    )
    useExport.mockReturnValue(sinExportacion)
    const html = render()
    expect(html).toContain("vencido")
    expect(html).not.toContain("1.0 UBICACIÓN")
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { useYacimientosMock, useQueriesMock } = vi.hoisted(() => ({
  useYacimientosMock: vi.fn(),
  useQueriesMock: vi.fn(),
}))

vi.mock("@/lib/api/hooks", () => ({
  useEdgeYacimientos: () => useYacimientosMock(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQueries: (args: unknown) => useQueriesMock(args),
}))

import { CertificadosCliente } from "./certificados-cliente"

describe("CertificadosCliente component", () => {
  beforeEach(() => {
    useYacimientosMock.mockReset()
    useQueriesMock.mockReset()
  })

  it("renders loading state when yacimientos is pending", () => {
    useYacimientosMock.mockReturnValue({ isPending: true, data: undefined })
    useQueriesMock.mockReturnValue([])

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    expect(html).toContain("Cargando certificados")
  })

  it("renders empty state when there are no valves or certificates", () => {
    useYacimientosMock.mockReturnValue({ isPending: false, data: [] })
    useQueriesMock.mockReturnValue([])

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    expect(html).toContain("Sin certificados")
  })

  it("excludes draft (borrador) certificates from client portal view", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [{ id: "y-1", nombre: "Yacimiento 1" }],
    })

    const arbolMock = {
      data: {
        id: "y-1",
        nombre: "Yacimiento 1",
        plantas: [
          {
            id: "p-1",
            nombre: "Planta 1",
            equipos: [
              {
                id: "e-1",
                nombre: "Equipo 1",
                valvulas: [{ id: "v-1", tag: "PSV-527" }],
              },
            ],
          },
        ],
      },
      isPending: false,
      error: null,
    }

    const historyMock = {
      data: {
        current_certificate_id: null,
        certificates: [
          {
            certificate: {
              id: "7e9db1fa-00f1-4eb4-87d6-c80bcdce2815",
              estado: "borrador",
              fecha_ejecucion: null,
              numero: null,
              pd: null,
            },
            status: "historico",
            is_current: false,
            validity: null,
          },
        ],
      },
      isPending: false,
      error: null,
    }

    useQueriesMock
      .mockReturnValueOnce([arbolMock]) // first call for arboles
      .mockReturnValueOnce([historyMock]) // second call for historiales

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    expect(html).toContain("Sin certificados")
  })

  it("displays finalized and pending certificates with formatted number and PD", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [{ id: "y-1", nombre: "Yacimiento 1" }],
    })

    const arbolMock = {
      data: {
        id: "y-1",
        nombre: "Yacimiento 1",
        plantas: [
          {
            id: "p-1",
            nombre: "Planta 1",
            equipos: [
              {
                id: "e-1",
                nombre: "Equipo 1",
                valvulas: [{ id: "v-1", tag: "PSV-527" }],
              },
            ],
          },
        ],
      },
      isPending: false,
      error: null,
    }

    const historyMock = {
      data: {
        current_certificate_id: "c-1",
        certificates: [
          {
            certificate: {
              id: "c-1",
              estado: "finalizado",
              fecha_ejecucion: "2026-11-03",
              numero: 14,
              pd: "PD-999",
            },
            status: "vigente",
            is_current: true,
            validity: {
              execution_date: "2026-11-03",
              valid_until: "2027-11-03",
              is_valid: true,
            },
          },
        ],
      },
      isPending: false,
      error: null,
    }

    useQueriesMock
      .mockReturnValueOnce([arbolMock])
      .mockReturnValueOnce([historyMock])

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    expect(html).toContain("PSV-527")
    expect(html).toContain("PD-999")
    expect(html).toContain("26-11-0014")
    expect(html).toContain("Ver certificado")
  })

  it("safely handles misaligned valvulas and historiales without crashing", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [{ id: "y-1", nombre: "Yacimiento 1" }],
    })

    const arbolMock = {
      data: {
        id: "y-1",
        nombre: "Yacimiento 1",
        plantas: [],
      },
      isPending: false,
      error: null,
    }

    const historyMock = {
      data: {
        certificates: [
          {
            certificate: { id: "c-1", estado: "finalizado", numero: 1, fecha_ejecucion: "2026-11-03" },
          },
        ],
      },
      isPending: false,
      error: null,
    }

    useQueriesMock
      .mockReturnValueOnce([arbolMock])
      .mockReturnValueOnce([historyMock])

    // Should not throw!
    expect(() => {
      renderToStaticMarkup(createElement(CertificadosCliente))
    }).not.toThrow()
  })

  it("does not block entire view if a single valve query fails", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [{ id: "y-1", nombre: "Yacimiento 1" }],
    })

    const arbolMock = {
      data: {
        id: "y-1",
        nombre: "Yacimiento 1",
        plantas: [
          {
            id: "p-1",
            nombre: "Planta 1",
            equipos: [
              {
                id: "e-1",
                nombre: "Equipo 1",
                valvulas: [
                  { id: "v-1", tag: "PSV-1" },
                  { id: "v-2", tag: "PSV-2" },
                ],
              },
            ],
          },
        ],
      },
      isPending: false,
      error: null,
    }

    const historyMock1 = {
      data: null,
      isPending: false,
      error: new Error("Failed to fetch valve history"),
      isError: true,
    }

    const historyMock2 = {
      data: {
        certificates: [
          {
            certificate: {
              id: "c-2",
              estado: "finalizado",
              fecha_ejecucion: "2026-11-03",
              numero: 20,
              pd: "PD-200",
            },
            status: "vigente",
            is_current: true,
            validity: { is_valid: true },
          },
        ],
      },
      isPending: false,
      error: null,
      isError: false,
    }

    useQueriesMock
      .mockReturnValueOnce([arbolMock])
      .mockReturnValueOnce([historyMock1, historyMock2])

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    // PSV-2's certificate should still be rendered, NOT an error state screen
    expect(html).toContain("PSV-2")
    expect(html).toContain("PD-200")
    expect(html).not.toContain("Ocurrió un error")
  })
})

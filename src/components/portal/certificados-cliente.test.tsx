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

/** El historial llega en lote: un resultado con el historial de cada Válvula. */
const enLote = (valveId: string, mock: { data: Record<string, unknown> | null }) => ({
  ...mock,
  data: mock.data ? { histories: [{ valve_id: valveId, ...mock.data }], failed_valve_ids: [] } : null,
})

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
      .mockReturnValueOnce([enLote("v-1", historyMock)]) // second call for historiales

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
      .mockReturnValueOnce([enLote("v-1", historyMock)])

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
      .mockReturnValueOnce([enLote("v-desconocida", historyMock)])

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
      .mockReturnValueOnce([
        {
          data: {
            histories: [{ valve_id: "v-2", ...historyMock2.data }],
            failed_valve_ids: ["v-1"],
          },
          isPending: false,
          error: null,
        },
      ])

    const html = renderToStaticMarkup(createElement(CertificadosCliente))
    // PSV-2's certificate should still be rendered, NOT an error state screen
    expect(html).toContain("PSV-2")
    expect(html).toContain("PD-200")
    expect(html).not.toContain("Ocurrió un error")
  })

  it("pide el historial de todas las Válvulas en un solo lote, no uno por Válvula", () => {
    useYacimientosMock.mockReturnValue({ isPending: false, data: [{ id: "y-1", nombre: "Y" }] })
    const valvulas = Array.from({ length: 30 }, (_, i) => ({ id: `v-${i}`, tag: `PSV-${i}` }))
    useQueriesMock
      .mockReturnValueOnce([
        {
          data: {
            id: "y-1",
            nombre: "Y",
            plantas: [{ id: "p", nombre: "P", equipos: [{ id: "e", nombre: "E", valvulas }] }],
          },
          isPending: false,
          error: null,
        },
      ])
      .mockReturnValueOnce([{ data: undefined, isPending: true, error: null }])

    renderToStaticMarkup(createElement(CertificadosCliente))

    const { queries } = useQueriesMock.mock.calls[1][0] as { queries: { queryKey: unknown[] }[] }
    expect(queries).toHaveLength(1)
    expect(queries[0].queryKey).toEqual(expect.arrayContaining(["valve-histories", "v-0", "v-29"]))
  })
  it("P8: con varios yacimientos espera todos los árboles y pide el lote una sola vez", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [
        { id: "y-1", nombre: "Campo Sur" },
        { id: "y-2", nombre: "Loma Alta" },
      ],
    })
    const arbol = (id: string, valvula: string) => ({
      data: {
        id,
        nombre: id,
        plantas: [{ id: `p-${id}`, nombre: "P", equipos: [{ id: `e-${id}`, nombre: "E", valvulas: [{ id: valvula, tag: valvula }] }] }],
      },
      isPending: false,
      error: null,
    })
    const pendiente = { data: undefined, isPending: true, error: null }

    // Primer render: llegó un solo árbol. Todavía no se pide ningún lote (antes salía uno parcial).
    useQueriesMock.mockReturnValueOnce([arbol("y-1", "v-1"), pendiente]).mockReturnValueOnce([])
    renderToStaticMarkup(createElement(CertificadosCliente))
    const primero = useQueriesMock.mock.calls[1][0] as { queries: { queryKey: unknown[] }[] }
    expect(primero.queries).toHaveLength(0)

    // Con los dos árboles: un único lote con las Válvulas de ambos yacimientos.
    useQueriesMock.mockReturnValueOnce([arbol("y-1", "v-1"), arbol("y-2", "v-2")]).mockReturnValueOnce([pendiente])
    renderToStaticMarkup(createElement(CertificadosCliente))
    const segundo = useQueriesMock.mock.calls[3][0] as { queries: { queryKey: unknown[] }[] }
    expect(segundo.queries).toHaveLength(1)
    expect(segundo.queries[0].queryKey).toEqual(expect.arrayContaining(["valve-histories", "v-1", "v-2"]))
  })

  it("P8: un árbol que falla no impide pedir el lote de los demás", () => {
    useYacimientosMock.mockReturnValue({
      isPending: false,
      data: [
        { id: "y-1", nombre: "Campo Sur" },
        { id: "y-2", nombre: "Loma Alta" },
      ],
    })
    useQueriesMock
      .mockReturnValueOnce([
        {
          data: { id: "y-1", nombre: "y-1", plantas: [{ id: "p", nombre: "P", equipos: [{ id: "e", nombre: "E", valvulas: [{ id: "v-1", tag: "v-1" }] }] }] },
          isPending: false,
          error: null,
        },
        { data: undefined, isPending: false, isError: true, error: new Error("403") },
      ])
      .mockReturnValueOnce([{ data: undefined, isPending: true, error: null }])
    renderToStaticMarkup(createElement(CertificadosCliente))
    const { queries } = useQueriesMock.mock.calls[1][0] as { queries: { queryKey: unknown[] }[] }
    expect(queries).toHaveLength(1)
  })
})

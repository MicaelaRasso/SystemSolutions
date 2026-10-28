import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { VisitaCliente } from "./visitas-cliente"

const { useVisitas } = vi.hoisted(() => ({ useVisitas: vi.fn() }))
vi.mock("./use-visitas-cliente", () => ({ useVisitasCliente: () => useVisitas() }))

import { TurnosCliente } from "./turnos-cliente"

const base: VisitaCliente = {
  id: "v-1",
  fecha: "2026-10-20",
  horario: "08:00–12:30",
  inicio: "2026-10-20T11:00:00Z",
  yacimientoId: "y-1",
  yacimiento: "Yacimiento Norte",
  ubicaciones: ["Planta A · K-100"],
  plantaIds: ["p-1"],
  estado: "programada",
  valvulas: 2,
}

const arboles = [
  {
    id: "y-1",
    nombre: "Yacimiento Norte",
    plantas: [{ id: "p-1", nombre: "Planta A", equipos: [] }],
  },
]
const render = () => renderToStaticMarkup(createElement(TurnosCliente))

describe("turnos del cliente (RF-35)", () => {
  beforeEach(() => useVisitas.mockReset())

  it("separa pendientes e histórico con sus cantidades y no permite solicitar turnos", () => {
    useVisitas.mockReturnValue({
      visitas: [
        base,
        {
          ...base,
          id: "v-2",
          estado: "completada",
          fecha: "2026-09-01",
          inicio: "2026-09-01T11:00:00Z",
        },
      ],
      arboles,
      cargando: false,
      error: null,
      reintentar: vi.fn(),
    })
    const html = render()
    expect(html).toMatch(/Pendientes[^<]*<[^>]*>1</)
    expect(html).toMatch(/Histórico[^<]*<[^>]*>1</)
    expect(html).toContain("Yacimiento Norte")
    expect(html).toContain("Planta A · K-100")
    expect(html).toContain("Desde")
    expect(html).toContain("Hasta")
    expect(html).not.toMatch(/Solicitar|Nuevo turno/)
  })

  it("explica que no hay turnos pendientes", () => {
    useVisitas.mockReturnValue({
      visitas: [],
      arboles,
      cargando: false,
      error: null,
      reintentar: vi.fn(),
    })
    expect(render()).toContain("No hay turnos pendientes")
  })

  it("muestra el error con opción de reintentar", () => {
    useVisitas.mockReturnValue({
      visitas: [],
      arboles: [],
      cargando: false,
      error: new Error("offline"),
      reintentar: vi.fn(),
    })
    expect(render()).toContain("offline")
  })
})

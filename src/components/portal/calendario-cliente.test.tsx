import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { VisitaCliente } from "./visitas-cliente"

const { useVisitas } = vi.hoisted(() => ({ useVisitas: vi.fn() }))
vi.mock("./use-visitas-cliente", () => ({ useVisitasCliente: () => useVisitas() }))

import { CalendarioCliente } from "./calendario-cliente"

const hoy = new Intl.DateTimeFormat("en-CA").format(new Date())
const visita: VisitaCliente = {
  id: "v-1",
  fecha: hoy,
  horario: "08:00–12:30",
  inicio: `${hoy}T11:00:00Z`,
  yacimientoId: "y-1",
  yacimiento: "Yacimiento Norte",
  ubicaciones: ["Planta A · K-100"],
  plantaIds: ["p-1"],
  tallerAsignado: false,
  estado: "programada",
  valvulas: 2,
}

const render = () => renderToStaticMarkup(createElement(CalendarioCliente))

describe("calendario del cliente", () => {
  beforeEach(() => useVisitas.mockReset())

  it("muestra las visitas del día con horario, locación y estado, sin pedir turnos", () => {
    useVisitas.mockReturnValue({
      visitas: [visita],
      cargando: false,
      error: null,
      reintentar: vi.fn(),
    })
    const html = render()
    expect(html).toContain("08:00–12:30")
    expect(html).toContain("Planta A · K-100")
    expect(html).toContain("Programada")
    expect(html).toContain("A confirmar")
    expect(html).toContain("Agenda del mes")
    expect(html).not.toMatch(/Solicitar|Nuevo turno|Nueva visita/)
  })

  it("explica el calendario vacío y los errores", () => {
    useVisitas.mockReturnValue({ visitas: [], cargando: false, error: null, reintentar: vi.fn() })
    expect(render()).toContain("Todavía no hay visitas registradas")
    useVisitas.mockReturnValue({
      visitas: [],
      cargando: false,
      error: new Error("offline"),
      reintentar: vi.fn(),
    })
    expect(render()).toContain("offline")
  })
})

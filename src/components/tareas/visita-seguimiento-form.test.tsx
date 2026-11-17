import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { visitas } = vi.hoisted(() => ({
  visitas: { data: undefined as unknown, isPending: true },
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/api/hooks", () => ({
  useEdgeVisits: () => visitas,
  useCreateEdgeFollowupVisit: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))
vi.mock("@/lib/hooks/queries", () => ({
  mensajeError: (e: unknown) => String(e),
  useTalleres: () => ({ data: [{ id: "t-1", nombre: "Móvil 1", activo: true }] }),
}))

import { VisitaSeguimientoForm, ventanaSeguimiento } from "./visita-seguimiento-form"

const orden = (valvulaId: string, nombre: string) => ({
  work_order: { id: `wo-${valvulaId}`, valvula_id: valvulaId, estado: "no_evaluada" },
  valve: { nombre },
  context: null,
})

const operation = {
  operation: { id: "visit-1", taller_movil: { id: "t-1" } },
  visit: { visit: { id: "visit-1", solicitud_id: "req-1" } },
  work_orders: [orden("v-1", "PSV-1"), orden("v-2", "PSV-2")],
}

const render = () => renderToStaticMarkup(<VisitaSeguimientoForm operation={operation as never} />)

const marcadas = (html: string) => (html.match(/checked=""/g) ?? []).length

describe("VisitaSeguimientoForm", () => {
  beforeEach(() => {
    visitas.data = undefined
    visitas.isPending = true
  })

  it("no preselecciona válvulas mientras se cargan las visitas activas", () => {
    const html = render()
    expect(marcadas(html)).toBe(0)
    expect(html).toContain("Comprobando visitas activas")
  })

  it("preselecciona solo las válvulas que no están en otra visita activa", () => {
    visitas.isPending = false
    visitas.data = [
      {
        visit: { id: "visit-9", solicitud_id: "req-1", estado: "programada" },
        work_orders: [{ valvula_id: "v-2" }],
      },
    ]
    const html = render()
    expect(html).toContain("PSV-1")
    expect(html).not.toContain("PSV-2")
    expect(marcadas(html)).toBe(1)
  })
})

describe("ventanaSeguimiento", () => {
  it("interpreta fecha y hora en -03:00 sin depender de la zona del navegador", () => {
    expect(ventanaSeguimiento("2026-11-20", "10:00")).toEqual({
      startsAt: "2026-11-20T13:00:00.000Z",
      endsAt: "2026-11-20T14:00:00.000Z",
    })
    expect(ventanaSeguimiento("2026-11-20", "10:00", "12:15")).toEqual({
      startsAt: "2026-11-20T13:00:00.000Z",
      endsAt: "2026-11-20T15:15:00.000Z",
    })
    expect(ventanaSeguimiento("2026-11-20", "10:00", "09:00")).toBeUndefined()
  })

  it("devuelve undefined si la fecha u hora no son válidas", () => {
    expect(ventanaSeguimiento("", "10:00")).toBeUndefined()
  })
})

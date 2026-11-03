import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MonthCalendar } from "@/components/common/month-calendar"
import type { TareaResumen } from "@/lib/services"

import { TareaPill } from "./agenda"

const tarea = {
  id: "v-1",
  estado: "programada",
  fechaEjecucion: "2026-10-15",
  horario: "18:32",
  empresaNombre: "Cliente de Prueba",
  plantaNombre: "Planta Norte",
  plantasNombres: ["Planta Norte", "Planta Sur"],
  tallerNombre: "Taller Móvil 3",
  contacto: "Juan Pérez",
  telefono: "299 555-1234",
  detalle: "Revisión de válvulas de alivio",
} as TareaResumen

const render = (t: TareaResumen) => renderToStaticMarkup(<TareaPill tarea={t} onClick={() => {}} />)

describe("TareaPill de la agenda", () => {
  it("muestra horario, cliente, taller móvil, planta, contacto/teléfono y detalle", () => {
    const html = render(tarea)
    expect(html).toContain("18:32")
    expect(html).toContain("Cliente de Prueba")
    expect(html).toContain("Taller Móvil: Taller Móvil 3")
    expect(html).toContain("Planta: Planta Norte +1")
    expect(html).toContain("Juan Pérez · 299 555-1234")
    expect(html).toContain("Revisión de válvulas de alivio")
  })

  it("indica Sin asignar cuando la visita no tiene taller", () => {
    const html = render({ ...tarea, tallerNombre: undefined })
    expect(html).toContain("Sin asignar")
    expect(html).not.toContain("Taller Móvil:")
  })

  it("omite la planta cuando no hay dato en vez de mostrar un guion", () => {
    const html = render({ ...tarea, plantaNombre: "—", plantasNombres: [] })
    expect(html).not.toContain("Planta:")
    expect(html).not.toContain("—")
  })

  it("limita la vista previa del calendario a 3 servicios por día y muestra el botón +N más", () => {
    const items = [1, 2, 3, 4, 5].map((n) => ({
      ...tarea,
      id: `v-${n}`,
      empresaNombre: `Empresa ${n}`,
    }))
    const html = renderToStaticMarkup(
      <MonthCalendar
        mes={new Date("2026-10-15T12:00:00Z")}
        onMesChange={() => {}}
        items={items}
        claveDe={(t) => t.id}
        fechaDe={(t) => t.fechaEjecucion}
        colorDe={() => "#2563eb"}
        renderItem={(t) => <TareaPill tarea={t} onClick={() => {}} />}
      />,
    )
    expect(html).toContain("Empresa 1")
    expect(html).toContain("Empresa 2")
    expect(html).toContain("Empresa 3")
    expect(html).not.toContain("Empresa 4")
    expect(html).toContain("+2 más")
  })
})

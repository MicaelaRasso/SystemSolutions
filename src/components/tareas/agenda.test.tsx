import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { TareaResumen } from "@/lib/services"

import { TareaPill } from "./agenda"

const tarea = {
  id: "v-1",
  estado: "programada",
  horario: "18:32",
  empresaNombre: "Cliente de Prueba",
  plantaNombre: "Planta Norte",
  plantasNombres: ["Planta Norte", "Planta Sur"],
  tallerNombre: "Taller Móvil 3",
} as TareaResumen

const render = (t: TareaResumen) => renderToStaticMarkup(<TareaPill tarea={t} onClick={() => {}} />)

describe("TareaPill de la agenda", () => {
  it("muestra horario, cliente, taller móvil y planta", () => {
    const html = render(tarea)
    expect(html).toContain("18:32")
    expect(html).toContain("Cliente de Prueba")
    expect(html).toContain("Taller Móvil: Taller Móvil 3")
    expect(html).toContain("Planta: Planta Norte +1")
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
})

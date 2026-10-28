import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { TareaResumen } from "@/lib/services"

import { TareaCard } from "./tarea-card"

const tarea = {
  id: "v-1",
  nroSolicitud: 7,
  estado: "programada",
  horario: "18:32",
  empresaNombre: "Cliente de Prueba",
  yacimientoNombre: "Yacimiento Alfa",
  plantaNombre: "Planta Norte",
  plantasNombres: ["Planta Norte", "Planta Sur"],
  equipoNombre: "Equipo 9",
  contacto: "Ana Gómez",
  telefono: "299 555-1234",
} as TareaResumen

function render(t: TareaResumen) {
  return renderToStaticMarkup(
    <TareaCard
      tarea={t}
      talleres={[]}
      onVer={() => {}}
      onAsignar={() => {}}
      onDragStart={() => {}}
      onDragEnd={() => {}}
    />,
  )
}

describe("TareaCard", () => {
  it("muestra cliente, yacimiento, locación, contacto y teléfono", () => {
    const html = render(tarea)
    expect(html).toContain("18:32")
    expect(html).toContain("Cliente de Prueba")
    expect(html).toContain("Yacimiento Alfa")
    expect(html).toContain("Planta Norte +1")
    expect(html).toContain("Ana Gómez")
    expect(html).toContain('href="tel:2995551234"')
    expect(html).not.toContain("Equipo 9")
  })

  it("no anida el enlace de teléfono dentro del botón que abre el detalle", () => {
    const html = render(tarea)
    const boton = html.slice(html.indexOf("<button"), html.indexOf("</button>"))
    expect(boton).not.toContain("<a ")
  })

  it("omite las líneas sin datos en vez de mostrar guiones sueltos", () => {
    const html = render({
      ...tarea,
      yacimientoNombre: "",
      plantaNombre: "—",
      plantasNombres: [],
      contacto: "",
      telefono: "",
    })
    expect(html).not.toContain("—")
    expect(html).not.toContain("tel:")
    expect(html).toContain("Cliente de Prueba")
  })
})

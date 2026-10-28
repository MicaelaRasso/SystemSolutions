import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { FilaTarjeta, TablaResponsive, type ColumnaTabla } from "./tabla-responsive"

type Fila = { id: string; cliente: string; valvulas: number }

const columnas: ColumnaTabla<Fila>[] = [
  { id: "cliente", encabezado: "Cliente", celda: (f) => f.cliente, enTarjeta: "titulo" },
  { id: "valvulas", encabezado: "Válvulas", celda: (f) => f.valvulas, className: "text-right" },
  { id: "interno", encabezado: "Interno", celda: () => "x", enTarjeta: "oculta" },
]
const filas: Fila[] = [
  { id: "1", cliente: "Petrolera Sur", valvulas: 4 },
  { id: "2", cliente: "Gas del Norte", valvulas: 9 },
]

const html = (props: object = {}) =>
  renderToStaticMarkup(
    createElement(TablaResponsive<Fila>, { filas, columnas, clave: (f) => f.id, ...props }),
  )

describe("TablaResponsive", () => {
  it("renderiza la tabla desde md y una tarjeta por fila en pantallas chicas", () => {
    const out = html()
    expect(out).toContain("hidden md:block")
    expect(out).toContain("md:hidden")
    expect(out.match(/<tr/g)).toHaveLength(3) // encabezado + 2 filas
    expect(out.match(/<li/g)).toHaveLength(2)
  })

  it("la tarjeta usa el título, etiqueta los campos y omite las columnas ocultas", () => {
    const out = html()
    const tarjetas = out.slice(out.indexOf("<ul"))
    expect(tarjetas).toContain("Petrolera Sur")
    expect(tarjetas).toContain("<dt")
    expect(tarjetas).toContain("Válvulas")
    expect(tarjetas).not.toContain("Interno")
    expect(out).toContain("Interno") // sí está en la tabla
  })

  it("permite cambiar el corte a lg", () => {
    const out = html({ desde: "lg" })
    expect(out).toContain("hidden lg:block")
    expect(out).toContain("lg:hidden")
  })

  it("agrega acciones en la tabla y en la franja de la tarjeta", () => {
    const out = html({ acciones: (f: Fila) => createElement("button", null, `Editar ${f.id}`) })
    expect(out.match(/Editar 1/g)).toHaveLength(2)
    expect(out).toContain("Acciones")
  })

  it("usa la tarjeta propia cuando se pasa tarjeta", () => {
    const out = html({ tarjeta: (f: Fila) => createElement("p", null, `custom-${f.id}`) })
    expect(out).toContain("custom-1")
    expect(out).not.toContain("<dt")
  })
})

describe("FilaTarjeta", () => {
  it("sin campos ni acciones solo muestra el título", () => {
    const out = renderToStaticMarkup(createElement(FilaTarjeta, { titulo: "Hola", campos: [] }))
    expect(out).toContain("Hola")
    expect(out).not.toContain("<dl")
  })
})

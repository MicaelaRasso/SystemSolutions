import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// Radix dibuja las opciones en un portal con contexto propio: se reemplazan por etiquetas
// simples para inspeccionar qué opciones arma el cascade.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-value={value}>
      {children}
    </div>
  ),
  SelectSeparator: () => <hr />,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

import { OpcionesNivel } from "./ubicacion-cascade"
import { CREAR } from "./ubicacion-logica"

const render = (props: React.ComponentProps<typeof OpcionesNivel>) =>
  renderToStaticMarkup(<OpcionesNivel {...props} />)

describe("OpcionesNivel", () => {
  it("sin crear muestra solo las opciones reales", () => {
    const html = render({ opciones: [{ id: "a", label: "Alfa" }], crear: null })
    expect(html).toContain("Alfa")
    expect(html).not.toContain(CREAR)
    expect(html).not.toContain("Agregar")
    expect(html).not.toContain("<hr")
  })

  it("con crear agrega al final, separada, la opción de alta", () => {
    const html = render({
      opciones: [
        { id: "a", label: "Alfa" },
        { id: "b", label: "Beta" },
      ],
      crear: "Agregar cliente",
    })
    expect(html.indexOf("Beta")).toBeLessThan(html.indexOf("<hr"))
    expect(html.indexOf("<hr")).toBeLessThan(html.indexOf(`data-value="${CREAR}"`))
    expect(html).toContain("Agregar cliente")
  })

  it("con la lista vacía ofrece solo el alta, sin aviso ni separador", () => {
    const html = render({ opciones: [], crear: "Agregar yacimiento" })
    expect(html).toContain("Agregar yacimiento")
    expect(html).not.toContain("Sin opciones")
    expect(html).not.toContain("<hr")
  })

  it("con la lista vacía y sin crear mantiene el aviso", () => {
    expect(render({ opciones: [], crear: null })).toContain("Sin opciones")
  })
})

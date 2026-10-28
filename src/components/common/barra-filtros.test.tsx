import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { BarraFiltros, CampoFiltro } from "./barra-filtros"

const render = (props: { activos?: number; onLimpiar?: () => void } = {}) =>
  renderToStaticMarkup(
    <BarraFiltros {...props}>
      <CampoFiltro etiqueta="Desde" htmlFor="d">
        <input id="d" />
      </CampoFiltro>
    </BarraFiltros>,
  )

describe("BarraFiltros", () => {
  it("en celular arranca plegada y expone el estado con aria-expanded", () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("hidden")
    expect(html).toContain("md:grid")
    expect(html).toContain("Filtros")
  })

  it("muestra el conteo de filtros activos y el botón Limpiar", () => {
    const html = render({ activos: 2, onLimpiar: () => {} })
    expect(html).toContain(">2<")
    expect(html).toContain("Limpiar")
  })

  it("no ofrece Limpiar sin filtros activos", () => {
    expect(render({ activos: 0, onLimpiar: () => {} })).not.toContain("Limpiar")
  })

  it("CampoFiltro asocia la etiqueta al control", () => {
    expect(render()).toContain('for="d"')
  })
})

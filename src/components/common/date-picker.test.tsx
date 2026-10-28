import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CalendarioPanel, DatePicker } from "./date-picker"

const noop = () => {}

describe("DatePicker (disparador)", () => {
  it("muestra el placeholder en español cuando no hay fecha", () => {
    const html = renderToStaticMarkup(
      createElement(DatePicker, { id: "f", value: "", onChange: noop }),
    )
    expect(html).toContain("Elegir fecha")
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('id="f"')
  })

  it("muestra la fecha elegida y reenvía name y aria-invalid", () => {
    const html = renderToStaticMarkup(
      createElement(DatePicker, {
        id: "f",
        name: "fechaEjecucion",
        value: "2026-10-13",
        onChange: noop,
        "aria-invalid": true,
      }),
    )
    expect(html).toContain("mar, 13 oct 2026")
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('name="fechaEjecucion"')
    expect(html).toContain('value="2026-10-13"')
  })
})

describe("CalendarioPanel", () => {
  const base = {
    valor: "2026-10-20",
    foco: "2026-10-20",
    hoy: "2026-10-13",
    onFoco: noop,
    onElegir: noop,
    onBorrar: noop,
  }

  it("arranca la semana en lunes y titula el mes en español", () => {
    const html = renderToStaticMarkup(createElement(CalendarioPanel, base))
    expect(html).toMatch(/LU[^]*MA[^]*MI[^]*JU[^]*VI[^]*SA[^]*DO/)
    expect(html).toContain("octubre 2026")
    expect(html).toContain('role="grid"')
  })

  it("distingue el día elegido de hoy y deja un único día en el orden de tabulación", () => {
    const html = renderToStaticMarkup(createElement(CalendarioPanel, base))
    expect(html).toMatch(
      /aria-selected="true"[^>]*>\s*<button[^>]*aria-label="martes 20 de octubre de 2026"/,
    )
    expect(html).toMatch(/aria-label="martes 13 de octubre de 2026, hoy"[^>]*aria-current="date"/)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it("deshabilita los días fuera de min/max y muestra Borrar sólo si es opcional", () => {
    const html = renderToStaticMarkup(
      createElement(CalendarioPanel, { ...base, min: "2026-10-15" }),
    )
    expect(html).toMatch(/aria-label="miércoles 14 de octubre de 2026"[^>]*aria-disabled="true"/)
    expect(html).not.toMatch(/aria-label="jueves 15 de octubre de 2026"[^>]*aria-disabled/)
    expect(html).not.toContain("Borrar")

    const opcional = renderToStaticMarkup(
      createElement(CalendarioPanel, { ...base, opcional: true }),
    )
    expect(opcional).toContain("Borrar")
  })
})

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ edgeApi: {} }))
vi.mock("@/lib/api/hooks", () => ({}))
vi.mock("@/lib/hooks/queries", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }))

import { SolicitudSinVisita } from "./tareas-list"

const render = (props: Partial<React.ComponentProps<typeof SolicitudSinVisita>> = {}) =>
  renderToStaticMarkup(
    <SolicitudSinVisita
      requestId="req-1"
      numero="12"
      yacimientoNombre="Loma Campana"
      valvulas={3}
      talleres={[{ id: "t-1", nombre: "Móvil 1" }]}
      onScheduled={() => {}}
      {...props}
    />,
  )

describe("SolicitudSinVisita", () => {
  it("muestra el nombre del yacimiento y no su id", () => {
    const html = render()
    expect(html).toContain("Yacimiento Loma Campana")
  })

  it("precarga la fecha y el horario capturados en la solicitud", () => {
    const html = render({ fechaInicial: "2026-11-20", horaInicial: "10:30" })
    expect(html).toContain('value="2026-11-20"')
    expect(html).toContain('value="10:30"')
  })

  it("sin datos capturados arranca vacía a las 08:00", () => {
    const html = render()
    expect(html).toContain('value=""')
    expect(html).toContain('value="08:00"')
  })
})

import { describe, expect, it } from "vitest"

import { visitaIniciada } from "./estado-visita"

describe("visitaIniciada", () => {
  it("una visita en curso, local o en el servidor, está iniciada", () => {
    expect(visitaIniciada({ estadoLocal: "en_curso_local" })).toBe(true)
    expect(visitaIniciada({ estadoLocal: "disponible", backendStatus: "en_curso" })).toBe(true)
    expect(visitaIniciada({ estadoLocal: "disponible" }, "en_curso")).toBe(true)
  })

  it("una visita completada sin conexión sigue mostrándose iniciada (cerrada), no para volver a iniciar", () => {
    expect(visitaIniciada({ estadoLocal: "completada_local", backendStatus: "aceptada" })).toBe(true)
  })

  it("una visita aceptada sin iniciar no está iniciada", () => {
    expect(visitaIniciada({ estadoLocal: "disponible", backendStatus: "aceptada" }, "aceptada")).toBe(false)
  })
})

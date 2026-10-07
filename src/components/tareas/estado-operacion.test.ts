import { describe, expect, it } from "vitest"

import { ESTADO_OPERACION_A_TAREA, puedeCancelarVisitaAdministrativa, puedeEditarProgramacion } from "./estado-operacion"

describe("canonical Visita state in Tarea presentation", () => {
  it("keeps scheduled and accepted visits distinct", () => {
    expect(ESTADO_OPERACION_A_TAREA.programada).toBe("programada")
    expect(ESTADO_OPERACION_A_TAREA.aceptada).toBe("aceptada")
  })

  it("shows an unscheduled request as pending", () => {
    expect(ESTADO_OPERACION_A_TAREA.solicitada).toBe("pendiente")
  })

  it("restricts administrative actions to visit lifecycle states", () => {
    expect(puedeCancelarVisitaAdministrativa("programada")).toBe(true)
    expect(puedeCancelarVisitaAdministrativa("aceptada")).toBe(true)
    expect(puedeCancelarVisitaAdministrativa("en_curso")).toBe(false)
    expect(puedeEditarProgramacion("programada")).toBe(true)
    expect(puedeEditarProgramacion("aceptada")).toBe(false)
  })
})

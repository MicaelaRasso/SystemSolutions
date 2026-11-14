import { describe, expect, it } from "vitest"

import { tareaSchema } from "./schemas"

const BASE = {
  empresaId: "client-1",
  yacimientoId: "field-1",
  plantaId: "plant-1",
  equipoId: "equipment-1",
  tallerId: "",
  contacto: "Contacto",
  telefono: "123",
  fechaSolicitud: "2026-11-02",
  fechaEjecucion: "2026-11-05",
  horario: "",
  tipo: "Certificación",
  detalle: "Servicio",
  pdRto: "",
  ordenTrabajo: "",
  condiciones: [],
  estado: "pendiente" as const,
}

const erroresEn = (campo: string, datos: unknown) => {
  const r = tareaSchema.safeParse(datos)
  return r.success ? [] : r.error.issues.filter((i) => i.path[0] === campo).map((i) => i.message)
}

describe("tareaSchema - fechas", () => {
  it("acepta una ejecución el mismo día o posterior a la solicitud", () => {
    expect(tareaSchema.safeParse(BASE).success).toBe(true)
    expect(tareaSchema.safeParse({ ...BASE, fechaEjecucion: "2026-11-02" }).success).toBe(true)
  })

  it("rechaza una ejecución anterior a la solicitud", () => {
    expect(erroresEn("fechaEjecucion", { ...BASE, fechaEjecucion: "2026-11-01" })).toEqual([
      "No puede ser anterior a la fecha de solicitud",
    ])
  })

  it("no culpa a la fecha de ejecución cuando la de solicitud no es una fecha válida", () => {
    const datos = { ...BASE, fechaSolicitud: "2026-11-03T01:30:00.000Z" }
    expect(erroresEn("fechaEjecucion", datos)).toEqual([])
    expect(erroresEn("fechaSolicitud", datos)).toHaveLength(1)
  })
})

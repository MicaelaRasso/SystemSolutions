import { describe, expect, it } from "vitest"

import { cierreVisitaVencidaSchema, tareaSchema } from "./schemas"

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
  horaFin: "",
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

describe("tareaSchema - hora de fin estimada", () => {
  it("acepta un fin estimado posterior al inicio (o vacío: inicio + 1 h)", () => {
    expect(erroresEn("horaFin", { ...BASE, horario: "09:00", horaFin: "11:30" })).toEqual([])
    expect(erroresEn("horaFin", { ...BASE, horario: "09:00", horaFin: "" })).toEqual([])
    // Sin hora de inicio la visita empieza a las 08:00.
    expect(erroresEn("horaFin", { ...BASE, horario: "", horaFin: "09:00" })).toEqual([])
  })

  it("rechaza un fin estimado igual o anterior al inicio", () => {
    expect(erroresEn("horaFin", { ...BASE, horario: "10:00", horaFin: "10:00" })).toEqual([
      "La hora de fin estimada debe ser posterior a la de inicio",
    ])
    expect(erroresEn("horaFin", { ...BASE, horario: "10:00", horaFin: "09:00" })).toHaveLength(1)
  })
})

describe("cierreVisitaVencidaSchema (E4)", () => {
  const base = {
    motivo: "El técnico no volvió",
    tallerId: "",
    fecha: "",
    hora: "09:00",
    horaFin: "10:00",
  }

  it("exige un fin estimado posterior al inicio", () => {
    const r = cierreVisitaVencidaSchema.safeParse({ ...base, horaFin: "08:00" })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(["horaFin"])
  })

  it("exige el motivo", () => {
    expect(cierreVisitaVencidaSchema.safeParse({ ...base, motivo: "  " }).success).toBe(false)
    expect(cierreVisitaVencidaSchema.safeParse(base).success).toBe(true)
  })

  it("la visita de seguimiento necesita taller, fecha y hora juntos", () => {
    const sinTaller = cierreVisitaVencidaSchema.safeParse({ ...base, fecha: "2026-11-20" })
    expect(sinTaller.success).toBe(false)
    expect(sinTaller.error?.issues[0].path).toEqual(["tallerId"])
    const sinFecha = cierreVisitaVencidaSchema.safeParse({ ...base, tallerId: "workshop-1" })
    expect(sinFecha.success).toBe(false)
    expect(sinFecha.error?.issues[0].path).toEqual(["fecha"])
    expect(
      cierreVisitaVencidaSchema.safeParse({ ...base, tallerId: "workshop-1", fecha: "2026-11-20" })
        .success,
    ).toBe(true)
  })
})

import { describe, expect, it } from "vitest"

import type { OperationSummary } from "@/lib/api/contracts"

import { codigoPdSugerido, resumenDeOperacion } from "./resumenes-visitas"

const operacion = {
  id: "e067c00d-1b2c-4d5e-8f90-a1b2c3d4e5f6",
  cliente: { id: "c1", nombre: "Petrolera Andina" },
  yacimiento: { id: "y1", nombre: "Loma Alta" },
  pd_rto: "pd-4078",
} as unknown as OperationSummary

describe("resumenDeOperacion", () => {
  it("conserva el PD/RTO de la tarea para precargarlo en la visita (D12)", () => {
    expect(resumenDeOperacion(operacion).pdRto).toBe("pd-4078")
    expect(resumenDeOperacion({ ...operacion, numero_solicitud: 42 }).numeroSolicitud).toBe(42)
  })

  it("omite el PD/RTO vacío o nulo", () => {
    expect(resumenDeOperacion({ ...operacion, pd_rto: null }).pdRto).toBeUndefined()
  })
})

describe("codigoPdSugerido", () => {
  it("normaliza el PD/RTO al formato alfanumérico del Parte Diario", () => {
    expect(codigoPdSugerido({ pdRto: " pd-4078 " })).toBe("PD4078")
  })

  it("devuelve vacío sin resumen o sin PD/RTO", () => {
    expect(codigoPdSugerido(undefined)).toBe("")
    expect(codigoPdSugerido({})).toBe("")
  })
})

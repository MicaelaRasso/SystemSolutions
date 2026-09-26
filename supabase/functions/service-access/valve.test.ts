import { describe, expect, it } from "vitest"
import { isValveUpdatePayload } from "../_shared/validation.ts"

const validPayload = {
  name: "PSV-101",
  marca: null,
  numero_serie: "SN-1",
  modelo: null,
  tipo: "safety",
  diametro_entrada: null,
  clase_entrada: null,
  diametro_salida: null,
  clase_salida: null,
  rosca: null,
  razon_disponibilidad: "not_found",
}

describe("valve update payload", () => {
  it("accepts a complete technical-data replacement", () => {
    expect(isValveUpdatePayload(validPayload)).toBe(true)
  })

  it("rejects a partial update before it can clear omitted fields", () => {
    const partialPayload: Record<string, unknown> = { ...validPayload }
    delete partialPayload.rosca
    expect(isValveUpdatePayload(partialPayload)).toBe(false)
  })

  it("rejects invalid availability reasons and field types", () => {
    expect(isValveUpdatePayload({ ...validPayload, razon_disponibilidad: "unknown" })).toBe(false)
    expect(isValveUpdatePayload({ ...validPayload, marca: 123 })).toBe(false)
  })
})

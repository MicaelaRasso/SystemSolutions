import { describe, expect, it } from "vitest"

import { normalizarMotivo } from "./motivo-dialog-utils"

describe("normalizarMotivo", () => {
  it("recorta los espacios de los extremos", () => {
    expect(normalizarMotivo("  Cambio de taller por avería \n")).toBe("Cambio de taller por avería")
  })

  it("devuelve null si está vacío o solo tiene espacios", () => {
    expect(normalizarMotivo("")).toBeNull()
    expect(normalizarMotivo("  \t\n ")).toBeNull()
  })
})

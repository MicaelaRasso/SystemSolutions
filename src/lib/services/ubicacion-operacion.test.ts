import { describe, expect, it } from "vitest"

import { nombresDePlantas, resumenPlantas } from "./ubicacion-operacion"

describe("nombresDePlantas", () => {
  it("devuelve lista vacia cuando el backend todavia no envia plantas", () => {
    expect(nombresDePlantas(undefined)).toEqual([])
    expect(nombresDePlantas([])).toEqual([])
  })

  it("conserva el orden, recorta espacios y descarta vacios y repetidos", () => {
    expect(
      nombresDePlantas([
        { id: "1", nombre: " Planta Norte " },
        { id: "2", nombre: "" },
        { id: "3", nombre: "Planta Norte" },
        { id: "4", nombre: "Planta Sur" },
      ]),
    ).toEqual(["Planta Norte", "Planta Sur"])
  })
})

describe("resumenPlantas", () => {
  it("queda vacio sin plantas", () => {
    expect(resumenPlantas([])).toBe("")
  })

  it("muestra el nombre cuando hay una sola planta", () => {
    expect(resumenPlantas(["Planta Norte"])).toBe("Planta Norte")
  })

  it("agrega +N cuando hay mas de una", () => {
    expect(resumenPlantas(["Planta Norte", "Planta Sur"])).toBe("Planta Norte +1")
    expect(resumenPlantas(["A", "B", "C"])).toBe("A +2")
  })
})

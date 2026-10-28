import { describe, expect, it } from "vitest"

import { columnaMovilVigente } from "./cronograma-utils"

const SIN = "sin_asignar"

describe("columnaMovilVigente", () => {
  it("mantiene la columna elegida si sigue existiendo", () => {
    expect(columnaMovilVigente([SIN, "a", "b"], "b", SIN)).toBe("b")
  })

  it("sin elección empieza por el primer taller y no por «Sin asignar»", () => {
    expect(columnaMovilVigente([SIN, "a", "b"], null, SIN)).toBe("a")
  })

  it("si la elegida desapareció vuelve al primer taller", () => {
    expect(columnaMovilVigente([SIN, "a"], "zzz", SIN)).toBe("a")
  })

  it("sin talleres muestra «Sin asignar»", () => {
    expect(columnaMovilVigente([SIN], null, SIN)).toBe(SIN)
  })

  it("sin columnas devuelve vacío", () => {
    expect(columnaMovilVigente([], null, SIN)).toBe("")
  })
})

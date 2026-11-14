import { describe, expect, it } from "vitest"

import { nombreDeTecnico } from "./tecnicos"

describe("nombreDeTecnico", () => {
  it("combina nombre y apellido de la nómina, que es lo que valida la firma (D3)", () => {
    expect(nombreDeTecnico({ nombre: "Tomás", apellido: "Tecnico" })).toBe("Tomás Tecnico")
  })

  it("normaliza espacios y tolera la falta de apellido", () => {
    expect(nombreDeTecnico({ nombre: "  Ana " })).toBe("Ana")
  })

  it("usa `name` cuando el contexto ya trae el nombre completo", () => {
    expect(nombreDeTecnico({ name: "Luis Lopez" })).toBe("Luis Lopez")
  })
})

import { describe, expect, it } from "vitest"

import { mensajeFirmaRecibida } from "./firma-pendiente-panel"

describe("mensajeFirmaRecibida", () => {
  it("informa los certificados emitidos con la firma", () => {
    expect(mensajeFirmaRecibida("completada", 2)).toMatch(/2 certificado/)
  })

  it("en una visita en «Requiere finalización» avisa que se emiten al completarse (E4)", () => {
    expect(mensajeFirmaRecibida("requiere_finalizacion", 0)).toMatch(/cuando se complete/)
  })

  it("mantiene el aviso general en una visita completada", () => {
    expect(mensajeFirmaRecibida("completada", 0)).toMatch(/elegibles/)
  })
})

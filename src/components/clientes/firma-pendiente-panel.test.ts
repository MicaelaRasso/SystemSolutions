import { describe, expect, it } from "vitest"

import { archivoDeFirma, mensajeFirmaRecibida } from "./firma-pendiente-panel"

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

describe("archivoDeFirma", () => {
  const dibujo = `data:image/png;base64,${btoa("firma")}`

  it("convierte la firma dibujada en un PNG para subir", () => {
    const archivo = archivoDeFirma(undefined, dibujo)
    expect(archivo?.name).toBe("firma-cliente.png")
    expect(archivo?.type).toBe("image/png")
    expect(archivo?.size).toBe("firma".length)
  })

  it("prefiere la foto elegida por el Cliente sobre el dibujo", () => {
    const foto = new File(["x"], "foto.jpg", { type: "image/jpeg" })
    expect(archivoDeFirma(foto, dibujo)).toBe(foto)
  })

  it("no devuelve nada sin dibujo ni foto", () => {
    expect(archivoDeFirma(undefined, undefined)).toBeUndefined()
  })
})

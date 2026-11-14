import { describe, expect, it } from "vitest"

import { idsDeImagenes, listarFotosParteDiario, textoCantidadFotos } from "./fotos-parte-diario"

describe("idsDeImagenes", () => {
  it("toma los ids de las imágenes guardadas e ignora lo que no tiene id", () => {
    expect(idsDeImagenes([{ id: "a" }, { id: 3 }, null, "x", { id: "b" }])).toEqual(["a", "b"])
  })

  it("devuelve una lista vacía si no hay imágenes", () => {
    expect(idsDeImagenes(undefined)).toEqual([])
    expect(idsDeImagenes({})).toEqual([])
  })
})

describe("listarFotosParteDiario", () => {
  const sesion = { id: "b", nombre: "parte.jpg", url: "blob:b", pendiente: false }

  it("numera primero las fotos previas y después las de esta sesión, sin repetir", () => {
    expect(listarFotosParteDiario(["a", "b"], [sesion])).toEqual([
      { id: "a", numero: 1, origen: "remota" },
      { id: "b", numero: 2, origen: "sesion", foto: sesion },
    ])
  })

  it("lista las fotos guardadas sin conexión aunque no estén en el servidor", () => {
    const pendiente = { ...sesion, id: "c", pendiente: true }
    expect(listarFotosParteDiario([], [pendiente])).toEqual([
      { id: "c", numero: 1, origen: "sesion", foto: pendiente },
    ])
  })
})

describe("textoCantidadFotos", () => {
  it("mantiene el formato «N foto(s)» que buscan los e2e", () => {
    expect(textoCantidadFotos(1)).toMatch(/1 foto\(s\)/)
    expect(textoCantidadFotos(3)).toMatch(/3 foto\(s\)/)
  })

  it("avisa cuando todavía no hay fotos", () => {
    expect(textoCantidadFotos(0)).toBe("Todavía no hay fotos del Parte Diario.")
  })
})

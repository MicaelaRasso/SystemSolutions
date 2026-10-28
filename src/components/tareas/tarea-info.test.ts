import { describe, expect, it } from "vitest"

import type { TareaResumen } from "@/lib/services"

import { infoAgenda, infoCronograma, telefonoHref } from "./tarea-info"

const base = {
  empresaNombre: "Cliente de Prueba",
  yacimientoNombre: "Yacimiento Alfa",
  plantaNombre: "—",
  equipoNombre: "—",
  contacto: "",
  telefono: "",
} as TareaResumen

describe("infoCronograma", () => {
  it("omite cada dato vacio o con guion suelto", () => {
    expect(infoCronograma(base)).toEqual({
      yacimiento: "Yacimiento Alfa",
      locacion: "",
      contacto: "",
      telefono: "",
    })
  })

  it("usa las plantas de la visita con sufijo +N", () => {
    const info = infoCronograma({
      ...base,
      plantaNombre: "Planta Norte",
      plantasNombres: ["Planta Norte", "Planta Sur"],
      contacto: " Ana ",
      telefono: " 299 555-1234 ",
    })
    expect(info.locacion).toBe("Planta Norte +1")
    expect(info.contacto).toBe("Ana")
    expect(info.telefono).toBe("299 555-1234")
  })

  it("cae al nombre de planta cuando no hay lista", () => {
    expect(infoCronograma({ ...base, plantaNombre: "Planta Norte" }).locacion).toBe("Planta Norte")
  })
})

describe("infoAgenda", () => {
  it("muestra Sin asignar cuando la visita no tiene taller", () => {
    expect(infoAgenda(base)).toEqual({ taller: "Sin asignar", planta: "" })
  })

  it("muestra taller y planta", () => {
    expect(
      infoAgenda({ ...base, tallerNombre: "Taller Móvil 3", plantasNombres: ["Planta Norte"] }),
    ).toEqual({ taller: "Taller Móvil 3", planta: "Planta Norte" })
  })
})

describe("telefonoHref", () => {
  it("deja solo digitos y el + inicial", () => {
    expect(telefonoHref("+54 (299) 555-1234")).toBe("tel:+542995551234")
    expect(telefonoHref("299 555 1234")).toBe("tel:2995551234")
  })

  it("devuelve undefined sin digitos", () => {
    expect(telefonoHref("")).toBeUndefined()
    expect(telefonoHref("n/d")).toBeUndefined()
  })
})

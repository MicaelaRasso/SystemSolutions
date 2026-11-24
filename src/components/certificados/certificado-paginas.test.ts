import { describe, expect, it } from "vitest"

import { ANCHO_HOJA_A4_PX } from "./certificado-escala"
import {
  ALTO_HOJA_A4_PX,
  MARGEN_HOJA_PX,
  cortarEnPaginas,
  densidadCaptura,
} from "./certificado-paginas"

describe("medidas de la hoja A4", () => {
  it("guarda la proporción 210 × 297 mm y un margen de 10 mm", () => {
    expect(ALTO_HOJA_A4_PX / ANCHO_HOJA_A4_PX).toBeCloseTo(297 / 210, 6)
    expect(MARGEN_HOJA_PX).toBeCloseTo((10 / 25.4) * 96, 6)
  })
})

describe("cortarEnPaginas", () => {
  const opciones = { altoPagina: 100, margen: 10 }

  it("deja todo en una página cuando entra", () => {
    expect(cortarEnPaginas({ altoTotal: 90, bloques: [], ...opciones })).toEqual([
      { desde: 0, hasta: 90 },
    ])
  })

  it("la primera página usa el alto menos el margen inferior y las siguientes, menos los dos", () => {
    expect(cortarEnPaginas({ altoTotal: 250, bloques: [], ...opciones })).toEqual([
      { desde: 0, hasta: 90 },
      { desde: 90, hasta: 170 },
      { desde: 170, hasta: 250 },
    ])
  })

  it("no parte una sección que entra en una página: la pasa entera a la siguiente", () => {
    const bloques = [
      { inicio: 0, fin: 60 },
      { inicio: 60, fin: 130 },
    ]
    expect(cortarEnPaginas({ altoTotal: 130, bloques, ...opciones })).toEqual([
      { desde: 0, hasta: 60 },
      { desde: 60, hasta: 130 },
    ])
  })

  it("encadena el retroceso cuando hay secciones anidadas", () => {
    const bloques = [
      { inicio: 20, fin: 95 },
      { inicio: 50, fin: 95 },
    ]
    expect(cortarEnPaginas({ altoTotal: 120, bloques, ...opciones })).toEqual([
      { desde: 0, hasta: 20 },
      { desde: 20, hasta: 100 },
      { desde: 100, hasta: 120 },
    ])
  })

  it("corta por el alto de la página una sección más alta que una página", () => {
    const bloques = [{ inicio: 5, fin: 200 }]
    expect(cortarEnPaginas({ altoTotal: 200, bloques, ...opciones })).toEqual([
      { desde: 0, hasta: 90 },
      { desde: 90, hasta: 170 },
      { desde: 170, hasta: 200 },
    ])
  })

  it("parte una sección que empieza en el inicio de la página si no entra en ella", () => {
    const bloques = [{ inicio: 0, fin: 95 }]
    expect(cortarEnPaginas({ altoTotal: 120, bloques, ...opciones })).toEqual([
      { desde: 0, hasta: 90 },
      { desde: 90, hasta: 120 },
    ])
  })

  it("devuelve al menos una página aunque el alto no sea válido", () => {
    expect(cortarEnPaginas({ altoTotal: 0, bloques: [], ...opciones })).toEqual([
      { desde: 0, hasta: 0 },
    ])
  })
})

describe("densidadCaptura", () => {
  it("usa la densidad deseada cuando el lienzo entra", () => {
    expect(densidadCaptura(ANCHO_HOJA_A4_PX, ALTO_HOJA_A4_PX * 2)).toBe(2)
  })

  it("la reduce para no pasar el área máxima del lienzo", () => {
    const alto = ALTO_HOJA_A4_PX * 8
    const densidad = densidadCaptura(ANCHO_HOJA_A4_PX, alto)
    expect(densidad).toBeLessThan(2)
    expect(ANCHO_HOJA_A4_PX * densidad * alto * densidad).toBeLessThanOrEqual(16_000_001)
  })
})

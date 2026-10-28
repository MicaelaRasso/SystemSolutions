import { describe, expect, it } from "vitest"

import { ANCHO_HOJA_A4_PX, escalaParaAncho } from "./certificado-escala"

describe("escalaParaAncho", () => {
  it("usa la hoja A4 de 210 mm a 96 dpi como ancho natural", () => {
    expect(ANCHO_HOJA_A4_PX).toBeCloseTo(793.7, 1)
  })

  it("no agranda la hoja cuando sobra espacio", () => {
    expect(escalaParaAncho(1200)).toBe(1)
    expect(escalaParaAncho(ANCHO_HOJA_A4_PX)).toBe(1)
  })

  it("reduce proporcionalmente cuando el espacio es menor que la hoja", () => {
    expect(escalaParaAncho(ANCHO_HOJA_A4_PX / 2)).toBeCloseTo(0.5, 5)
    expect(escalaParaAncho(300)).toBeCloseTo(300 / ANCHO_HOJA_A4_PX, 5)
  })

  it("ante una medida inválida mantiene el tamaño real", () => {
    expect(escalaParaAncho(0)).toBe(1)
    expect(escalaParaAncho(-10)).toBe(1)
    expect(escalaParaAncho(Number.NaN)).toBe(1)
  })
})

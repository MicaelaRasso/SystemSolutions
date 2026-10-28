import { describe, expect, it } from "vitest"

import {
  ajustarARango,
  etiquetaDia,
  fechaInicialFoco,
  formatoVisible,
  fueraDeRango,
  grillaMes,
  isoDeFecha,
  moverFoco,
  parsearIso,
} from "./date-picker-utils"

describe("parsearIso / isoDeFecha", () => {
  it("parsea yyyy-MM-dd como medianoche local, sin corrimiento de zona horaria", () => {
    const d = parsearIso("2026-10-01")!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
  })

  it("rechaza vacíos, formatos incorrectos y fechas imposibles", () => {
    expect(parsearIso("")).toBeNull()
    expect(parsearIso("2026-1-5")).toBeNull()
    expect(parsearIso("2026-02-30")).toBeNull()
    expect(parsearIso("2026-13-01")).toBeNull()
    expect(parsearIso("hola")).toBeNull()
  })

  it("formatea con la fecha local y es la inversa del parseo", () => {
    expect(isoDeFecha(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(isoDeFecha(parsearIso("2028-02-29")!)).toBe("2028-02-29")
  })
})

describe("grillaMes", () => {
  it("siempre devuelve 6 semanas (42 días) que arrancan en lunes", () => {
    for (const mes of ["2026-02-01", "2026-03-01", "2026-06-01", "2027-02-01"]) {
      const dias = grillaMes(mes)
      expect(dias).toHaveLength(42)
      expect(parsearIso(dias[0].iso)!.getDay()).toBe(1)
      expect(parsearIso(dias[41].iso)!.getDay()).toBe(0)
    }
  })

  it("marca los días que no pertenecen al mes", () => {
    // Octubre 2026 arranca jueves: lunes 28/9 a miércoles 30/9 quedan afuera.
    const dias = grillaMes("2026-10-14")
    expect(dias[0]).toEqual({ iso: "2026-09-28", dia: 28, fueraDeMes: true })
    expect(dias[3]).toEqual({ iso: "2026-10-01", dia: 1, fueraDeMes: false })
    expect(dias.filter((d) => !d.fueraDeMes)).toHaveLength(31)
    expect(dias[41].iso).toBe("2026-11-08")
    expect(dias[41].fueraDeMes).toBe(true)
  })
})

describe("fueraDeRango / ajustarARango", () => {
  it("sin límites ningún día queda fuera", () => {
    expect(fueraDeRango("2026-10-14")).toBe(false)
  })

  it("respeta min y max inclusive", () => {
    expect(fueraDeRango("2026-10-13", "2026-10-14")).toBe(true)
    expect(fueraDeRango("2026-10-14", "2026-10-14")).toBe(false)
    expect(fueraDeRango("2026-10-20", undefined, "2026-10-20")).toBe(false)
    expect(fueraDeRango("2026-10-21", undefined, "2026-10-20")).toBe(true)
  })

  it("ignora límites vacíos o inválidos", () => {
    expect(fueraDeRango("2026-10-13", "", "x")).toBe(false)
  })

  it("lleva la fecha al rango", () => {
    expect(ajustarARango("2026-10-01", "2026-10-14")).toBe("2026-10-14")
    expect(ajustarARango("2026-12-01", undefined, "2026-11-30")).toBe("2026-11-30")
    expect(ajustarARango("2026-10-20", "2026-10-14", "2026-11-30")).toBe("2026-10-20")
  })
})

describe("moverFoco", () => {
  it("flechas mueven un día o una semana, cruzando meses y años", () => {
    expect(moverFoco("2026-10-31", "ArrowRight")).toBe("2026-11-01")
    expect(moverFoco("2026-10-01", "ArrowLeft")).toBe("2026-09-30")
    expect(moverFoco("2026-12-29", "ArrowDown")).toBe("2027-01-05")
    expect(moverFoco("2026-03-03", "ArrowUp")).toBe("2026-02-24")
  })

  it("Inicio y Fin van al lunes y al domingo de la semana", () => {
    expect(moverFoco("2026-10-14", "Home")).toBe("2026-10-12")
    expect(moverFoco("2026-10-14", "End")).toBe("2026-10-18")
    expect(moverFoco("2026-10-12", "Home")).toBe("2026-10-12")
  })

  it("RePág / AvPág cambian de mes y recortan al último día cuando hace falta", () => {
    expect(moverFoco("2026-10-14", "PageUp")).toBe("2026-09-14")
    expect(moverFoco("2026-10-14", "PageDown")).toBe("2026-11-14")
    expect(moverFoco("2026-01-31", "PageDown")).toBe("2026-02-28")
    expect(moverFoco("2026-03-31", "PageUp")).toBe("2026-02-28")
  })

  it("con Shift, RePág / AvPág cambian de año", () => {
    expect(moverFoco("2028-02-29", "PageDown", true)).toBe("2029-02-28")
    expect(moverFoco("2026-10-14", "PageUp", true)).toBe("2025-10-14")
  })

  it("devuelve null para teclas que no navegan", () => {
    expect(moverFoco("2026-10-14", "Enter")).toBeNull()
    expect(moverFoco("2026-10-14", "a")).toBeNull()
  })
})

describe("fechaInicialFoco", () => {
  it("prioriza el valor elegido", () => {
    expect(fechaInicialFoco("2026-05-02", "2026-10-13")).toBe("2026-05-02")
  })

  it("sin valor usa hoy, llevado al rango permitido", () => {
    expect(fechaInicialFoco("", "2026-10-13")).toBe("2026-10-13")
    expect(fechaInicialFoco("", "2026-10-13", "2026-10-20")).toBe("2026-10-20")
    expect(fechaInicialFoco("basura", "2026-10-13", undefined, "2026-10-01")).toBe("2026-10-01")
  })
})

describe("textos en español", () => {
  it("muestra la fecha compacta con día de la semana", () => {
    expect(formatoVisible("2026-10-13")).toBe("mar, 13 oct 2026")
    expect(formatoVisible("")).toBe("")
  })

  it("etiqueta accesible completa", () => {
    expect(etiquetaDia("2026-10-13")).toBe("martes 13 de octubre de 2026")
  })
})

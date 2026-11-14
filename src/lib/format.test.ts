import { afterEach, describe, expect, it } from "vitest"

import { fmtFechaHoraArgentina } from "./format"

describe("fmtFechaHoraArgentina (P8: hora de las visitas)", () => {
  const tzOriginal = process.env.TZ
  afterEach(() => {
    process.env.TZ = tzOriginal
  })

  it("muestra la hora de la tarde en 24 h y sin segundos (16:00, no «04:00:00»)", () => {
    expect(fmtFechaHoraArgentina("2026-11-13T16:00:00-03:00")).toBe("13/11/2026 16:00")
  })

  it("usa la hora argentina aunque el dispositivo esté en otra zona", () => {
    process.env.TZ = "UTC"
    expect(fmtFechaHoraArgentina("2026-11-13T19:00:00Z")).toBe("13/11/2026 16:00")
    expect(fmtFechaHoraArgentina(new Date("2026-11-14T02:30:00Z"))).toBe("13/11/2026 23:30")
  })

  it("la medianoche es 00:00 (nunca 24:00)", () => {
    expect(fmtFechaHoraArgentina("2026-11-13T03:00:00Z")).toBe("13/11/2026 00:00")
  })

  it("con segundos para la auditoría (hora exacta, RNF-12), también en 24 h", () => {
    expect(fmtFechaHoraArgentina("2026-11-13T19:00:07Z", { segundos: true })).toBe("13/11/2026 16:00:07")
  })

  it("devuelve undefined si el valor no es una fecha", () => {
    expect(fmtFechaHoraArgentina("no es fecha")).toBeUndefined()
    expect(fmtFechaHoraArgentina(null)).toBeUndefined()
    expect(fmtFechaHoraArgentina(42)).toBeUndefined()
  })
})

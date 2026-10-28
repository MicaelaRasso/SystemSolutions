import { describe, expect, it } from "vitest"

import { consultaNavCompacta, NAV_FIJA_DESDE_PX } from "./use-nav-compacta"

describe("consultaNavCompacta", () => {
  it("el menú es un panel hasta 1023 px y queda fijo desde 1024 px", () => {
    expect(NAV_FIJA_DESDE_PX).toBe(1024)
    expect(consultaNavCompacta()).toBe("(max-width: 1023px)")
  })

  it("permite otro corte", () => {
    expect(consultaNavCompacta(768)).toBe("(max-width: 767px)")
  })
})

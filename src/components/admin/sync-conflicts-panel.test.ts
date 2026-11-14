import { describe, expect, it } from "vitest"

import { avisoDelConflicto, sePuedeAceptar } from "./sync-conflicts-panel"

describe("conflictos de sincronización de firmas (P1)", () => {
  it("no ofrece aceptar una firma: el servidor no permite reaplicarla", () => {
    expect(sePuedeAceptar("submit_signature")).toBe(false)
    expect(sePuedeAceptar("update_certificate_draft")).toBe(true)
    expect(sePuedeAceptar(undefined)).toBe(true)
  })

  it("explica que una firma ya registrada se resuelve rechazando el reintento", () => {
    expect(
      avisoDelConflicto({
        operation_kind: "submit_signature",
        reason: "A visit signature cannot be replaced",
      }),
    ).toMatch(/ya estaba registrada.*Rechazar/)
    expect(avisoDelConflicto({ operation_kind: "submit_signature", reason: "otro" })).toMatch(
      /Rechazar/,
    )
    expect(avisoDelConflicto({ operation_kind: "complete_visit", reason: "x" })).toBeUndefined()
  })
})

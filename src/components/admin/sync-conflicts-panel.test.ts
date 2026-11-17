import { describe, expect, it } from "vitest"

import {
  avisoDelConflicto,
  datosDeCorreccion,
  esConflictoPorVencimiento,
  etiquetaOperacion,
  sePuedeAceptar,
} from "./sync-conflicts-panel"

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

describe("conflictos de una visita vencida y corrección (E3)", () => {
  const motivo = "The visit was closed at the end of its day and requires finalization"

  it("rotula cada tipo de operación en español, incluidas las altas de válvulas en campo", () => {
    expect(etiquetaOperacion("add_work_order")).toBe("Agregar válvula del catálogo")
    expect(etiquetaOperacion("create_valve")).toBe("Alta de válvula nueva")
    expect(etiquetaOperacion("submit_signature")).toBe("Firma de la visita")
    expect(etiquetaOperacion("complete_visit")).toBe("Completar visita")
    expect(etiquetaOperacion("set_part_diario")).toBe("Número de Parte Diario")
    expect(etiquetaOperacion("tipo_desconocido")).toBe("tipo_desconocido")
    expect(etiquetaOperacion(undefined)).toBe("Operación")
  })

  it("reconoce el conflicto por vencimiento de la visita", () => {
    expect(esConflictoPorVencimiento({ reason: motivo })).toBe(true)
    expect(esConflictoPorVencimiento({ reason: "La visita fue reasignada" })).toBe(false)
  })

  it("explica cómo resolver una operación que llegó después del cierre", () => {
    expect(avisoDelConflicto({ operation_kind: "work_order_outcome", reason: motivo })).toMatch(
      /venció.*Aceptar.*más antigua/,
    )
    expect(avisoDelConflicto({ operation_kind: "submit_signature", reason: motivo })).toMatch(
      /Rechazar.*panel.*portal/,
    )
  })

  it("autoriza la corrección con taller, inicio y fin estimado", () => {
    const datos = datosDeCorreccion(
      { payload: { certificate_id: "cert-1" } },
      { provider_id: "taller-1", starts_at: "2099-05-01T09:00", ends_at: "2099-05-01T10:30" },
    )
    expect(datos).toEqual({
      source_certificate_id: "cert-1",
      provider_id: "taller-1",
      starts_at: new Date("2099-05-01T09:00").toISOString(),
      ends_at: new Date("2099-05-01T10:30").toISOString(),
    })
  })
})

describe("inicio rechazado porque el taller tenía otra visita en curso", () => {
  it("explica que un taller atiende una visita a la vez y cuándo aceptar", () => {
    expect(
      avisoDelConflicto({
        operation_kind: "start_visit",
        reason:
          "The Taller Móvil already has a visit in progress; complete it before starting another",
      }),
    ).toMatch(/una visita a la vez.*Aceptar y aplicar/)
  })
})

import { describe, expect, it } from "vitest"

import { tituloDeVisita, type ResumenVisita } from "./visita-titulo"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const visitId = "e067c00d-1b2c-4d5e-8f90-a1b2c3d4e5f6"
// La fecha se muestra en hora argentina sin importar la zona horaria de quien corre las pruebas.
const startsAt = "2026-10-14T12:05:00Z"

function resumen(parcial: Partial<ResumenVisita> = {}): ResumenVisita {
  return {
    cliente: { nombre: "Petrolera Andina" },
    yacimiento: { nombre: "Loma Alta" },
    ...parcial,
  }
}

describe("tituloDeVisita", () => {
  it("arma «Cliente · Yacimiento · Planta» con la operación", () => {
    const { titulo } = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ plantas: [{ nombre: "Planta Norte" }] }),
    )
    expect(titulo).toBe("Petrolera Andina · Loma Alta · Planta Norte")
  })

  it("omite la planta cuando no hay", () => {
    expect(tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen()).titulo).toBe(
      "Petrolera Andina · Loma Alta",
    )
    expect(
      tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen({ plantas: [] })).titulo,
    ).toBe("Petrolera Andina · Loma Alta")
  })

  it("suma « +N» cuando hay varias plantas", () => {
    const { titulo } = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ plantas: [{ nombre: "Planta Norte" }, { nombre: "Planta Sur" }, { nombre: "Batería 3" }] }),
    )
    expect(titulo).toBe("Petrolera Andina · Loma Alta · Planta Norte +2")
  })

  it("omite las partes de nombre vacío", () => {
    const { titulo } = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ cliente: { nombre: "  " }, plantas: [{ nombre: "Planta Norte" }] }),
    )
    expect(titulo).toBe("Loma Alta · Planta Norte")
  })

  it("agrega contacto y teléfono cuando existen", () => {
    const visita = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ contacto: "Marcela Ruiz", telefono: "+54 299 555-0101" }),
    )
    expect(visita.contacto).toBe("Marcela Ruiz")
    expect(visita.telefono).toBe("+54 299 555-0101")
    expect(visita.lineas).toEqual(["Marcela Ruiz · +54 299 555-0101"])
  })

  it("no agrega líneas cuando falta el contacto o está vacío", () => {
    const sinDatos = tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen())
    expect(sinDatos.lineas).toEqual([])
    expect(sinDatos.contacto).toBeUndefined()
    expect(sinDatos.telefono).toBeUndefined()

    const vacios = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ contacto: " ", telefono: "" }),
    )
    expect(vacios.lineas).toEqual([])
  })

  it("muestra solo lo que haya si falta uno de los dos datos de contacto", () => {
    expect(
      tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen({ telefono: "299 555-0101" })).lineas,
    ).toEqual(["299 555-0101"])
    expect(
      tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen({ contacto: "Marcela Ruiz" })).lineas,
    ).toEqual(["Marcela Ruiz"])
  })

  it("sin operación usa «Visita del dd/mm/aaaa hh:mm»", () => {
    const visita = tituloDeVisita({ id: visitId, starts_at: startsAt })
    expect(visita.titulo).toBe("Visita del 14/10/2026 09:05")
    expect(visita.lineas).toEqual([])
  })

  it("P8: una visita de la tarde se muestra en 24 h y en hora argentina (16:00, no «04:00»)", () => {
    expect(tituloDeVisita({ id: visitId, starts_at: "2026-11-13T19:00:00Z" }).titulo).toBe(
      "Visita del 13/11/2026 16:00",
    )
  })

  it("sin operación y con fecha inválida o ausente no inventa nada", () => {
    expect(tituloDeVisita({ id: visitId, starts_at: "no es fecha" }).titulo).toBe("Visita sin fecha informada")
    expect(tituloDeVisita({ id: visitId }).titulo).toBe("Visita sin fecha informada")
    expect(tituloDeVisita({ id: visitId, starts_at: 42 }).titulo).toBe("Visita sin fecha informada")
  })

  it("cae al respaldo si la operación no aporta ningún nombre", () => {
    const { titulo } = tituloDeVisita(
      { id: visitId, starts_at: startsAt },
      resumen({ cliente: { nombre: "" }, yacimiento: { nombre: "" } }),
    )
    expect(titulo).toBe("Visita del 14/10/2026 09:05")
  })

  it("nunca incluye un UUID, con o sin operación", () => {
    const casos = [
      tituloDeVisita({ id: visitId, starts_at: startsAt }),
      tituloDeVisita({ id: visitId }),
      tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen({ contacto: "Marcela", telefono: "1" })),
      tituloDeVisita({ id: visitId, starts_at: "x" }, resumen({ cliente: { nombre: "" } })),
    ]
    for (const caso of casos) {
      expect(`${caso.titulo} ${caso.lineas.join(" ")}`).not.toMatch(UUID)
      expect(caso.titulo).not.toContain(visitId)
    }
  })

  it("informa el número de solicitud como referencia para el Taller (RF-19)", () => {
    const { referencia } = tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen({ numeroSolicitud: 42 }))
    expect(referencia).toBe("Solicitud N° 42")
    expect(tituloDeVisita({ id: visitId, starts_at: startsAt }, resumen()).referencia).toBeUndefined()
  })
})

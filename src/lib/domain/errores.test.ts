import { describe, expect, it } from "vitest"

import { traducirMensajeError } from "./errores"

describe("traducirMensajeError", () => {
  it("traduce la superposición de equipo de la restricción de exclusión", () => {
    expect(
      traducirMensajeError(
        'conflicting key value violates exclusion constraint "visita_equipos_no_simultaneous_equipment"',
      ),
    ).toBe("El equipo ya tiene otra visita en ese horario. Elige otro día u horario.")
  })

  it("traduce el rechazo de un equipo sin válvulas", () => {
    expect(traducirMensajeError("The selected Equipo has no Válvulas")).toMatch(
      /sin válvulas|no tiene válvulas/i,
    )
  })

  it("traduce cualquier otra restricción de exclusión como superposición", () => {
    expect(
      traducirMensajeError(
        'conflicting key value violates exclusion constraint "otra_restriccion"',
      ),
    ).toMatch(/se superpone/i)
  })

  it.each([
    ["Cliente not found", /Cliente/],
    ["The target account is not an active Cliente", /cuenta del Cliente/],
    ["An accepted service request cannot be scheduled", /ya fue aceptada/],
    ["Only an accepted service request can have a follow-up visit", /seguimiento/],
    ["The selected Cliente does not own the Yacimiento", /yacimiento/i],
    ["A visit requires a valid date and time window", /fecha u horario/],
    ["Only a cancelled visit can be restored", /cancelada/],
    ["The schedule is unchanged", /cambios/],
    ["Válvulas can be added only while the visit is in progress", /en curso/],
    ["An added Válvula must belong to the same Cliente", /mismo Cliente/],
    ["The Taller Móvil requires active Yacimiento access", /acceso al yacimiento/],
    ["Válvula not found", /válvula/i],
    ["The work order id is already used by another Orden de trabajo", /orden/i],
    ["Válvulas can be created only while the visit is in progress", /en curso/],
    ["A created Válvula must belong to the visit Cliente", /Cliente de la visita/],
    ["Equipo not found", /equipo/i],
    ["The Válvula id is already used by another Válvula", /otra válvula/i],
    ["Asset name or tag must be alphanumeric", /TAG/],
    ["Operating pressure and temperature must be numbers", /número/],
  ])("traduce el mensaje conocido %s", (mensaje, esperado) => {
    const traducido = traducirMensajeError(mensaje)
    expect(traducido).not.toBe(mensaje)
    expect(traducido).toMatch(esperado)
  })

  it("traduce los permisos de administrador por prefijo", () => {
    expect(traducirMensajeError("Only an active Administrador can schedule a visit")).toMatch(
      /administrador activo/i,
    )
  })

  it("traduce los errores del cierre de la visita del Taller (D13)", () => {
    const cierre = traducirMensajeError(
      "Every evaluated work order requires a complete certificate before visit completion",
    )
    expect(cierre).toMatch(/certificado/)
    expect(cierre).not.toMatch(/(every|requires|before|completion)/i)
    for (const mensaje of [
      "A visit signature cannot be replaced",
      "A Técnico signature is required to complete a visit",
      "The Técnico is not assigned to this visit Taller Móvil",
      "The Técnico is not assigned to the visit Taller Móvil",
      "An in-person Cliente signature must be captured before the Técnico signature",
      "Certificate drafts can be started only while the visit is in progress",
      "Certificate capture is closed",
    ])
      expect(traducirMensajeError(mensaje)).not.toBe(mensaje)
  })

  it.each([
    ["Only an in-progress visit can be completed", /en curso/],
    ["An offline operation dependency is not synchronized", /sincroniz/],
  ])("traduce el error de cierre y sincronización %s", (mensaje, esperado) => {
    const traducido = traducirMensajeError(mensaje)
    expect(traducido).not.toBe(mensaje)
    expect(traducido).toMatch(esperado)
  })

  it.each([
    ["Unsupported storage content type", /formato/i],
    ["Invalid storage object size", /10 MB/],
    ["A Parte diario image file is required", /foto del Parte Diario/],
    ["A valid alphanumeric Parte diario code is required", /alfanumérico/],
  ])("traduce el error de fotos y Parte Diario %s", (mensaje, esperado) => {
    const traducido = traducirMensajeError(mensaje)
    expect(traducido).not.toBe(mensaje)
    expect(traducido).toMatch(esperado)
  })

  it("traduce el rechazo a aceptar un conflicto de firma (P1)", () => {
    expect(
      traducirMensajeError(
        "An Administrador cannot accept a visit-signature operation; reject it or authorize a certificate correction",
      ),
    ).toMatch(/Rechazar/)
  })

  it.each([
    [
      "The visit was closed at the end of its day and requires finalization",
      /venció.*Requiere finalización/,
    ],
    [
      "Correction resolution requires a Taller Móvil and visit start/end times",
      /taller.*inicio y fin/i,
    ],
  ])("traduce el conflicto de una visita vencida y la corrección (E3) %s", (mensaje, esperado) => {
    const traducido = traducirMensajeError(mensaje)
    expect(traducido).not.toBe(mensaje)
    expect(traducido).toMatch(esperado)
  })

  it.each([
    ["Only an active Administrador can close a visit that requires finalization", /Administrador/],
    ["A closing reason of 1 to 1000 characters is required", /motivo/],
    ["A closing reason is required (1 to 1000 characters)", /motivo/],
    [
      "Only a visit that requires finalization can be closed by an Administrador",
      /Requiere finalización/,
    ],
    ["Resolve the synchronization conflicts of this visit before closing it", /conflictos/],
    [
      "A follow-up visit for the unevaluated Válvulas requires a Taller Móvil and start/end times",
      /taller.*horario estimado.*seguimiento/i,
    ],
  ])("traduce el cierre administrativo de una visita vencida (E4) %s", (mensaje, esperado) => {
    const traducido = traducirMensajeError(mensaje)
    expect(traducido).not.toBe(mensaje)
    expect(traducido).toMatch(esperado)
  })

  it("pide completar la visita en curso antes de iniciar otra del mismo taller", () => {
    expect(
      traducirMensajeError(
        "The Taller Móvil already has a visit in progress; complete it before starting another",
      ),
    ).toMatch(/otra visita en curso.*Completá/)
  })

  it("traduce los errores del trabajo de campo del taller", () => {
    expect(
      traducirMensajeError(
        "Every work order must have an explicit outcome before visit completion",
      ),
    ).toMatch(/Evaluada.*No evaluada/)
    expect(traducirMensajeError("A no evaluada work order requires a reason")).toMatch(/motivo/)
    expect(traducirMensajeError("Another device is already working on this visit")).toMatch(
      /otro dispositivo/,
    )
    expect(
      traducirMensajeError("Only an evaluated work order can create a certificate draft"),
    ).toMatch(/Evaluada/)
  })

  it("conserva los mensajes desconocidos y los que ya están en español", () => {
    expect(traducirMensajeError("Algo inesperado")).toBe("Algo inesperado")
    expect(traducirMensajeError("requestId must be a UUID")).toBe("requestId must be a UUID")
  })
})

import { describe, expect, it } from "vitest"

import type { VisitaOffline } from "@/lib/offline/sync"

import {
  avisoDeCierreSinTarjeta,
  otraVisitaEnCurso,
  visitaEnCurso,
  visitaIniciada,
  visitaRequiereFinalizacion,
} from "./estado-visita"

describe("visitaIniciada", () => {
  it("una visita en curso, local o en el servidor, está iniciada", () => {
    expect(visitaIniciada({ estadoLocal: "en_curso_local" })).toBe(true)
    expect(visitaIniciada({ estadoLocal: "disponible", backendStatus: "en_curso" })).toBe(true)
    expect(visitaIniciada({ estadoLocal: "disponible" }, "en_curso")).toBe(true)
  })

  it("una visita completada sin conexión sigue mostrándose iniciada (cerrada), no para volver a iniciar", () => {
    expect(visitaIniciada({ estadoLocal: "completada_local", backendStatus: "aceptada" })).toBe(true)
  })

  it("una visita aceptada sin iniciar no está iniciada", () => {
    expect(visitaIniciada({ estadoLocal: "disponible", backendStatus: "aceptada" }, "aceptada")).toBe(false)
  })
})

describe("visita en «Requiere finalización» (E4)", () => {
  it("se inició: el panel no vuelve a ofrecer iniciarla", () => {
    expect(
      visitaIniciada({ estadoLocal: "disponible", backendStatus: "requiere_finalizacion" }),
    ).toBe(true)
    expect(visitaIniciada({ estadoLocal: "disponible" }, "requiere_finalizacion")).toBe(true)
  })

  it("se reconoce por el estado del servidor, aunque se haya completado localmente", () => {
    expect(visitaRequiereFinalizacion({ backendStatus: "requiere_finalizacion" })).toBe(true)
    expect(visitaRequiereFinalizacion({ backendStatus: "en_curso" }, "requiere_finalizacion")).toBe(
      true,
    )
    expect(visitaRequiereFinalizacion({ backendStatus: "en_curso" }, "en_curso")).toBe(false)
  })
})

describe("una visita en curso por taller", () => {
  const visita = (
    id: string,
    estadoLocal: VisitaOffline["estadoLocal"],
    backendStatus?: string,
  ): VisitaOffline => ({
    id,
    context: { visit: { estado: backendStatus } },
    cachedAt: "2026-11-17T12:00:00.000Z",
    estadoLocal,
    synchronizationPending: false,
    backendStatus,
  })

  it("cuenta como abierta una visita iniciada en el dispositivo o en el servidor", () => {
    expect(visitaEnCurso(visita("a", "en_curso_local", "aceptada"))).toBe(true)
    expect(visitaEnCurso(visita("a", "disponible", "en_curso"))).toBe(true)
  })

  it("no cuenta las completadas (también sin conexión), las vencidas ni las no iniciadas", () => {
    expect(visitaEnCurso(visita("a", "completada_local", "en_curso"))).toBe(false)
    expect(visitaEnCurso(visita("a", "disponible", "completada"))).toBe(false)
    expect(visitaEnCurso(visita("a", "disponible", "requiere_finalizacion"))).toBe(false)
    expect(visitaEnCurso(visita("a", "disponible", "aceptada"))).toBe(false)
  })

  it("encuentra otra visita en curso del taller, sin contar la propia", () => {
    const abierta = visita("a", "en_curso_local", "en_curso")
    const lista = [abierta, visita("b", "disponible", "aceptada")]
    expect(otraVisitaEnCurso(lista, "b")).toBe(abierta)
    expect(otraVisitaEnCurso(lista, "a")).toBeUndefined()
  })
})

describe("avisoDeCierreSinTarjeta", () => {
  const aviso = { visitId: "v1", texto: "Visita completada y enviada al backend." }

  it("muestra el aviso cuando la visita completada ya salió de la agenda", () => {
    expect(avisoDeCierreSinTarjeta(aviso, [{ id: "v2" }])).toBe(aviso.texto)
    expect(avisoDeCierreSinTarjeta(aviso, [])).toBe(aviso.texto)
  })

  it("no lo repite mientras la tarjeta de la visita siga a la vista", () => {
    expect(avisoDeCierreSinTarjeta(aviso, [{ id: "v1" }, { id: "v2" }])).toBeUndefined()
  })

  it("sin aviso no muestra nada", () => {
    expect(avisoDeCierreSinTarjeta(undefined, [])).toBeUndefined()
  })
})

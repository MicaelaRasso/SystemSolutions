import { describe, expect, it } from "vitest"

import type { ArbolYacimiento } from "@/lib/domain/types"

import { CREAR, elegirNivel, etiquetaCrear, opcionesDe, type Ubicacion } from "./ubicacion-logica"

const VACIA: Ubicacion = { empresaId: "", yacimientoId: "", plantaId: "", equipoId: "" }

const equipo = (id: string) => ({ id, plantaId: "p", nombre: id, valvulas: [] })
const planta = (id: string, equipos: ReturnType<typeof equipo>[] = []) =>
  ({ id, yacimientoId: "y", nombre: id, equipos }) as ArbolYacimiento["plantas"][number]
const yacimiento = (id: string, plantas: ArbolYacimiento["plantas"] = []) =>
  ({ id, empresaId: "e", nombre: id, provincia: "Neuquén", operadora: "", plantas }) as ArbolYacimiento

describe("etiquetaCrear", () => {
  it("no ofrece crear en un nivel sin parent elegido", () => {
    expect(etiquetaCrear("yacimientoId", VACIA)).toBeNull()
    expect(etiquetaCrear("plantaId", { ...VACIA, empresaId: "e" })).toBeNull()
  })

  it("ofrece crear cliente siempre", () => {
    expect(etiquetaCrear("empresaId", VACIA)).toBe("Agregar cliente")
  })

  it("ofrece yacimiento con cliente y planta con yacimiento", () => {
    expect(etiquetaCrear("yacimientoId", { ...VACIA, empresaId: "e" })).toBe("Agregar yacimiento")
    expect(etiquetaCrear("plantaId", { ...VACIA, empresaId: "e", yacimientoId: "y" })).toBe(
      "Agregar planta / locación",
    )
  })

  it("ofrece crear equipo solo con planta elegida", () => {
    expect(
      etiquetaCrear("equipoId", { empresaId: "e", yacimientoId: "y", plantaId: "p", equipoId: "" }),
    ).toBe("Agregar equipo / unidad")
    expect(
      etiquetaCrear("equipoId", { empresaId: "e", yacimientoId: "y", plantaId: "", equipoId: "" }),
    ).toBeNull()
  })

  it("el valor centinela no puede ser un id real", () => {
    expect(CREAR).toMatch(/^__/)
  })
})

describe("opcionesDe", () => {
  it("lista plantas y equipos del nivel elegido", () => {
    const arbol = [yacimiento("y", [planta("p", [equipo("q")])])]
    const v = { ...VACIA, yacimientoId: "y", plantaId: "p" }
    expect(opcionesDe("yacimientoId", v, arbol)).toEqual([{ id: "y", label: "y" }])
    expect(opcionesDe("plantaId", v, arbol)).toEqual([{ id: "p", label: "p" }])
    expect(opcionesDe("equipoId", v, arbol)).toEqual([{ id: "q", label: "q" }])
  })
})

describe("elegirNivel", () => {
  it("limpia los niveles de abajo al elegir un nivel", () => {
    const v = { empresaId: "e", yacimientoId: "y", plantaId: "p", equipoId: "q" }
    expect(elegirNivel(v, "empresaId", "otra", undefined)).toEqual({ ...VACIA, empresaId: "otra" })
  })

  it("autocompleta los niveles con opción única", () => {
    const arbol = [yacimiento("y", [planta("p", [equipo("q")])])]
    const v = { ...VACIA, empresaId: "e" }
    expect(elegirNivel(v, "yacimientoId", "y", arbol)).toEqual({
      empresaId: "e",
      yacimientoId: "y",
      plantaId: "p",
      equipoId: "q",
    })
  })

  it("corta el autocompletado cuando hay más de una opción", () => {
    const arbol = [yacimiento("y", [planta("p1"), planta("p2")])]
    const v = { ...VACIA, empresaId: "e" }
    expect(elegirNivel(v, "yacimientoId", "y", arbol)).toEqual({
      ...VACIA,
      empresaId: "e",
      yacimientoId: "y",
    })
  })

  it("un yacimiento recién creado (aún sin plantas ni en el árbol) queda elegido y vacío abajo", () => {
    const v = { empresaId: "e", yacimientoId: "", plantaId: "", equipoId: "" }
    expect(elegirNivel(v, "yacimientoId", "nuevo", [yacimiento("otro")])).toEqual({
      ...VACIA,
      empresaId: "e",
      yacimientoId: "nuevo",
    })
  })

  it("un cliente nuevo no autocompleta nada", () => {
    const arbol = [yacimiento("y", [planta("p")])]
    expect(elegirNivel(VACIA, "empresaId", "nuevo", arbol)).toEqual({ ...VACIA, empresaId: "nuevo" })
  })
})

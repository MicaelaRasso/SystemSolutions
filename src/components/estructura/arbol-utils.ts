import { Cog, Factory, Gauge, MapPinned, type LucideIcon } from "lucide-react"

import type {
  ArbolEquipo,
  ArbolPlanta,
  ArbolValvula,
  ArbolYacimiento,
  ID,
  NivelEstructura,
} from "@/lib/domain/types"

export interface Seleccion {
  nivel: NivelEstructura
  id: ID
}

export const NIVEL: Record<NivelEstructura, { label: string; icono: LucideIcon }> = {
  yacimiento: { label: "Yacimiento", icono: MapPinned },
  planta: { label: "Planta / Locación", icono: Factory },
  equipo: { label: "Equipo / Unidad", icono: Cog },
  valvula: { label: "Válvula", icono: Gauge },
}

export const claveNodo = (s: Seleccion) => `${s.nivel}:${s.id}`

export function parsearSeleccion(valor: string | null): Seleccion | null {
  if (!valor) return null
  const [nivel, id] = valor.split(":")
  if (!id || !(nivel in NIVEL)) return null
  return { nivel: nivel as NivelEstructura, id }
}

export interface Ubicacion {
  yacimiento: ArbolYacimiento
  planta?: ArbolPlanta
  equipo?: ArbolEquipo
  valvula?: ArbolValvula
}

/** Devuelve el nodo seleccionado junto con sus ancestros, o null si ya no existe. */
export function ubicar(arbol: ArbolYacimiento[], sel: Seleccion): Ubicacion | null {
  for (const yacimiento of arbol) {
    if (sel.nivel === "yacimiento" && yacimiento.id === sel.id) return { yacimiento }
    for (const planta of yacimiento.plantas) {
      if (sel.nivel === "planta" && planta.id === sel.id) return { yacimiento, planta }
      for (const equipo of planta.equipos) {
        if (sel.nivel === "equipo" && equipo.id === sel.id) return { yacimiento, planta, equipo }
        for (const valvula of equipo.valvulas) {
          if (sel.nivel === "valvula" && valvula.id === sel.id) {
            return { yacimiento, planta, equipo, valvula }
          }
        }
      }
    }
  }
  return null
}

/** Claves de los ancestros de la selección (para expandirlos en el árbol). */
export function ancestros(u: Ubicacion): string[] {
  const claves = [claveNodo({ nivel: "yacimiento", id: u.yacimiento.id })]
  if (u.planta) claves.push(claveNodo({ nivel: "planta", id: u.planta.id }))
  if (u.equipo) claves.push(claveNodo({ nivel: "equipo", id: u.equipo.id }))
  return claves
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/**
 * Filtra el árbol por texto (nombre, TAG, serie). Conserva los ancestros de cada coincidencia
 * y, si coincide un contenedor, todo su contenido.
 */
export function filtrarArbol(arbol: ArbolYacimiento[], q: string): ArbolYacimiento[] {
  const t = norm(q.trim())
  if (!t) return arbol
  const hit = (...campos: (string | undefined)[]) => campos.some((c) => c && norm(c).includes(t))

  return arbol.flatMap((y) => {
    if (hit(y.nombre, y.operadora)) return [y]
    const plantas = y.plantas.flatMap((p) => {
      if (hit(p.nombre)) return [p]
      const equipos = p.equipos.flatMap((e) => {
        if (hit(e.nombre, e.descripcion)) return [e]
        const valvulas = e.valvulas.filter((v) => hit(v.tag, v.nroSerie, v.marca))
        return valvulas.length ? [{ ...e, valvulas }] : []
      })
      return equipos.length ? [{ ...p, equipos }] : []
    })
    return plantas.length ? [{ ...y, plantas }] : []
  })
}

export function contar(arbol: ArbolYacimiento[]) {
  let plantas = 0
  let equipos = 0
  let valvulas = 0
  for (const y of arbol) {
    plantas += y.plantas.length
    for (const p of y.plantas) {
      equipos += p.equipos.length
      for (const e of p.equipos) valvulas += e.valvulas.length
    }
  }
  return { yacimientos: arbol.length, plantas, equipos, valvulas }
}

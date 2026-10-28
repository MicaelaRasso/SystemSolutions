import type { ArbolYacimiento } from "@/lib/domain/types"

export interface Ubicacion {
  empresaId: string
  yacimientoId: string
  plantaId: string
  equipoId: string
}

export type Clave = keyof Ubicacion

export const NIVELES: { clave: Clave; label: string; placeholder: string }[] = [
  { clave: "empresaId", label: "Cliente", placeholder: "Elegí el cliente" },
  { clave: "yacimientoId", label: "Yacimiento", placeholder: "Elegí el yacimiento" },
  { clave: "plantaId", label: "Planta / locación", placeholder: "Elegí la planta" },
  { clave: "equipoId", label: "Equipo / unidad", placeholder: "Elegí el equipo" },
]

/**
 * Valor de la opción «+ Agregar …» dentro del desplegable. Nunca se guarda como valor del
 * campo: la selección lo intercepta y abre el diálogo de alta.
 */
export const CREAR = "__crear__"

/**
 * Niveles que pueden crear un elemento nuevo desde el desplegable. Cada uno necesita además su
 * diálogo montado en `UbicacionCascade`.
 */
const NIVELES_CREABLES: Partial<Record<Clave, string>> = {
  empresaId: "Agregar cliente",
  yacimientoId: "Agregar yacimiento",
  plantaId: "Agregar planta / locación",
  equipoId: "Agregar equipo / unidad",
}

/** Texto de la opción de alta del nivel, o null si no corresponde ofrecerla todavía. */
export function etiquetaCrear(clave: Clave, v: Ubicacion): string | null {
  const etiqueta = NIVELES_CREABLES[clave]
  if (!etiqueta) return null
  const i = NIVELES.findIndex((n) => n.clave === clave)
  return i === 0 || v[NIVELES[i - 1].clave] ? etiqueta : null
}

export function opcionesDe(clave: Clave, v: Ubicacion, arbol: ArbolYacimiento[] | undefined) {
  const yac = arbol?.find((y) => y.id === v.yacimientoId)
  const pla = yac?.plantas.find((p) => p.id === v.plantaId)
  switch (clave) {
    case "yacimientoId":
      return arbol?.map((y) => ({ id: y.id, label: y.nombre })) ?? []
    case "plantaId":
      return yac?.plantas.map((p) => ({ id: p.id, label: p.nombre })) ?? []
    case "equipoId":
      return (
        pla?.equipos.map((e) => ({
          id: e.id,
          label: e.descripcion ? `${e.nombre} · ${e.descripcion}` : e.nombre,
        })) ?? []
      )
    default:
      return []
  }
}

/**
 * Elige un valor en un nivel: limpia los de abajo y, si el siguiente tiene una sola opción,
 * la elige sola (el árbol del cliente ya está cargado). Sirve tanto para una selección del
 * usuario como para un elemento recién creado.
 */
export function elegirNivel(
  v: Ubicacion,
  clave: Clave,
  id: string,
  arbol: ArbolYacimiento[] | undefined,
): Ubicacion {
  const i = NIVELES.findIndex((n) => n.clave === clave)
  const next = { ...v, [clave]: id }
  NIVELES.slice(i + 1).forEach((n) => (next[n.clave] = ""))
  if (clave !== "empresaId") {
    for (const n of NIVELES.slice(i + 1)) {
      const ops = opcionesDe(n.clave, next, arbol)
      if (ops.length !== 1) break
      next[n.clave] = ops[0].id
    }
  }
  return next
}

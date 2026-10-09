/**
 * Visitas de servicio vistas por el Cliente (calendario y turnos, RF-35, RF-39). Lógica pura
 * sobre la lectura canónica `GET /visits`, que el backend filtra por el alcance de cada
 * usuario del Cliente; locación y equipo se resuelven con los árboles de sus Yacimientos.
 */

import type { OperationStatus, VisitDto } from "@/lib/api/contracts"

const ZONA = "America/Argentina/Buenos_Aires"

const fechaLocal = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: ZONA,
})
const horaLocal = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONA,
})

export interface VisitaCliente {
  id: string
  /** Día de la visita en Argentina, AAAA-MM-DD. */
  fecha: string
  horario: string
  inicio: string
  yacimientoId: string
  yacimiento: string
  /** "Planta · Equipo" de las Válvulas incluidas, sin repetir. */
  ubicaciones: string[]
  plantaIds: string[]
  tallerAsignado: boolean
  estado: OperationStatus
  /** Válvulas (órdenes de trabajo) incluidas en la visita. */
  valvulas: number
}

export const ESTADOS_PENDIENTES: OperationStatus[] = [
  "solicitada",
  "programada",
  "aceptada",
  "en_curso",
]
export const ESTADOS_HISTORICOS: OperationStatus[] = ["completada", "cancelada"]

/** Color del punto del calendario según el estado, alineado con los badges de estado. */
export const COLOR_ESTADO_VISITA: Record<OperationStatus, string> = {
  solicitada: "#d97706",
  programada: "#0284c7",
  aceptada: "#0d9488",
  en_curso: "#7c3aed",
  completada: "#059669",
  cancelada: "#a1a1aa",
}

interface ArbolMinimo {
  id: string
  nombre: string
  plantas: {
    id: string
    nombre: string
    equipos: { id: string; nombre: string; valvulas: { id: string }[] }[]
  }[]
}

export interface ContextoVisitas {
  yacimientos: Map<string, string>
  valvulas: Map<string, { plantaId: string; planta: string; equipo: string }>
}

/** Índices de nombres a partir de los árboles de Yacimientos del Cliente. */
export function contextoDeArboles(arboles: ArbolMinimo[]): ContextoVisitas {
  const contexto: ContextoVisitas = { yacimientos: new Map(), valvulas: new Map() }
  for (const arbol of arboles) {
    contexto.yacimientos.set(arbol.id, arbol.nombre)
    for (const planta of arbol.plantas)
      for (const equipo of planta.equipos)
        for (const valvula of equipo.valvulas)
          contexto.valvulas.set(valvula.id, {
            plantaId: planta.id,
            planta: planta.nombre,
            equipo: equipo.nombre,
          })
  }
  return contexto
}

const texto = (value: unknown) => (typeof value === "string" ? value : "")

export function aVisitaCliente(dto: VisitDto, contexto: ContextoVisitas): VisitaCliente {
  const visita = dto.visit
  const startsAt = texto(visita.starts_at)
  const endsAt = texto(visita.ends_at)
  const inicio = new Date(startsAt)
  const fin = new Date(endsAt)
  const yacimientoId = texto(visita.yacimiento_id)
  const ubicaciones = new Set<string>()
  const plantaIds = new Set<string>()
  for (const orden of dto.work_orders) {
    const lugar = orden.valvula_id ? contexto.valvulas.get(orden.valvula_id) : undefined
    if (!lugar) continue
    ubicaciones.add(`${lugar.planta} · ${lugar.equipo}`)
    plantaIds.add(lugar.plantaId)
  }
  const horario = (fecha: Date) =>
    Number.isNaN(fecha.getTime()) ? "--:--" : horaLocal.format(fecha)
  return {
    id: visita.id,
    fecha: Number.isNaN(inicio.getTime()) ? "" : fechaLocal.format(inicio),
    horario: `${horario(inicio)}–${horario(fin)}`,
    inicio: startsAt,
    yacimientoId,
    yacimiento: contexto.yacimientos.get(yacimientoId) ?? "Yacimiento sin acceso",
    ubicaciones: [...ubicaciones],
    plantaIds: [...plantaIds],
    tallerAsignado: typeof visita.taller_movil_id === "string" && visita.taller_movil_id !== "",
    estado: visita.estado ?? "solicitada",
    valvulas: dto.work_orders.length,
  }
}

const porInicio = (a: VisitaCliente, b: VisitaCliente) =>
  a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.id.localeCompare(b.id)

/** Pendientes en orden cronológico; histórico (completadas y canceladas) del más reciente. */
export function separarTurnos(visitas: VisitaCliente[]) {
  return {
    pendientes: visitas.filter((v) => ESTADOS_PENDIENTES.includes(v.estado)).sort(porInicio),
    historico: visitas
      .filter((v) => ESTADOS_HISTORICOS.includes(v.estado))
      .sort((a, b) => porInicio(b, a)),
  }
}

export interface FiltroVisitas {
  yacimientoId?: string
  plantaId?: string
  /** AAAA-MM-DD inclusivo. */
  desde?: string
  /** AAAA-MM-DD inclusivo. */
  hasta?: string
}

export function filtrarVisitas(visitas: VisitaCliente[], filtro: FiltroVisitas) {
  return visitas.filter(
    (v) =>
      (!filtro.yacimientoId || v.yacimientoId === filtro.yacimientoId) &&
      (!filtro.plantaId || v.plantaIds.includes(filtro.plantaId)) &&
      (!filtro.desde || v.fecha >= filtro.desde) &&
      (!filtro.hasta || v.fecha <= filtro.hasta),
  )
}

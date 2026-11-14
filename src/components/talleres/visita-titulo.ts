/**
 * Título legible de una visita del taller. La lista de visitas solo trae identificadores; los
 * nombres salen del resumen de la operación (`GET /operations`). Nunca se muestra un UUID.
 */

import { fmtFechaHoraArgentina } from "@/lib/format"

export interface ResumenVisita {
  cliente?: { nombre?: string }
  yacimiento?: { nombre?: string }
  plantas?: { nombre?: string }[]
  contacto?: string
  telefono?: string
  /** PD/RTO cargado en la tarea: se precarga como número de Parte Diario de la visita. */
  pdRto?: string
  /** Número de la Solicitud de servicio: referencia para el Taller, también sin conexión (RF-19). */
  numeroSolicitud?: number
}

export interface VisitaParaTitulo {
  id: string
  starts_at?: unknown
}

export interface TituloVisita {
  titulo: string
  /** Líneas secundarias ya armadas (contacto · teléfono), vacías si no hay datos. */
  lineas: string[]
  contacto?: string
  telefono?: string
  /** «Solicitud N° X» cuando se conoce el número de la solicitud (RF-19). */
  referencia?: string
}

const SEPARADOR = " · "

function limpio(valor: string | undefined) {
  const texto = valor?.trim()
  return texto ? texto : undefined
}

/** Día y hora de la visita en hora argentina (24 h, sin segundos). */
const formatearFecha = fmtFechaHoraArgentina

function nombrePlanta(plantas: ResumenVisita["plantas"]) {
  const nombres = (plantas ?? []).map((planta) => limpio(planta.nombre)).filter(Boolean) as string[]
  if (nombres.length === 0) return undefined
  return nombres.length > 1 ? `${nombres[0]} +${nombres.length - 1}` : nombres[0]
}

export function tituloDeVisita(visita: VisitaParaTitulo, operacion?: ResumenVisita): TituloVisita {
  const partes = operacion
    ? [
        limpio(operacion.cliente?.nombre),
        limpio(operacion.yacimiento?.nombre),
        nombrePlanta(operacion.plantas),
      ]
    : []
  const nombres = partes.filter(Boolean) as string[]

  const fecha = formatearFecha(visita.starts_at)
  const titulo = nombres.length
    ? nombres.join(SEPARADOR)
    : fecha
      ? `Visita del ${fecha}`
      : "Visita sin fecha informada"

  const contacto = limpio(operacion?.contacto)
  const telefono = limpio(operacion?.telefono)
  const linea = [contacto, telefono].filter(Boolean).join(SEPARADOR)

  const referencia =
    typeof operacion?.numeroSolicitud === "number"
      ? `Solicitud N° ${operacion.numeroSolicitud}`
      : undefined

  return {
    titulo,
    lineas: linea ? [linea] : [],
    contacto,
    telefono,
    ...(referencia ? { referencia } : {}),
  }
}

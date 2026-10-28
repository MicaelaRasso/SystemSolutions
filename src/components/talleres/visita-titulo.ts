/**
 * Título legible de una visita del taller. La lista de visitas solo trae identificadores; los
 * nombres salen del resumen de la operación (`GET /operations`). Nunca se muestra un UUID.
 */

export interface ResumenVisita {
  cliente?: { nombre?: string }
  yacimiento?: { nombre?: string }
  plantas?: { nombre?: string }[]
  contacto?: string
  telefono?: string
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
}

const SEPARADOR = " · "

function limpio(valor: string | undefined) {
  const texto = valor?.trim()
  return texto ? texto : undefined
}

function formatearFecha(valor: unknown) {
  if (typeof valor !== "string") return undefined
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return undefined
  const partes = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha)
  const dato = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? ""
  return `${dato("day")}/${dato("month")}/${dato("year")} ${dato("hour")}:${dato("minute")}`
}

function nombrePlanta(plantas: ResumenVisita["plantas"]) {
  const nombres = (plantas ?? []).map((planta) => limpio(planta.nombre)).filter(Boolean) as string[]
  if (nombres.length === 0) return undefined
  return nombres.length > 1 ? `${nombres[0]} +${nombres.length - 1}` : nombres[0]
}

export function tituloDeVisita(visita: VisitaParaTitulo, operacion?: ResumenVisita): TituloVisita {
  const partes = operacion
    ? [limpio(operacion.cliente?.nombre), limpio(operacion.yacimiento?.nombre), nombrePlanta(operacion.plantas)]
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

  return { titulo, lineas: linea ? [linea] : [], contacto, telefono }
}

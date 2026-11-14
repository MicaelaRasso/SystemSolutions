import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"

/** 2026-02-04 → 04/02/2026 */
export const fmtFecha = (iso: string) => format(parseISO(iso), "dd/MM/yyyy", { locale: es })

/** 2026-02-04T18:00 → 04/02/2026 15:00 (hora local) */
export const fmtFechaHora = (iso: string) =>
  format(parseISO(iso), "dd/MM/yyyy HH:mm", { locale: es })

export const nombreCompleto = (p: { nombre: string; apellido: string }) =>
  `${p.nombre} ${p.apellido}`.trim()

export const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n} ${n === 1 ? singular : pluralForm}`

export const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires"

const fechaHoraArgentina = (segundos: boolean) =>
  new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_ARGENTINA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(segundos ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  })
const formatoMinutos = fechaHoraArgentina(false)
const formatoSegundos = fechaHoraArgentina(true)

/**
 * Instante (timestamp ISO o `Date`) → «13/11/2026 16:00» en hora argentina y 24 h, sin importar la
 * zona del dispositivo. `toLocaleString("es-AR")` usaba la zona del navegador y, según el motor,
 * mostraba las 16:00 como «04:00:00». Sin segundos salvo `{ segundos: true }` (auditoría, donde la
 * hora exacta importa: RNF-12). Devuelve `undefined` si no es una fecha.
 */
export function fmtFechaHoraArgentina(
  valor: unknown,
  { segundos = false }: { segundos?: boolean } = {},
): string | undefined {
  if (typeof valor !== "string" && !(valor instanceof Date)) return undefined
  const fecha = typeof valor === "string" ? new Date(valor) : valor
  if (Number.isNaN(fecha.getTime())) return undefined
  const partes = (segundos ? formatoSegundos : formatoMinutos).formatToParts(fecha)
  const dato = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? ""
  const hora = `${dato("hour")}:${dato("minute")}${segundos ? `:${dato("second")}` : ""}`
  return `${dato("day")}/${dato("month")}/${dato("year")} ${hora}`
}

import { addDays, addMonths, addYears, format, startOfMonth } from "date-fns"
import { es } from "date-fns/locale"

import { lunesDe } from "@/lib/fechas"

/**
 * Lógica pura del selector de fechas. Trabaja con strings `yyyy-MM-dd` (el formato de las fechas
 * del dominio) y con fechas locales, para que nunca haya corrimientos por zona horaria.
 */

const PATRON_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** Fecha local a medianoche, o `null` si el texto no es una fecha `yyyy-MM-dd` real. */
export function parsearIso(valor: string | undefined | null): Date | null {
  const m = PATRON_ISO.exec(valor ?? "")
  if (!m) return null
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(anio, mes - 1, dia)
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null
  return d
}

/** `yyyy-MM-dd` con los componentes locales de la fecha. */
export const isoDeFecha = (d: Date) => format(d, "yyyy-MM-dd")

export interface DiaGrilla {
  iso: string
  dia: number
  fueraDeMes: boolean
}

/**
 * Las 6 semanas (42 días, de lunes a domingo) que muestra el calendario para el mes de `fecha`.
 * Siempre 6 filas, así el popover no cambia de alto al pasar de mes.
 */
export function grillaMes(fecha: string): DiaGrilla[] {
  const base = parsearIso(fecha) ?? new Date()
  const mes = base.getMonth()
  const inicio = lunesDe(startOfMonth(base))
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(inicio, i)
    return { iso: isoDeFecha(d), dia: d.getDate(), fueraDeMes: d.getMonth() !== mes }
  })
}

const limite = (v?: string) => (parsearIso(v) ? v : undefined)

/** `true` si la fecha queda antes de `min` o después de `max` (ambos inclusive). */
export function fueraDeRango(fecha: string, min?: string, max?: string): boolean {
  const desde = limite(min)
  const hasta = limite(max)
  return (!!desde && fecha < desde) || (!!hasta && fecha > hasta)
}

export function ajustarARango(fecha: string, min?: string, max?: string): string {
  const desde = limite(min)
  const hasta = limite(max)
  if (desde && fecha < desde) return desde
  if (hasta && fecha > hasta) return hasta
  return fecha
}

/**
 * Fecha a la que mueve el foco una tecla dentro de la grilla (patrón de WAI-ARIA para
 * selectores de fecha). `null` si la tecla no navega.
 */
export function moverFoco(fecha: string, tecla: string, shift = false): string | null {
  const d = parsearIso(fecha)
  if (!d) return null
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  switch (tecla) {
    case "ArrowLeft":
      return isoDeFecha(addDays(d, -1))
    case "ArrowRight":
      return isoDeFecha(addDays(d, 1))
    case "ArrowUp":
      return isoDeFecha(addDays(d, -7))
    case "ArrowDown":
      return isoDeFecha(addDays(d, 7))
    case "Home":
      return isoDeFecha(addDays(d, -dow))
    case "End":
      return isoDeFecha(addDays(d, 6 - dow))
    case "PageUp":
      return isoDeFecha(shift ? addYears(d, -1) : addMonths(d, -1))
    case "PageDown":
      return isoDeFecha(shift ? addYears(d, 1) : addMonths(d, 1))
    default:
      return null
  }
}

/** Día que recibe el foco al abrir: el elegido o, si no hay, hoy dentro del rango permitido. */
export function fechaInicialFoco(valor: string, hoy: string, min?: string, max?: string): string {
  return parsearIso(valor) ? valor : ajustarARango(hoy, min, max)
}

const fmtEs = (fecha: string, patron: string) => {
  const d = parsearIso(fecha)
  return d ? format(d, patron, { locale: es }) : ""
}

/** "mar, 13 oct 2026": compacta, con el día de la semana para programar sin dudar. */
export const formatoVisible = (fecha: string) => fmtEs(fecha, "EEE, d MMM yyyy")

/** "martes 13 de octubre de 2026", para lectores de pantalla. */
export const etiquetaDia = (fecha: string) => fmtEs(fecha, "EEEE d 'de' MMMM 'de' yyyy")

/** "octubre 2026" */
export const tituloMes = (fecha: string) => fmtEs(fecha, "MMMM yyyy")

/** Primer día del mes de `fecha`, como `yyyy-MM-dd`. */
export const inicioDeMes = (fecha: string) =>
  isoDeFecha(startOfMonth(parsearIso(fecha) ?? new Date()))

/** Mismo día de referencia desplazado `n` meses (para los botones de mes anterior/siguiente). */
export const sumarMeses = (fecha: string, n: number) =>
  isoDeFecha(addMonths(parsearIso(fecha) ?? new Date(), n))

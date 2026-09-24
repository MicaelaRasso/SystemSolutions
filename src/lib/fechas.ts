import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { es } from "date-fns/locale"

/** Fecha local como YYYY-MM-DD (formato de las fechas del dominio). */
export const iso = (d: Date) => format(d, "yyyy-MM-dd")
export const hoyIso = () => iso(new Date())

/** La semana laboral arranca el lunes. */
export const lunesDe = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

/** Los 7 días (lunes a domingo) de la semana que contiene `d`. */
export function diasSemana(d: Date): Date[] {
  const lunes = lunesDe(d)
  return Array.from({ length: 7 }, (_, i) => addDays(lunes, i))
}

/** Días visibles en una grilla mensual: semanas completas de lunes a domingo. */
export function diasGrillaMes(mes: Date): Date[] {
  const inicio = lunesDe(startOfMonth(mes))
  const fin = endOfWeek(endOfMonth(mes), { weekStartsOn: 1 })
  const dias: Date[] = []
  for (let d = inicio; d <= fin; d = addDays(d, 1)) dias.push(d)
  return dias
}

export const fmt = (fecha: Date | string, patron: string) =>
  format(typeof fecha === "string" ? parseISO(fecha) : fecha, patron, { locale: es })

/** "lunes 22 de septiembre" */
export const fmtDiaLargo = (fecha: Date | string) => fmt(fecha, "EEEE d 'de' MMMM")

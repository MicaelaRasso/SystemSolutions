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

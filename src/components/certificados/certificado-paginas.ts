import { ANCHO_HOJA_A4_PX } from "./certificado-escala"

const PX_POR_MM = 96 / 25.4

/** Alto de la hoja A4 (297 mm) en píxeles CSS a 96 dpi. */
export const ALTO_HOJA_A4_PX = (ANCHO_HOJA_A4_PX * 297) / 210

/** Margen de cada hoja del PDF (10 mm, igual que `@page` en `globals.css`) en píxeles CSS. */
export const MARGEN_HOJA_PX = 10 * PX_POR_MM

/** Tramo vertical del documento (en píxeles CSS, desde su borde superior). */
export interface Tramo {
  desde: number
  hasta: number
}

/** Sección que conviene no partir entre hojas (`[data-certificado-seccion]`). */
export interface Bloque {
  inicio: number
  fin: number
}

/**
 * Reparte el documento en hojas A4, igual que la impresión: la primera hoja usa el margen
 * superior propio del documento y deja `margen` abajo; las siguientes dejan `margen` arriba y
 * abajo. Una sección que entra en una hoja no se parte (como `break-inside: avoid`): si quedaría
 * cortada, la hoja termina donde empieza la sección. Si la sección es más alta que una hoja, se
 * corta por el alto de la hoja.
 */
export function cortarEnPaginas({
  altoTotal,
  altoPagina,
  margen,
  bloques,
}: {
  altoTotal: number
  altoPagina: number
  margen: number
  bloques: Bloque[]
}): Tramo[] {
  if (!(altoTotal > 0)) return [{ desde: 0, hasta: 0 }]
  const utilSiguientes = altoPagina - 2 * margen
  const tramos: Tramo[] = []
  let desde = 0
  while (desde < altoTotal) {
    const util = tramos.length === 0 ? altoPagina - margen : utilSiguientes
    let hasta = Math.min(altoTotal, desde + util)
    if (hasta < altoTotal) {
      let cortado: Bloque | undefined
      while (
        (cortado = bloques.find(
          (b) =>
            b.inicio > desde &&
            b.inicio < hasta &&
            b.fin > hasta &&
            b.fin - b.inicio <= utilSiguientes,
        ))
      ) {
        hasta = cortado.inicio
      }
    }
    tramos.push({ desde, hasta })
    desde = hasta
  }
  return tramos
}

/** Área máxima de lienzo segura en todos los navegadores (Safari en iOS limita a ~16,7 Mpx). */
const AREA_MAXIMA_LIENZO = 16_000_000

/**
 * Densidad de la captura: `deseada` (nitidez para imprimir) salvo que el lienzo de `ancho` ×
 * `alto` píxeles CSS supere el área que el navegador puede dibujar; entonces se reduce.
 */
export function densidadCaptura(ancho: number, alto: number, deseada = 2): number {
  if (!(ancho > 0) || !(alto > 0)) return deseada
  return Math.min(deseada, Math.sqrt(AREA_MAXIMA_LIENZO / (ancho * alto)))
}

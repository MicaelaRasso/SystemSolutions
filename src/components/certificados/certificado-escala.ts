/** Ancho de la hoja A4 (210 mm) en píxeles CSS a 96 dpi. */
export const ANCHO_HOJA_A4_PX = (210 / 25.4) * 96

/**
 * Escala con la que la hoja entra completa en `anchoDisponible` píxeles. Nunca agranda (máximo 1)
 * y, ante una medida inválida, conserva el tamaño real.
 */
export function escalaParaAncho(anchoDisponible: number): number {
  if (!(anchoDisponible > 0)) return 1
  return Math.min(1, anchoDisponible / ANCHO_HOJA_A4_PX)
}

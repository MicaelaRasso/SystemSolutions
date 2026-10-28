/** Planta (locación) a la que va una visita, tal como la informa el resumen de la operación. */
export interface PlantaDeOperacion {
  id: string
  nombre: string
}

/**
 * Nombres de las plantas de una visita, en el orden recibido, sin vacíos ni repetidos.
 * Un backend sin la migración no envía `plantas`: queda la lista vacía.
 */
export function nombresDePlantas(
  plantas: readonly Partial<PlantaDeOperacion>[] | undefined,
): string[] {
  const nombres: string[] = []
  for (const planta of plantas ?? []) {
    const nombre = planta.nombre?.trim()
    if (nombre && !nombres.includes(nombre)) nombres.push(nombre)
  }
  return nombres
}

/** «Planta Norte» o «Planta Norte +2» cuando la visita pasa por varias plantas. */
export function resumenPlantas(nombres: readonly string[]): string {
  if (nombres.length === 0) return ""
  return nombres.length === 1 ? nombres[0] : `${nombres[0]} +${nombres.length - 1}`
}

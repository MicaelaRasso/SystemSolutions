/**
 * Columna del cronograma que se muestra en el celular, donde cabe un taller por vez. Conserva la
 * elegida mientras exista; si no, empieza por el primer taller real (no por «Sin asignar»).
 */
export function columnaMovilVigente(
  ids: string[],
  elegido: string | null,
  sinTaller: string,
): string {
  if (elegido && ids.includes(elegido)) return elegido
  return ids.find((id) => id !== sinTaller) ?? ids[0] ?? ""
}

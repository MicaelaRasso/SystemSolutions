/** Motivo listo para enviar: sin espacios en los extremos, o `null` si quedó vacío. */
export function normalizarMotivo(texto: string): string | null {
  const limpio = texto.trim()
  return limpio ? limpio : null
}

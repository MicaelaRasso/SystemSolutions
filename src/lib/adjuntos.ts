import type { Adjunto } from "@/lib/domain/types"

/**
 * Abre un adjunto de demo en otra pestaña. Production media must be fetched by
 * an Edge-mediated capability; this helper deliberately rejects remote URLs so
 * browser code cannot turn a Storage URL into an application-data boundary.
 */
export async function abrirAdjunto(adjunto: Adjunto) {
  let url = adjunto.url
  if (!url.startsWith("data:")) throw new Error("Los adjuntos remotos requieren una ruta Edge")
  const blob = await (await fetch(url)).blob()
  url = URL.createObjectURL(blob)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  window.open(url, "_blank", "noopener")
}

import type { Adjunto } from "@/lib/domain/types"

/**
 * Opens a data URL or a short-lived URL issued by the authenticated Edge API.
 */
export async function abrirAdjunto(adjunto: Adjunto) {
  if (adjunto.url.startsWith("data:")) {
    const blob = await (await fetch(adjunto.url)).blob()
    const url = URL.createObjectURL(blob)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    window.open(url, "_blank", "noopener")
    return
  }
  if (!/^https:\/\//.test(adjunto.url)) throw new Error("El enlace del adjunto no es válido")
  window.open(adjunto.url, "_blank", "noopener")
}

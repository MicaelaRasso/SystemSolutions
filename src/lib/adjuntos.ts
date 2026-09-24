import type { Adjunto } from "@/lib/domain/types"

/**
 * Abre un adjunto en otra pestaña. En modo demo la URL es un data URL, que los navegadores no
 * permiten abrir directo: se convierte a blob. Con Supabase será una URL firmada de Storage.
 */
export async function abrirAdjunto(adjunto: Adjunto) {
  let url = adjunto.url
  if (url.startsWith("data:")) {
    const blob = await (await fetch(url)).blob()
    url = URL.createObjectURL(blob)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  window.open(url, "_blank", "noopener")
}

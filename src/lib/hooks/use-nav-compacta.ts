import { useSyncExternalStore } from "react"

/**
 * Ancho desde el cual el menú lateral queda fijo a la vista. Por debajo (celular y tablet vertical)
 * el menú es un panel que se abre con el botón del encabezado: así el contenido usa todo el ancho
 * y los cortes `md:` del contenido coinciden con el espacio real disponible.
 */
export const NAV_FIJA_DESDE_PX = 1024

export const consultaNavCompacta = (desde = NAV_FIJA_DESDE_PX) => `(max-width: ${desde - 1}px)`

function suscribir(onChange: () => void) {
  const mql = window.matchMedia(consultaNavCompacta())
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/** `true` cuando el menú lateral debe mostrarse como panel (por debajo de `NAV_FIJA_DESDE_PX`). */
export function useNavCompacta() {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(consultaNavCompacta()).matches,
    () => false,
  )
}

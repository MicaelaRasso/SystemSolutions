/**
 * Estado de instalación de la PWA, fuera de React para consumirlo con `useSyncExternalStore`.
 * El navegador dispara `beforeinstallprompt` una sola vez y puede hacerlo antes de que exista el
 * botón, así que el listener queda registrado al evaluar este módulo.
 */

/** `desconocido` solo existe en el servidor: ahí no se puede saber si corre instalada. */
export type EstadoInstalacion = "desconocido" | "manual" | "prompt" | "instalada"
export type ResultadoInstalacion = "aceptada" | "rechazada" | "error" | "manual"
export type PlataformaInstalacion = "ios" | "general"

interface EventoInstalacion extends Event {
  prompt(): Promise<unknown>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export interface VentanaInstalacion extends EventTarget {
  matchMedia(consulta: string): Pick<MediaQueryList, "matches" | "addEventListener">
  /** Solo existe en Safari de iOS. */
  navigator: { standalone?: boolean }
}

export interface StoreInstalacion {
  subscribe(oyente: () => void): () => void
  getSnapshot(): EstadoInstalacion
  getServerSnapshot(): EstadoInstalacion
  instalar(): Promise<ResultadoInstalacion>
}

const getServerSnapshot = (): EstadoInstalacion => "desconocido"

export function crearStoreInstalacion(ventana: VentanaInstalacion): StoreInstalacion {
  const modoApp = ventana.matchMedia("(display-mode: standalone)")
  const oyentes = new Set<() => void>()
  let instalada = modoApp.matches || ventana.navigator.standalone === true
  let avisoNativo: EventoInstalacion | null = null

  const avisar = () => oyentes.forEach((oyente) => oyente())
  const marcarInstalada = () => {
    instalada = true
    avisoNativo = null
    avisar()
  }

  ventana.addEventListener("beforeinstallprompt", (evento) => {
    // Sin esto Chrome muestra su propia barra; la instalación la ofrece el botón.
    evento.preventDefault()
    avisoNativo = evento as EventoInstalacion
    avisar()
  })
  ventana.addEventListener("appinstalled", marcarInstalada)
  modoApp.addEventListener("change", () => {
    if (modoApp.matches) marcarInstalada()
  })

  return {
    subscribe(oyente) {
      oyentes.add(oyente)
      return () => oyentes.delete(oyente)
    },
    getSnapshot: () => (instalada ? "instalada" : avisoNativo ? "prompt" : "manual"),
    getServerSnapshot,
    async instalar() {
      const evento = avisoNativo
      if (!evento) return "manual"
      // El evento sirve una sola vez, cualquiera sea el resultado.
      avisoNativo = null
      avisar()
      try {
        await evento.prompt()
        const { outcome } = await evento.userChoice
        if (outcome === "accepted") {
          marcarInstalada()
          return "aceptada"
        }
        return "rechazada"
      } catch {
        return "error"
      }
    },
  }
}

export function plataformaInstalacion(navegador: {
  userAgent: string
  maxTouchPoints: number
}): PlataformaInstalacion {
  const { userAgent, maxTouchPoints } = navegador
  // El iPad se presenta como Mac; lo delata la pantalla táctil.
  const esIos =
    /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  return esIos ? "ios" : "general"
}

const storeDelServidor: StoreInstalacion = {
  subscribe: () => () => {},
  getSnapshot: getServerSnapshot,
  getServerSnapshot,
  instalar: async () => "manual",
}

export const instalacionPwa =
  typeof window === "undefined"
    ? storeDelServidor
    : crearStoreInstalacion(window as unknown as VentanaInstalacion)

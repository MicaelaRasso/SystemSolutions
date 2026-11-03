import { describe, expect, it, vi } from "vitest"

import {
  crearStoreInstalacion,
  plataformaInstalacion,
  type VentanaInstalacion,
} from "./install-store"

function ventanaFalsa({
  standalone = false,
  iosStandalone,
}: { standalone?: boolean; iosStandalone?: boolean } = {}) {
  const consulta = Object.assign(new EventTarget(), { matches: standalone })
  const ventana = Object.assign(new EventTarget(), {
    matchMedia: vi.fn(() => consulta),
    navigator: { standalone: iosStandalone },
  })
  return { ventana: ventana as unknown as VentanaInstalacion, consulta }
}

function eventoInstalacion(outcome: "accepted" | "dismissed" = "accepted") {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  })
}

describe("store de instalación de la PWA", () => {
  it("en el servidor no conoce el estado, para no mostrar el botón dentro de la app instalada", () => {
    const { ventana } = ventanaFalsa()
    expect(crearStoreInstalacion(ventana).getServerSnapshot()).toBe("desconocido")
  })

  it("sin evento nativo queda en instalación manual", () => {
    const { ventana } = ventanaFalsa()
    expect(crearStoreInstalacion(ventana).getSnapshot()).toBe("manual")
  })

  it("captura beforeinstallprompt, evita la barra nativa y avisa a los suscriptores", () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    const oyente = vi.fn()
    store.subscribe(oyente)

    const evento = eventoInstalacion()
    ventana.dispatchEvent(evento)

    expect(evento.defaultPrevented).toBe(true)
    expect(store.getSnapshot()).toBe("prompt")
    expect(oyente).toHaveBeenCalled()
  })

  it("instalar llama a prompt() y queda instalada si el usuario acepta", async () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    const evento = eventoInstalacion("accepted")
    ventana.dispatchEvent(evento)

    await expect(store.instalar()).resolves.toBe("aceptada")

    expect(evento.prompt).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toBe("instalada")
  })

  it("si el usuario rechaza, el evento se descarta y vuelve a instalación manual", async () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    ventana.dispatchEvent(eventoInstalacion("dismissed"))

    await expect(store.instalar()).resolves.toBe("rechazada")

    expect(store.getSnapshot()).toBe("manual")
  })

  it("informa el error si prompt() falla", async () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    const evento = eventoInstalacion()
    evento.prompt.mockRejectedValueOnce(new Error("sin gesto del usuario"))
    ventana.dispatchEvent(evento)

    await expect(store.instalar()).resolves.toBe("error")
  })

  it("sin evento nativo, instalar pide las instrucciones manuales", async () => {
    const { ventana } = ventanaFalsa()
    await expect(crearStoreInstalacion(ventana).instalar()).resolves.toBe("manual")
  })

  it("appinstalled la marca como instalada", () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    const oyente = vi.fn()
    store.subscribe(oyente)

    ventana.dispatchEvent(new Event("appinstalled"))

    expect(store.getSnapshot()).toBe("instalada")
    expect(oyente).toHaveBeenCalled()
  })

  it("detecta display-mode standalone y navigator.standalone de iOS", () => {
    expect(crearStoreInstalacion(ventanaFalsa({ standalone: true }).ventana).getSnapshot()).toBe(
      "instalada",
    )
    expect(crearStoreInstalacion(ventanaFalsa({ iosStandalone: true }).ventana).getSnapshot()).toBe(
      "instalada",
    )
  })

  it("reacciona si el modo de visualización cambia a standalone", () => {
    const { ventana, consulta } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    consulta.matches = true
    consulta.dispatchEvent(new Event("change"))
    expect(store.getSnapshot()).toBe("instalada")
  })

  it("subscribe devuelve la baja del oyente", () => {
    const { ventana } = ventanaFalsa()
    const store = crearStoreInstalacion(ventana)
    const oyente = vi.fn()
    store.subscribe(oyente)()
    ventana.dispatchEvent(new Event("appinstalled"))
    expect(oyente).not.toHaveBeenCalled()
  })
})

describe("plataformaInstalacion", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"

  it("reconoce iPhone y el iPad que se presenta como Mac", () => {
    expect(plataformaInstalacion({ userAgent: iphone, maxTouchPoints: 5 })).toBe("ios")
    expect(plataformaInstalacion({ userAgent: mac, maxTouchPoints: 5 })).toBe("ios")
  })

  it("el resto usa las instrucciones generales", () => {
    expect(plataformaInstalacion({ userAgent: mac, maxTouchPoints: 0 })).toBe("general")
    expect(
      plataformaInstalacion({ userAgent: "Mozilla/5.0 Firefox/130.0", maxTouchPoints: 0 }),
    ).toBe("general")
  })
})

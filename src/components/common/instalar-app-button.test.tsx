import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ejecutarInstalacion,
  InstalarAppButton,
  InstalarAppVista,
  InstruccionesInstalacion,
} from "./instalar-app-button"

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const noop = () => {}
const vista = (estado: "desconocido" | "manual" | "prompt" | "instalada") =>
  renderToStaticMarkup(
    <InstalarAppVista estado={estado} plataforma={null} onInstalar={noop} onCerrar={noop} />,
  )

describe("botón de instalar la app", () => {
  beforeEach(() => vi.clearAllMocks())

  it("se ve con el aviso nativo y también sin él", () => {
    expect(vista("prompt")).toContain("Instalar app")
    expect(vista("manual")).toContain("Instalar app")
  })

  it("no se dibuja dentro de la app instalada ni en el render del servidor", () => {
    expect(vista("instalada")).toBe("")
    expect(vista("desconocido")).toBe("")
    expect(renderToStaticMarkup(<InstalarAppButton />)).toBe("")
  })

  it("sin aviso nativo abre las instrucciones y no muestra toast", async () => {
    const abrir = vi.fn()
    await ejecutarInstalacion(async () => "manual", abrir)
    expect(abrir).toHaveBeenCalledOnce()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("con aviso nativo informa el resultado por toast, sin abrir instrucciones", async () => {
    const abrir = vi.fn()
    await ejecutarInstalacion(async () => "aceptada", abrir)
    expect(toast.success).toHaveBeenCalledOnce()
    await ejecutarInstalacion(async () => "rechazada", abrir)
    expect(toast.info).toHaveBeenCalledOnce()
    expect(abrir).not.toHaveBeenCalled()
  })

  it("si el aviso nativo falla informa el error y ofrece las instrucciones", async () => {
    const abrir = vi.fn()
    await ejecutarInstalacion(async () => "error", abrir)
    expect(toast.error).toHaveBeenCalledOnce()
    expect(abrir).toHaveBeenCalledOnce()
  })

  it("explica el camino de iOS y el general", () => {
    const ios = renderToStaticMarkup(<InstruccionesInstalacion plataforma="ios" />)
    expect(ios).toContain("Compartir")
    expect(ios).toContain("Agregar a inicio")
    const general = renderToStaticMarkup(<InstruccionesInstalacion plataforma="general" />)
    expect(general).toContain("menú del navegador")
  })
})

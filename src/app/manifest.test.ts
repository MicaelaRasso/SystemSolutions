import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import manifest from "./manifest"

const COLOR_HEX = /^#[0-9a-f]{6}$/i

function tamanoPng(ruta: string) {
  const png = readFileSync(ruta)
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
}

describe("manifest de la PWA", () => {
  const datos = manifest()

  it("declara lo que los navegadores exigen para instalar", () => {
    expect(datos.name).toBe("System Solutions")
    expect(datos.short_name).toBeTruthy()
    expect(datos.description).toBeTruthy()
    expect(datos.lang).toBe("es")
    expect(datos.start_url).toBe("/")
    expect(datos.display).toBe("standalone")
    expect(datos.theme_color).toMatch(COLOR_HEX)
    expect(datos.background_color).toMatch(COLOR_HEX)
  })

  it("incluye iconos 192, 512 y maskable 512", () => {
    const iconos = datos.icons ?? []
    expect(iconos.map((i) => [i.sizes, i.purpose ?? "any"])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ])
  })

  it("cada icono existe en public/ con el tamaño declarado", () => {
    for (const icono of datos.icons ?? []) {
      const ruta = join(process.cwd(), "public", icono.src)
      expect(existsSync(ruta), icono.src).toBe(true)
      expect(tamanoPng(ruta), icono.src).toBe(icono.sizes)
    }
  })

  it("incluye el icono táctil de Apple", () => {
    const ruta = join(process.cwd(), "public", "icons", "apple-touch-icon.png")
    expect(existsSync(ruta)).toBe(true)
    expect(tamanoPng(ruta)).toBe("180x180")
  })
})

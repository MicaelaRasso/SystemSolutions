import { describe, expect, it, vi } from "vitest"

import {
  ERROR_IMAGEN_GRANDE,
  ERROR_IMAGEN_ILEGIBLE,
  MAX_BYTES_IMAGEN,
  dimensionesDestino,
  necesitaProcesar,
  nombreJpeg,
  prepararImagen,
  type HerramientasImagen,
} from "./preparar-imagen"

const MB = 1024 * 1024

/** Archivo de prueba con el tamaño pedido, sin reservar memoria real para cada byte. */
function archivo(nombre: string, tipo: string, bytes: number) {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo })
}

function herramientas(opciones: {
  ancho?: number
  alto?: number
  bytesSalida?: number
  tipoSalida?: string
  falla?: "decodificar" | "codificar"
}): HerramientasImagen & {
  decodificar: ReturnType<typeof vi.fn>
  codificarJpeg: ReturnType<typeof vi.fn>
} {
  const liberar = vi.fn()
  return {
    decodificar: vi.fn(async () => {
      if (opciones.falla === "decodificar") throw new Error("formato no soportado")
      return {
        ancho: opciones.ancho ?? 4000,
        alto: opciones.alto ?? 3000,
        fuente: {} as CanvasImageSource,
        liberar,
      }
    }),
    codificarJpeg: vi.fn(async () => {
      if (opciones.falla === "codificar") throw new Error("sin canvas")
      return new Blob([new Uint8Array(opciones.bytesSalida ?? 500_000)], {
        type: opciones.tipoSalida ?? "image/jpeg",
      })
    }),
  }
}

describe("necesitaProcesar", () => {
  it("deja pasar JPG, PNG y WEBP livianos", () => {
    expect(necesitaProcesar({ type: "image/jpeg", size: 800_000 })).toBe(false)
    expect(necesitaProcesar({ type: "image/png", size: 200_000 })).toBe(false)
    expect(necesitaProcesar({ type: "image/webp", size: 1_000_000 })).toBe(false)
  })

  it("procesa formatos que el servidor rechaza (HEIC, sin tipo)", () => {
    expect(necesitaProcesar({ type: "image/heic", size: 900_000 })).toBe(true)
    expect(necesitaProcesar({ type: "image/heif", size: 900_000 })).toBe(true)
    expect(necesitaProcesar({ type: "", size: 900_000 })).toBe(true)
  })

  it("procesa las fotos pesadas aunque el formato sea aceptado", () => {
    expect(necesitaProcesar({ type: "image/jpeg", size: 4 * MB })).toBe(true)
  })
})

describe("dimensionesDestino", () => {
  it("reduce el lado más largo a 2000 px y conserva la proporción", () => {
    expect(dimensionesDestino(4000, 3000)).toEqual({ ancho: 2000, alto: 1500 })
    expect(dimensionesDestino(3024, 4032)).toEqual({ ancho: 1500, alto: 2000 })
  })

  it("no agranda las imágenes chicas", () => {
    expect(dimensionesDestino(1200, 800)).toEqual({ ancho: 1200, alto: 800 })
  })

  it("nunca devuelve un lado de 0 px", () => {
    expect(dimensionesDestino(10_000, 1)).toEqual({ ancho: 2000, alto: 1 })
  })
})

describe("nombreJpeg", () => {
  it("cambia la extensión por .jpg", () => {
    expect(nombreJpeg("IMG_0001.HEIC")).toBe("IMG_0001.jpg")
    expect(nombreJpeg("parte.diario.png")).toBe("parte.diario.jpg")
    expect(nombreJpeg("sin-extension")).toBe("sin-extension.jpg")
  })

  it("usa un nombre genérico si el archivo no tiene nombre", () => {
    expect(nombreJpeg("")).toBe("foto.jpg")
    expect(nombreJpeg(undefined)).toBe("foto.jpg")
  })
})

describe("prepararImagen", () => {
  it("devuelve el mismo archivo si ya es liviano y aceptado", async () => {
    const original = archivo("parte.png", "image/png", 50_000)
    const h = herramientas({})
    await expect(prepararImagen(original, h)).resolves.toBe(original)
    expect(h.decodificar).not.toHaveBeenCalled()
  })

  it("convierte un HEIC a JPG reducido", async () => {
    const h = herramientas({ ancho: 4032, alto: 3024, bytesSalida: 600_000 })
    const resultado = await prepararImagen(archivo("IMG_1.HEIC", "image/heic", 2 * MB), h)
    expect(resultado.type).toBe("image/jpeg")
    expect(resultado.name).toBe("IMG_1.jpg")
    expect(resultado.size).toBe(600_000)
    expect(h.codificarJpeg).toHaveBeenCalledWith(expect.anything(), 2000, 1500, 0.82)
  })

  it("reduce una foto pesada de la cámara", async () => {
    const h = herramientas({ bytesSalida: 700_000 })
    const resultado = await prepararImagen(archivo("camara.jpg", "image/jpeg", 6 * MB), h)
    expect(resultado.size).toBe(700_000)
    expect(resultado.name).toBe("camara.jpg")
  })

  it("conserva el original aceptado si la conversión no lo achica", async () => {
    const original = archivo("foto.jpg", "image/jpeg", 2 * MB)
    const h = herramientas({ bytesSalida: 3 * MB })
    await expect(prepararImagen(original, h)).resolves.toBe(original)
  })

  it("explica en español cuando no puede leer un formato no aceptado", async () => {
    const h = herramientas({ falla: "decodificar" })
    await expect(prepararImagen(archivo("IMG_1.HEIC", "image/heic", 2 * MB), h)).rejects.toThrow(
      ERROR_IMAGEN_ILEGIBLE,
    )
  })

  it("sube el original aceptado si el navegador no puede procesarlo", async () => {
    const original = archivo("foto.jpg", "image/jpeg", 3 * MB)
    await expect(prepararImagen(original, herramientas({ falla: "decodificar" }))).resolves.toBe(original)
    await expect(prepararImagen(original, herramientas({ falla: "codificar" }))).resolves.toBe(original)
  })

  it("rechaza el original aceptado de más de 10 MB si no se pudo reducir", async () => {
    const h = herramientas({ falla: "codificar" })
    await expect(
      prepararImagen(archivo("enorme.jpg", "image/jpeg", MAX_BYTES_IMAGEN + 1), h),
    ).rejects.toThrow(ERROR_IMAGEN_GRANDE)
  })

  it("trata como falla una salida que no es JPG", async () => {
    const h = herramientas({ tipoSalida: "image/png" })
    await expect(prepararImagen(archivo("IMG_1.HEIC", "image/heic", 2 * MB), h)).rejects.toThrow(
      ERROR_IMAGEN_ILEGIBLE,
    )
  })

  it("rechaza en español una salida de más de 10 MB", async () => {
    const h = herramientas({ bytesSalida: MAX_BYTES_IMAGEN + 1 })
    await expect(prepararImagen(archivo("IMG_1.HEIC", "image/heic", 12 * MB), h)).rejects.toThrow(
      ERROR_IMAGEN_GRANDE,
    )
  })
})

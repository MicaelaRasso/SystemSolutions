/**
 * Normaliza una foto elegida en el celular antes de subirla o guardarla sin conexión.
 *
 * El servidor solo acepta JPG, PNG o WEBP de hasta 10 MB (`supabase/functions/_shared/storage.ts`),
 * pero las cámaras de los celulares generan HEIC/HEIF (iPhone) o JPG de varios MB. Esta función
 * reduce la imagen a un lado máximo de 2000 px y la vuelve a codificar como JPG. La decisión
 * (procesar o no, tamaño destino, nombre) es pura y está testeada; el paso de canvas es delgado.
 */

export const TIPOS_IMAGEN_ACEPTADOS: readonly string[] = ["image/jpeg", "image/png", "image/webp"]
export const MAX_BYTES_IMAGEN = 10 * 1024 * 1024
/** Por debajo de este peso, un formato aceptado se sube tal cual. */
export const UMBRAL_BYTES_SIN_PROCESAR = 1.5 * 1024 * 1024
export const LADO_MAXIMO_IMAGEN = 2000
export const CALIDAD_JPEG = 0.82

export const ERROR_IMAGEN_ILEGIBLE =
  "No se pudo leer la imagen. Probá sacar la foto desde la cámara o elegir un JPG o PNG."
export const ERROR_IMAGEN_GRANDE =
  "La imagen pesa más de 10 MB incluso después de reducirla. Probá con otra foto."

export type ImagenDecodificada = {
  ancho: number
  alto: number
  fuente: CanvasImageSource
  liberar?: () => void
}

export type HerramientasImagen = {
  decodificar: (archivo: Blob) => Promise<ImagenDecodificada>
  codificarJpeg: (
    imagen: ImagenDecodificada,
    ancho: number,
    alto: number,
    calidad: number,
  ) => Promise<Blob>
}

export const esTipoAceptado = (tipo: string) => TIPOS_IMAGEN_ACEPTADOS.includes(tipo.toLowerCase())

export function necesitaProcesar(archivo: { type: string; size: number }): boolean {
  return !esTipoAceptado(archivo.type) || archivo.size > UMBRAL_BYTES_SIN_PROCESAR
}

export function dimensionesDestino(
  ancho: number,
  alto: number,
  ladoMaximo = LADO_MAXIMO_IMAGEN,
): { ancho: number; alto: number } {
  const escala = Math.min(1, ladoMaximo / Math.max(ancho, alto))
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  }
}

export function nombreJpeg(nombre: string | undefined): string {
  const base = (nombre ?? "").trim().replace(/\.[^./\\]+$/, "")
  return `${base || "foto"}.jpg`
}

export async function prepararImagen(
  archivo: File,
  herramientas: HerramientasImagen = herramientasNavegador,
): Promise<File> {
  if (!necesitaProcesar(archivo)) return archivo

  // Si el navegador no puede procesar un formato que el servidor igual acepta, se sube el original.
  const respaldo = () => {
    if (!esTipoAceptado(archivo.type)) throw new Error(ERROR_IMAGEN_ILEGIBLE)
    if (archivo.size > MAX_BYTES_IMAGEN) throw new Error(ERROR_IMAGEN_GRANDE)
    return archivo
  }

  let imagen: ImagenDecodificada
  try {
    imagen = await herramientas.decodificar(archivo)
    if (!imagen.ancho || !imagen.alto) throw new Error("Imagen vacía")
  } catch {
    return respaldo()
  }

  let salida: Blob
  try {
    const destino = dimensionesDestino(imagen.ancho, imagen.alto)
    salida = await herramientas.codificarJpeg(imagen, destino.ancho, destino.alto, CALIDAD_JPEG)
    if (salida.type && salida.type !== "image/jpeg") throw new Error("El navegador no generó un JPG")
  } catch {
    return respaldo()
  } finally {
    imagen.liberar?.()
  }

  if (esTipoAceptado(archivo.type) && salida.size >= archivo.size) return respaldo()
  if (salida.size > MAX_BYTES_IMAGEN) throw new Error(ERROR_IMAGEN_GRANDE)
  return new File([salida], nombreJpeg(archivo.name), {
    type: "image/jpeg",
    lastModified: archivo.lastModified,
  })
}

async function decodificarEnNavegador(archivo: Blob): Promise<ImagenDecodificada> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" })
      return { ancho: bitmap.width, alto: bitmap.height, fuente: bitmap, liberar: () => bitmap.close() }
    } catch {
      // Algunos navegadores no aceptan las opciones o el formato; se intenta con <img>.
    }
  }
  const url = URL.createObjectURL(archivo)
  try {
    const imagen = new Image()
    imagen.src = url
    await imagen.decode()
    return {
      ancho: imagen.naturalWidth,
      alto: imagen.naturalHeight,
      fuente: imagen,
      liberar: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function codificarJpegEnNavegador(
  imagen: ImagenDecodificada,
  ancho: number,
  alto: number,
  calidad: number,
): Promise<Blob> {
  // Fondo blanco: un PNG con transparencia quedaría negro al pasar a JPG.
  const pintar = (contexto: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    contexto.fillStyle = "#ffffff"
    contexto.fillRect(0, 0, ancho, alto)
    contexto.drawImage(imagen.fuente, 0, 0, ancho, alto)
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const lienzo = new OffscreenCanvas(ancho, alto)
    const contexto = lienzo.getContext("2d")
    if (contexto) {
      pintar(contexto)
      return lienzo.convertToBlob({ type: "image/jpeg", quality: calidad })
    }
  }
  const lienzo = document.createElement("canvas")
  lienzo.width = ancho
  lienzo.height = alto
  const contexto = lienzo.getContext("2d")
  if (!contexto) throw new Error("Canvas no disponible")
  pintar(contexto)
  return new Promise((resolve, reject) =>
    lienzo.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo codificar la imagen"))),
      "image/jpeg",
      calidad,
    ),
  )
}

export const herramientasNavegador: HerramientasImagen = {
  decodificar: decodificarEnNavegador,
  codificarJpeg: codificarJpegEnNavegador,
}

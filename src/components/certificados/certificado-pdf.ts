import { ANCHO_HOJA_A4_PX } from "./certificado-escala"
import {
  ALTO_HOJA_A4_PX,
  MARGEN_HOJA_PX,
  cortarEnPaginas,
  densidadCaptura,
  type Bloque,
} from "./certificado-paginas"

const MM_POR_PX = 210 / ANCHO_HOJA_A4_PX

/**
 * Reemplaza cada imagen por su contenido en `data:` y espera a que esté decodificada. Las firmas,
 * fotos y el logo del cliente son direcciones firmadas de Supabase Storage (otro origen): dibujadas
 * tal cual, el lienzo queda "contaminado" o la imagen sale vacía. Descargarlas con `fetch` (Storage
 * responde con CORS abierto) y embeberlas evita ambos problemas. Si alguna no se puede leer se
 * corta con error: un certificado sin la firma o las fotos no debe salir como si estuviera completo.
 */
async function embeberImagenes(raiz: HTMLElement): Promise<void> {
  const imagenes = [...raiz.querySelectorAll("img")]
  await Promise.all(
    imagenes.map(async (imagen) => {
      const src = imagen.currentSrc || imagen.src
      if (src && !src.startsWith("data:")) {
        const respuesta = await fetch(src, { mode: "cors", credentials: "omit" })
        if (!respuesta.ok) throw new Error(`No se pudo leer la imagen (${respuesta.status}).`)
        const datos = await leerComoDataUrl(await respuesta.blob())
        imagen.removeAttribute("srcset")
        imagen.src = datos
      }
      await imagen.decode()
    }),
  )
}

function leerComoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(String(lector.result))
    lector.onerror = () => rechazar(lector.error)
    lector.readAsDataURL(blob)
  })
}

/** Secciones que la impresión no parte (`break-inside: avoid`), relativas al borde de la hoja. */
function medirSecciones(hoja: HTMLElement): Bloque[] {
  const tope = hoja.getBoundingClientRect().top
  return [...hoja.querySelectorAll<HTMLElement>("[data-certificado-seccion]")].map((seccion) => {
    const caja = seccion.getBoundingClientRect()
    return { inicio: caja.top - tope, fin: caja.bottom - tope }
  })
}

/**
 * Arma el PDF A4 a partir de la hoja del certificado montada a tamaño real (sin escalar) y lo
 * descarga como `<nombreArchivo>.pdf`. La hoja se rasteriza con `html-to-image` (entiende los
 * colores `oklch()` de Tailwind v4) y se reparte en hojas con los mismos cortes que la impresión.
 * Si `marca` existe (la leyenda "REQUIERE FIRMA" del tamaño de una hoja) se estampa en cada hoja,
 * como hace la impresión. Las bibliotecas se cargan recién al generar.
 */
export async function descargarPdfCertificado({
  hoja,
  marca,
  nombreArchivo,
}: {
  hoja: HTMLElement
  marca: HTMLElement | null
  nombreArchivo: string
}): Promise<void> {
  const [{ toCanvas, toPng }, { jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ])
  await document.fonts.ready
  await embeberImagenes(hoja)

  const ancho = hoja.offsetWidth
  const alto = hoja.offsetHeight
  const densidad = densidadCaptura(ancho, alto)
  const opciones = { pixelRatio: densidad, backgroundColor: "#ffffff", includeQueryParams: true }
  const lienzo = await toCanvas(hoja, {
    ...opciones,
    // La leyenda va aparte, una por hoja.
    filter: (nodo) => !(nodo instanceof HTMLElement && nodo.hasAttribute("data-certificado-marca")),
  })
  const imagenMarca = marca
    ? await toPng(marca, { pixelRatio: 1.5, includeQueryParams: true })
    : null

  const tramos = cortarEnPaginas({
    altoTotal: alto,
    altoPagina: ALTO_HOJA_A4_PX,
    margen: MARGEN_HOJA_PX,
    bloques: medirSecciones(hoja),
  })
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })
  const escalaX = lienzo.width / ancho
  const escalaY = lienzo.height / alto
  tramos.forEach((tramo, i) => {
    if (i > 0) pdf.addPage("a4", "portrait")
    const recorte = document.createElement("canvas")
    recorte.width = lienzo.width
    recorte.height = Math.max(1, Math.round((tramo.hasta - tramo.desde) * escalaY))
    const contexto = recorte.getContext("2d")
    if (!contexto) throw new Error("El navegador no permite dibujar el PDF.")
    contexto.fillStyle = "#ffffff"
    contexto.fillRect(0, 0, recorte.width, recorte.height)
    contexto.drawImage(lienzo, 0, -Math.round(tramo.desde * escalaY))
    const arriba = i === 0 ? 0 : MARGEN_HOJA_PX * MM_POR_PX
    pdf.addImage(
      recorte.toDataURL("image/jpeg", 0.92),
      "JPEG",
      0,
      arriba,
      (recorte.width / escalaX) * MM_POR_PX,
      (tramo.hasta - tramo.desde) * MM_POR_PX,
      undefined,
      "FAST",
    )
    if (imagenMarca) pdf.addImage(imagenMarca, "PNG", 0, 0, 210, 297, "marca", "FAST")
  })
  await pdf.save(`${nombreArchivo}.pdf`, { returnPromise: true })
}

import { crc32, deflateSync } from "node:zlib"

/**
 * Imágenes PNG generadas en memoria para las fotos, firmas y el logo de demo. Son dibujos simples
 * (franjas, trazos), distintos entre sí para que en el certificado se note cuál es cuál.
 */

type Rgb = readonly [number, number, number]

function png(ancho: number, alto: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const filas = Buffer.alloc((ancho * 3 + 1) * alto)
  for (let y = 0; y < alto; y += 1) {
    const inicio = y * (ancho * 3 + 1)
    filas[inicio] = 0
    for (let x = 0; x < ancho; x += 1) {
      const [r, g, b] = pixel(x, y)
      filas[inicio + 1 + x * 3] = r
      filas[inicio + 2 + x * 3] = g
      filas[inicio + 3 + x * 3] = b
    }
  }
  const bloque = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos])
    const control = Buffer.alloc(4)
    control.writeUInt32BE(crc32(cuerpo))
    return Buffer.concat([largo, cuerpo, control])
  }
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(ancho, 0)
  cabecera.writeUInt32BE(alto, 4)
  cabecera[8] = 8 // bits por canal
  cabecera[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", cabecera),
    bloque("IDAT", deflateSync(filas)),
    bloque("IEND", Buffer.alloc(0)),
  ])
}

const BLANCO: Rgb = [255, 255, 255]
const TINTA: Rgb = [20, 40, 110]

/** Foto de evidencia: fondo de color con franjas diagonales. */
export function fotoDemo(color: Rgb) {
  const sombra: Rgb = [
    Math.round(color[0] * 0.7),
    Math.round(color[1] * 0.7),
    Math.round(color[2] * 0.7),
  ]
  return png(160, 120, (x, y) => ((x + y) % 24 < 12 ? color : sombra))
}

/** Hoja del Parte Diario: papel claro con renglones. */
export function parteDiarioDemo() {
  return png(120, 160, (x, y) =>
    y % 16 === 0 && x > 8 && x < 112 ? [150, 160, 180] : [250, 248, 240],
  )
}

/** Firma: un trazo ondulado sobre fondo blanco. */
export function firmaDemo(fase = 0) {
  const ancho = 240
  const alto = 80
  return png(ancho, alto, (x, y) => {
    const curva = alto / 2 + Math.sin(x / 14 + fase) * 18 * Math.sin((x / ancho) * Math.PI)
    return x > 16 && x < ancho - 16 && Math.abs(y - curva) < 2 ? TINTA : BLANCO
  })
}

/** Logo del Cliente: un círculo de color con un anillo. */
export function logoDemo(color: Rgb) {
  const lado = 128
  return png(lado, lado, (x, y) => {
    const distancia = Math.hypot(x - lado / 2, y - lado / 2)
    if (distancia < 36) return color
    if (distancia > 44 && distancia < 54) return color
    return BLANCO
  })
}

export const COLORES = {
  desarmada: [196, 120, 48] as Rgb,
  ensamblada_prueba: [48, 128, 196] as Rgb,
  placa_precinto: [96, 160, 72] as Rgb,
  logo: [14, 116, 144] as Rgb,
}

export function archivoPng(nombre: string, datos: Buffer) {
  return new File([new Uint8Array(datos)], nombre, { type: "image/png" })
}

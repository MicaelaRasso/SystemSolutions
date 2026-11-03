import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { CertificadoDocumento } from "./certificado-documento"
import { armarCertificadoVista } from "./certificado-vista"

const vista = armarCertificadoVista({
  certificate: {
    id: "c-1",
    numero: 14,
    estado: "finalizado",
    fecha_ejecucion: "2026-02-04",
    observaciones: "Sin novedades",
    datos_tecnicos: { valvula: { rosca: "NO APLICA" } },
    evidencia_fotografica: {
      desarmada: null,
      ensamblada_prueba: { bucket: "b", object_path: "p" },
      placa_precinto: null,
    },
  },
  snapshot: { valvula: { nombre: "PSV-1" }, yacimiento: { nombre: "Yacimiento Demo" } },
})

const render = (requiereFirma: boolean) =>
  renderToStaticMarkup(createElement(CertificadoDocumento, { vista, requiereFirma }))

describe("documento del certificado SYS", () => {
  it("respeta las secciones 1.0 a 1.5, ubica las fotos al final bajo ANEXO y mantiene el pie legal", () => {
    const html = render(false)
    const encabezadosEnOrden = [
      "MANTENIMIENTO Y CALIBRACIÓN",
      "1.0 UBICACIÓN",
      "1.1 VÁLVULA DE SEGURIDAD",
      "1.2 MANTENIMIENTO",
      "1.3 ENSAYOS",
      "1.4 OBSERVACIONES",
      "1.5 APROBACIÓN",
      "POR SYSTEM SOLUTIONS",
      "POR CLIENTE",
      "ANEXO — REGISTRO FOTOGRÁFICO",
      "FOTO VÁLVULA DESARMADA",
      "FOTO VÁLVULA ARMADA PARA ENSAYOS",
      "FOTO VÁLVULA ARMADA CON CHAPA Y PRECINTO",
      "NO SE RESPONSABILIZA",
      "RECALIBRACIÓN",
    ]
    let cursor = -1
    for (const titulo of encabezadosEnOrden) {
      const posicion = html.indexOf(titulo)
      expect(posicion, `Falta o está desordenado: ${titulo}`).toBeGreaterThan(cursor)
      cursor = posicion
    }
    expect(html).toContain("26-02-0014")
    expect(html).toContain("Yacimiento Demo")
    expect(html).toContain("NO APLICA")
    expect(html).toContain("Sin novedades")
    expect(html).not.toContain("REQUIERE FIRMA")
  })

  it("marca las fotos registradas sin vista y las faltantes sin inventarlas", () => {
    const html = render(false)
    expect(html).toContain("Foto registrada")
    expect(html).toContain("Sin foto")
    expect(html).not.toContain("<img")
  })

  it("muestra la leyenda REQUIERE FIRMA cuando faltan firmas", () => {
    expect(render(true)).toContain("REQUIERE FIRMA")
  })

  it("incluye el código y la foto del Parte Diario en la cabecera y el Anexo cuando están presentes", () => {
    const vistaConPd = armarCertificadoVista({
      certificate: {
        id: "c-pd",
        numero: 15,
        pd: "PD9876",
        estado: "finalizado",
        fecha_ejecucion: "2026-02-04",
        parte_diario_images: [{ url: "https://storage.example.test/pd9876.jpg" }],
      },
      snapshot: { valvula: { nombre: "PSV-1" }, yacimiento: { nombre: "Yacimiento Demo" } },
    })
    const html = renderToStaticMarkup(
      createElement(CertificadoDocumento, { vista: vistaConPd, requiereFirma: false }),
    )
    expect(vistaConPd.pdRto).toBe("PD9876")
    expect(html).toContain("PD9876")
    expect(html).toContain("FOTO PARTE DIARIO (PD9876)")
    expect(html).toContain("https://storage.example.test/pd9876.jpg")
  })
})

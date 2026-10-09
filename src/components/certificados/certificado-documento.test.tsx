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
  it("respeta las secciones y el pie legal del modelo", () => {
    const html = render(false)
    for (const titulo of [
      "MANTENIMIENTO Y CALIBRACIÓN",
      "1.0 UBICACIÓN",
      "1.1 VÁLVULA DE SEGURIDAD",
      "1.2 FOTO VÁLVULA DESARMADA",
      "1.3 MANTENIMIENTO",
      "1.4 FOTO VÁLVULA ARMADA PARA ENSAYOS",
      "1.5 ENSAYOS",
      "1.6 FOTO VÁLVULA ARMADA CON CHAPA Y PRECINTO",
      "1.7 OBSERVACIONES",
      "1.8 APROBACIÓN",
      "POR SYSTEM SOLUTIONS",
      "POR CLIENTE",
      "NO SE RESPONSABILIZA",
      "RECALIBRACIÓN",
    ]) {
      expect(html).toContain(titulo)
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
})

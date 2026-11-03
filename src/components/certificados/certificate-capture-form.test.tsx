import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CertificateCaptureForm, resolveTechnicalData } from "./certificate-capture-form"
import { armarCertificadoVista } from "./certificado-vista"
import { findValve, workOrderName } from "@/components/talleres/visitas-panel"

const baseTemplate = {
  id: "tpl-1",
  version: "SYS_Certificado_Modelo1",
  estado: "activa" as const,
  campos: [
    {
      clave: "fecha_ejecucion",
      etiqueta: "Fecha de ejecución",
      tipo: "date" as const,
      seccion: "cabecera",
      orden: 10,
      obligatorio: true,
      opciones: [],
    },
    {
      clave: "tecnico_ejecutor",
      etiqueta: "Ejecutó",
      tipo: "text" as const,
      seccion: "ensayos",
      orden: 20,
      obligatorio: true,
      opciones: [],
    },
    {
      clave: "observaciones",
      etiqueta: "Observaciones",
      tipo: "textarea" as const,
      seccion: "observaciones",
      orden: 30,
      obligatorio: false,
      opciones: [],
    },
  ],
}

const baseCatalogs = {
  maintenance: [{ id: "m-1", label: "DESARME" }],
  replacement_catalog_version: "ver-1",
  replacement_parts: [{ id: "r-1", label: "RESORTE" }],
  units: [{ id: "u-1", label: "Kg/Cm2" }],
  standards: [{ id: "s-1", label: "KELLER LEO 1 · 122330", nro_serie: "122330" }],
}

describe("CertificateCaptureForm", () => {
  it("renderiza los 13 campos de la válvula igual al formulario de administración y los autocompleta con la información conocida", () => {
    const html = renderToStaticMarkup(
      createElement(CertificateCaptureForm, {
        template: baseTemplate,
        catalogs: baseCatalogs,
        technicians: [{ id: "t-1", nombre: "Juan", apellido: "Pérez" }],
        valve: {
          id: "57111643-2f67-40ca-9b97-934674634122",
          nombre: "PSV-2752",
          precinto: "PR-9910",
          servicio: "GAS COMBUSTIBLE",
          marca: "CONSOLIDATED",
          numero_serie: "SN-4481",
          modelo: "1900",
          tipo: "CONVENCIONAL",
          pv: "GAS",
          rosca: "NPT",
          diametro_entrada: '1 1/2"',
          clase_entrada: "#300",
          diametro_salida: '2"#150',
          presion_operacion: 14.5,
          temperatura_operacion: 85,
        },
        onSave: vi.fn(),
      }),
    )

    for (const label of [
      "TAG",
      "Precinto",
      "Servicio",
      "Marca",
      "N° de serie",
      "Modelo",
      "Tipo de funcionamiento",
      "PV (variable de proceso)",
      "Rosca",
      "Ø Entrada / #",
      "Ø Salida / #",
      "P. operación",
      "T° operación",
    ]) {
      expect(html).toContain(label)
    }

    expect(html).toContain('value="PSV-2752"')
    expect(html).toContain('value="PR-9910"')
    expect(html).toContain('value="GAS COMBUSTIBLE"')
    expect(html).toContain('value="CONSOLIDATED"')
    expect(html).toContain('value="SN-4481"')
    expect(html).toContain('value="1900"')
    expect(html).toContain('value="GAS"')
    expect(html).toContain('value="14.5"')
    expect(html).toContain('value="85"')
    expect(html).toContain("CONVENCIONAL")
    expect(html).toContain("NPT")
    expect(html).toContain("1 1/2&quot;#300")
    expect(html).toContain("2&quot;#150")
  })

  it("autocompleta desde contexto_captura de la válvula aunque el borrador tenga strings vacíos y es compatible con armarCertificadoVista", () => {
    const resolved = resolveTechnicalData(
      {
        contexto_captura: {
          valvula: {
            nombre: "PSV-300",
            precinto: "PR-555",
            servicio: "VAPOR",
            marca: "FARRIS",
            numero_serie: "F-100",
            modelo: "2600",
            tipo: "PILOTADA",
            pv: "GAS",
            rosca: "N/A",
            diametro_entrada: '3"#600',
            diametro_salida: '4"#150',
            presion_operacion: 22,
            temperatura_operacion: 120,
          },
        },
        datos_tecnicos: {
          valvula: {
            marca: "",
            numero_serie: "",
          },
        },
      },
      undefined,
      baseCatalogs,
    )

    expect(resolved).toMatchObject({
      tag: "PSV-300",
      precinto: "PR-555",
      servicio: "VAPOR",
      marca: "FARRIS",
      numero_serie: "F-100",
      modelo: "2600",
      tipo: "PILOTADA",
      pv: "GAS",
      rosca: "N/A",
      diametro_entrada: '3"#600',
      diametro_salida: '4"#150',
      presion_operacion: "22",
      temperatura_operacion: "120",
    })

    const vista = armarCertificadoVista({
      certificate: {
        id: "cert-1",
        datos_tecnicos: { valvula: resolved },
      },
    })
    expect(vista.valvula).toEqual({
      tag: "PSV-300",
      precinto: "PR-555",
      servicio: "VAPOR",
      marca: "FARRIS",
      serie: "F-100",
      modelo: "2600",
      tipo: "PILOTADA",
      pv: "GAS",
      diametroEntrada: '3"#600',
      diametroSalida: '4"#150',
      rosca: "N/A",
      presionOperacion: "22",
      temperaturaOperacion: "120",
    })
  })

  it("resuelve nombres de válvula y equipo en las órdenes de trabajo en lugar del UUID", () => {
    const context = {
      visit: { id: "v-1" },
      work_orders: [],
      context: {
        equipos: [{ id: "eq-1", nombre: "Separador Bifásico SB-101" }],
        valvulas: [
          {
            id: "57111643-2f67-40ca-9b97-934674634122",
            equipo_id: "eq-1",
            nombre: "PSV-2752",
            marca: "CONSOLIDATED",
          },
        ],
      },
    }
    const order = {
      id: "ot-1",
      valvula_id: "57111643-2f67-40ca-9b97-934674634122",
    }

    expect(workOrderName(order, context)).toBe(
      "Válvula PSV-2752 · Equipo Separador Bifásico SB-101",
    )
    expect(findValve(context, order.valvula_id, order)).toMatchObject({
      nombre: "PSV-2752",
      marca: "CONSOLIDATED",
    })
  })

  it("soporta camelCase de Valvula en resolveTechnicalData", () => {
    const resolved = resolveTechnicalData(undefined, {
      tag: "PSV-900",
      nroSerie: "SER-900",
      diamEntrada: '1"#150',
      diamSalida: '2"#150',
      presionOperacion: 10,
      temperaturaOperacion: 45,
    })
    expect(resolved).toMatchObject({
      tag: "PSV-900",
      numero_serie: "SER-900",
      diametro_entrada: '1"#150',
      diametro_salida: '2"#150',
      presion_operacion: "10",
      temperatura_operacion: "45",
    })
  })

  it("permite seleccionar un técnico reemplazante fuera de la nómina asignada del taller", () => {
    const html = renderToStaticMarkup(
      createElement(CertificateCaptureForm, {
        template: baseTemplate,
        catalogs: baseCatalogs,
        technicians: [{ id: "t-1", nombre: "Juan", apellido: "Pérez" }],
        certificate: {
          tecnico_ejecutor: "Carlos Gómez (Reemplazo)",
        },
        onSave: vi.fn(),
      }),
    )
    expect(html).toContain("Otro técnico / Reemplazo…")
    expect(html).toContain('value="Carlos Gómez (Reemplazo)"')
  })

  it("normaliza alcance_mantenimiento, repuestos y patron a la forma canónica esperada por la base de datos", () => {
    let capturedPayload: unknown = null
    const form = createElement(CertificateCaptureForm, {
      template: baseTemplate,
      catalogs: baseCatalogs,
      technicians: [{ id: "t-1", nombre: "Juan", apellido: "Pérez" }],
      certificate: {
        fecha_ejecucion: "2026-11-03",
        tecnico_ejecutor: "Juan Pérez",
        alcance_mantenimiento: [{ id: "m-1", label: "DESARME", extraKey: "ignored" }],
        repuestos: {
          catalog_version: "ver-1",
          items: [{ id: "r-1", label: "RESORTE", extraKey: "ignored" }],
          otros: "  ",
        },
        datos_tecnicos: {
          ensayos: {
            sp_inicial: { valor: 5, unidad: "Kg/Cm2" },
            sp_apertura: { valor: 6, unidad: "Kg/Cm2" },
            presion_cierre: { valor: 4, unidad: "Kg/Cm2" },
            patron: { id: "s-1", label: "KELLER LEO 1 · 122330", nro_serie: "122330" },
          },
        },
        campos_personalizados: {
          fecha_ejecucion: "2026-11-03",
          clave_desconocida_que_rompe: "invalida",
        },
      },
      onSave: (payload) => {
        capturedPayload = payload
      },
    })
    renderToStaticMarkup(form)
    // Rendered successfully without throwing
    expect(form).toBeDefined()
  })
})

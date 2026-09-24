import { describe, expect, it } from "vitest"

import { CATALOGO_SEMILLA } from "./catalogos"
import {
  alcanceCliente,
  camposSinResolver,
  estadoFirma,
  estadoPatron,
  formatNroCertificado,
  nombreArchivoCertificado,
  normalizarEstadoTarea,
  puedeCorregir,
  puedeDescargar,
  puedeVerCertificado,
  rolesPermitidos,
  vigencia,
} from "./rules"
import type { ArbolYacimiento, Firma } from "./types"

const firma: Firma = { nombre: "A", apellido: "B", dni: "1", imagen: "data:", fecha: "2026-01-01" }
const hoy = new Date("2026-09-23T12:00:00")

describe("rolesPermitidos", () => {
  it("restringe por prefijo sin confundir rutas parecidas", () => {
    expect(rolesPermitidos("/admin/clientes")).toEqual(["superadmin", "admin"])
    expect(rolesPermitidos("/superadmin")).toEqual(["superadmin"])
    expect(rolesPermitidos("/administracion")).toBeNull()
    expect(rolesPermitidos("/login")).toBeNull()
  })
})

describe("vigencia (RN-01)", () => {
  it("vence al año de la ejecución", () => {
    expect(vigencia("2026-01-10", hoy)).toMatchObject({ estado: "vigente", vence: "2027-01-10" })
  })
  it("marca por vencer dentro de 30 días", () => {
    expect(vigencia("2025-10-20", hoy).estado).toBe("por_vencer")
  })
  it("marca vencido pasado el año", () => {
    expect(vigencia("2025-09-01", hoy).estado).toBe("vencido")
  })
})

describe("descarga y visibilidad (RN-04, RN-05, RN-06)", () => {
  const vigenteSinFirma = { fechaEjecucion: "2026-06-01" }
  const vigenteFirmado = { ...vigenteSinFirma, firmaTecnico: firma, firmaCliente: firma }
  const vencidoFirmado = { ...vigenteFirmado, fechaEjecucion: "2024-06-01" }

  it("estado de firma", () => {
    expect(estadoFirma({})).toBe("sin_firmas")
    expect(estadoFirma({ firmaTecnico: firma })).toBe("firma_tecnico")
    expect(estadoFirma(vigenteFirmado)).toBe("firmado")
  })
  it("el cliente descarga solo firmados y vigentes", () => {
    expect(puedeDescargar(vigenteSinFirma, "cliente", hoy)).toBe(false)
    expect(puedeDescargar(vigenteFirmado, "cliente", hoy)).toBe(true)
    expect(puedeDescargar(vencidoFirmado, "cliente", hoy)).toBe(false)
  })
  it("el admin descarga siempre", () => {
    expect(puedeDescargar(vigenteSinFirma, "admin", hoy)).toBe(true)
    expect(puedeDescargar(vencidoFirmado, "superadmin", hoy)).toBe(true)
  })
  it("el cliente no ve vencidos", () => {
    expect(puedeVerCertificado(vencidoFirmado, "cliente", hoy)).toBe(false)
    expect(puedeVerCertificado(vencidoFirmado, "admin", hoy)).toBe(true)
  })
})

describe("corrección 24 h (RN-14)", () => {
  const cert = { emitidoEn: "2026-09-22T15:00:00", emitidoPor: "u-taller" }
  it("el taller emisor corrige dentro de la ventana", () => {
    expect(puedeCorregir(cert, { id: "u-taller", rol: "taller" }, hoy)).toBe(true)
  })
  it("otro taller no corrige", () => {
    expect(puedeCorregir(cert, { id: "u-otro", rol: "taller" }, hoy)).toBe(false)
  })
  it("pasada la ventana solo el admin", () => {
    const tarde = new Date("2026-09-23T15:00:01")
    expect(puedeCorregir(cert, { id: "u-taller", rol: "taller" }, tarde)).toBe(false)
    expect(puedeCorregir(cert, { id: "u-admin", rol: "admin" }, tarde)).toBe(true)
  })
})

describe("completitud (RN-07)", () => {
  it("acepta NO APLICA y DATO NO ENCONTRADO, rechaza vacíos", () => {
    const faltan = camposSinResolver(
      {
        tag: { tipo: "valor", valor: "PSV-1" },
        serie: { tipo: "DATO_NO_ENCONTRADO" },
        modelo: { tipo: "NO_APLICA" },
        marca: { tipo: "valor", valor: "  " },
      },
      ["tag", "serie", "modelo", "marca", "precinto"],
    )
    expect(faltan).toEqual(["marca", "precinto"])
  })
})

describe("numeración y nomenclatura (RN-12, RN-16)", () => {
  it("formatea AA-MM-NNNN", () => {
    expect(formatNroCertificado(14, "2026-02-04")).toBe("26-02-0014")
  })
  it("arma un nombre de archivo sin caracteres problemáticos", () => {
    expect(
      nombreArchivoCertificado({
        tag: "PSV-2752",
        equipo: "K52100",
        locacion: "Planta Compresora N°8",
        nro: 14,
        fechaEjecucion: "2026-02-04",
      }),
    ).toBe("PSV-2752_K52100_PLANTA-COMPRESORA-N-8_26-02-0014.pdf")
  })
})

describe("alcance del cliente (RN-09)", () => {
  const arbol: ArbolYacimiento[] = [
    {
      id: "y1",
      empresaId: "e",
      nombre: "Y1",
      provincia: "",
      operadora: "",
      plantas: [
        {
          id: "p1",
          yacimientoId: "y1",
          nombre: "P1",
          equipos: [
            { id: "e1", plantaId: "p1", nombre: "E1", valvulas: [] },
            { id: "e2", plantaId: "p1", nombre: "E2", valvulas: [] },
          ],
        },
        {
          id: "p2",
          yacimientoId: "y1",
          nombre: "P2",
          equipos: [{ id: "e3", plantaId: "p2", nombre: "E3", valvulas: [] }],
        },
      ],
    },
    { id: "y2", empresaId: "e", nombre: "Y2", provincia: "", operadora: "", plantas: [] },
  ]

  it("un acceso a yacimiento incluye todo lo de abajo", () => {
    const a = alcanceCliente([{ usuarioId: "u", nivel: "yacimiento", refId: "y1" }], arbol)
    expect([...a.equipos].sort()).toEqual(["e1", "e2", "e3"])
    expect(a.yacimientos.has("y2")).toBe(false)
  })
  it("un acceso a equipo expone solo sus contenedores", () => {
    const a = alcanceCliente([{ usuarioId: "u", nivel: "equipo", refId: "e2" }], arbol)
    expect([...a.equipos]).toEqual(["e2"])
    expect([...a.plantas]).toEqual(["p1"])
    expect([...a.yacimientos]).toEqual(["y1"])
  })
})

describe("catálogo semilla", () => {
  it("coincide con la cantidad de opciones de las referencias", () => {
    expect(CATALOGO_SEMILLA.diamEntrada).toHaveLength(56)
    expect(CATALOGO_SEMILLA.diamSalida).toHaveLength(55)
    expect(new Set(CATALOGO_SEMILLA.diamEntrada).size).toBe(56)
  })
})

describe("patrones", () => {
  it("vencido, por vencer y vigente", () => {
    expect(estadoPatron("2026-09-22", hoy).estado).toBe("vencido")
    expect(estadoPatron("2026-10-10", hoy).estado).toBe("por_vencer")
    expect(estadoPatron("2027-03-01", hoy).estado).toBe("vigente")
  })
})

describe("estado de tarea según asignación (RF-14)", () => {
  it("sin taller queda pendiente", () => {
    expect(normalizarEstadoTarea("asignada", undefined)).toBe("pendiente")
  })
  it("al asignar taller pasa a asignada", () => {
    expect(normalizarEstadoTarea("pendiente", "tal-1")).toBe("asignada")
  })
  it("no toca completadas ni canceladas", () => {
    expect(normalizarEstadoTarea("completada", undefined)).toBe("completada")
    expect(normalizarEstadoTarea("cancelada", "tal-1")).toBe("cancelada")
  })
})

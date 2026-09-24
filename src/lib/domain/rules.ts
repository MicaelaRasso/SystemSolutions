/**
 * Reglas de negocio puras (sin I/O). Las usa el front hoy y las replicará el backend.
 * Referencias a RN-xx según DRF v1.1.
 */

import { addHours, addYears, differenceInCalendarDays, format, parseISO } from "date-fns"

import type {
  AccesoCliente,
  ArbolYacimiento,
  Certificado,
  EstadoTarea,
  ID,
  Rol,
  Usuario,
  ValorCampo,
} from "./types"

// ---------------------------------------------------------------------------
// Roles y rutas
// ---------------------------------------------------------------------------

export const ROL_LABEL: Record<Rol, string> = {
  superadmin: "Súper Administrador",
  admin: "Administrador",
  taller: "Taller móvil",
  cliente: "Cliente",
}

export const RUTA_INICIO: Record<Rol, string> = {
  superadmin: "/admin",
  admin: "/admin",
  taller: "/taller",
  cliente: "/portal",
}

const PERMISOS_RUTA: { prefijo: string; roles: Rol[] }[] = [
  { prefijo: "/superadmin", roles: ["superadmin"] },
  { prefijo: "/admin", roles: ["superadmin", "admin"] },
  { prefijo: "/taller", roles: ["taller"] },
  { prefijo: "/portal", roles: ["cliente"] },
]

/** Roles habilitados para una ruta; `null` si la ruta no está restringida por rol. */
export function rolesPermitidos(pathname: string): Rol[] | null {
  const regla = PERMISOS_RUTA.find(
    (r) => pathname === r.prefijo || pathname.startsWith(`${r.prefijo}/`),
  )
  return regla ? regla.roles : null
}

// ---------------------------------------------------------------------------
// Vigencia (RN-01, RN-06)
// ---------------------------------------------------------------------------

export const DIAS_AVISO_VENCIMIENTO = 30

export type EstadoVigencia = "vigente" | "por_vencer" | "vencido"

export function vigencia(fechaEjecucion: string, hoy: Date = new Date()) {
  const vence = addYears(parseISO(fechaEjecucion), 1)
  const diasRestantes = differenceInCalendarDays(vence, hoy)
  const estado: EstadoVigencia =
    diasRestantes < 0
      ? "vencido"
      : diasRestantes <= DIAS_AVISO_VENCIMIENTO
        ? "por_vencer"
        : "vigente"
  return { estado, vence: format(vence, "yyyy-MM-dd"), diasRestantes }
}

// ---------------------------------------------------------------------------
// Firma y disponibilidad (RN-04, RN-05, RN-06)
// ---------------------------------------------------------------------------

export type EstadoFirma = "sin_firmas" | "firma_tecnico" | "firmado"

export function estadoFirma(cert: Pick<Certificado, "firmaTecnico" | "firmaCliente">): EstadoFirma {
  if (cert.firmaTecnico && cert.firmaCliente) return "firmado"
  if (cert.firmaTecnico || cert.firmaCliente) return "firma_tecnico"
  return "sin_firmas"
}

type CertFirmaFecha = Pick<Certificado, "firmaTecnico" | "firmaCliente" | "fechaEjecucion">

/** El cliente no accede a certificados vencidos en esta etapa (RN-06). */
export function puedeVerCertificado(cert: CertFirmaFecha, rol: Rol, hoy: Date = new Date()) {
  if (rol !== "cliente") return true
  return vigencia(cert.fechaEjecucion, hoy).estado !== "vencido"
}

export function puedeDescargar(cert: CertFirmaFecha, rol: Rol, hoy: Date = new Date()) {
  if (rol === "admin" || rol === "superadmin") return true
  if (rol === "cliente") {
    return puedeVerCertificado(cert, rol, hoy) && estadoFirma(cert) === "firmado"
  }
  return false
}

// ---------------------------------------------------------------------------
// Corrección dentro de 24 h (RN-14)
// ---------------------------------------------------------------------------

export const HORAS_VENTANA_CORRECCION = 24

export function finVentanaCorreccion(emitidoEn: string) {
  return addHours(parseISO(emitidoEn), HORAS_VENTANA_CORRECCION)
}

export function puedeCorregir(
  cert: Pick<Certificado, "emitidoEn" | "emitidoPor">,
  usuario: Pick<Usuario, "id" | "rol">,
  ahora: Date = new Date(),
) {
  if (usuario.rol === "admin" || usuario.rol === "superadmin") return true
  return (
    usuario.rol === "taller" &&
    usuario.id === cert.emitidoPor &&
    ahora < finVentanaCorreccion(cert.emitidoEn)
  )
}

// ---------------------------------------------------------------------------
// Completitud (RN-07)
// ---------------------------------------------------------------------------

export const VALOR_NO_DISPONIBLE_LABEL = {
  NO_APLICA: "NO APLICA",
  DATO_NO_ENCONTRADO: "DATO NO ENCONTRADO",
} as const

export function valorResuelto(v: ValorCampo | undefined): boolean {
  if (!v) return false
  return v.tipo !== "valor" || v.valor.trim() !== ""
}

export function textoValor(v: ValorCampo | undefined): string {
  if (!v) return ""
  return v.tipo === "valor" ? v.valor : VALOR_NO_DISPONIBLE_LABEL[v.tipo]
}

/** Claves obligatorias que no tienen valor ni una marca de "dato no disponible". */
export function camposSinResolver(
  valores: Record<string, ValorCampo | undefined>,
  obligatorios: string[],
): string[] {
  return obligatorios.filter((k) => !valorResuelto(valores[k]))
}

// ---------------------------------------------------------------------------
// Numeración y nomenclatura (RN-12, RN-16)
// ---------------------------------------------------------------------------

/** Formato visible AA-MM-NNNN del certificado modelo; el correlativo es global (ver planning §9). */
export function formatNroCertificado(nro: number, fechaEjecucion: string) {
  const fecha = parseISO(fechaEjecucion)
  return `${format(fecha, "yy-MM")}-${String(nro).padStart(4, "0")}`
}

const limpiarParaArchivo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()

/** Provisorio hasta definir P-08: {TAG}_{EQUIPO}_{LOCACION}_{NRO}.pdf */
export function nombreArchivoCertificado(p: {
  tag: string
  equipo: string
  locacion: string
  nro: number
  fechaEjecucion: string
}) {
  const partes = [p.tag, p.equipo, p.locacion, formatNroCertificado(p.nro, p.fechaEjecucion)]
  return `${partes.map(limpiarParaArchivo).join("_")}.pdf`
}

// ---------------------------------------------------------------------------
// Alcance de acceso del cliente (RN-09)
// ---------------------------------------------------------------------------

export interface AlcanceCliente {
  yacimientos: Set<ID>
  plantas: Set<ID>
  equipos: Set<ID>
}

/**
 * Expande los accesos otorgados a un usuario cliente sobre el árbol de su empresa.
 * Un acceso a un nivel incluye todo lo que cuelga debajo; los niveles superiores
 * quedan visibles solo como contenedores.
 */
export function alcanceCliente(accesos: AccesoCliente[], arbol: ArbolYacimiento[]): AlcanceCliente {
  const alcance: AlcanceCliente = { yacimientos: new Set(), plantas: new Set(), equipos: new Set() }
  const otorgados = new Set(accesos.map((a) => `${a.nivel}:${a.refId}`))

  for (const y of arbol) {
    const yOk = otorgados.has(`yacimiento:${y.id}`)
    for (const p of y.plantas) {
      const pOk = yOk || otorgados.has(`planta:${p.id}`)
      for (const e of p.equipos) {
        if (pOk || otorgados.has(`equipo:${e.id}`)) {
          alcance.equipos.add(e.id)
          alcance.plantas.add(p.id)
          alcance.yacimientos.add(y.id)
        }
      }
      if (pOk) {
        alcance.plantas.add(p.id)
        alcance.yacimientos.add(y.id)
      }
    }
    if (yOk) alcance.yacimientos.add(y.id)
  }
  return alcance
}

// ---------------------------------------------------------------------------
// Patrones de calibración
// ---------------------------------------------------------------------------

/** El vencimiento del patrón se renueva cada año; se avisa con la misma anticipación que los certificados. */
export function estadoPatron(vencimiento: string, hoy: Date = new Date()) {
  const diasRestantes = differenceInCalendarDays(parseISO(vencimiento), hoy)
  const estado: EstadoVigencia =
    diasRestantes < 0
      ? "vencido"
      : diasRestantes <= DIAS_AVISO_VENCIMIENTO
        ? "por_vencer"
        : "vigente"
  return { estado, diasRestantes }
}

// ---------------------------------------------------------------------------
// Tareas (RF-13, RF-14)
// ---------------------------------------------------------------------------

export const ESTADO_TAREA_LABEL: Record<EstadoTarea, string> = {
  pendiente: "Sin asignar",
  asignada: "Asignada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
}

/**
 * Mantiene el estado coherente con la asignación: una tarea sin taller queda "pendiente"
 * y una pendiente pasa a "asignada" al recibir taller. Los estados de avance no se tocan.
 */
export function normalizarEstadoTarea(estado: EstadoTarea, tallerId?: ID): EstadoTarea {
  if (!tallerId && (estado === "asignada" || estado === "en_curso")) return "pendiente"
  if (tallerId && estado === "pendiente") return "asignada"
  return estado
}

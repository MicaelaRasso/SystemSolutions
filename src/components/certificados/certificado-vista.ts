/**
 * Arma el modelo de vista del certificado SYS (secciones 1.0 a 1.8) a partir de lo que
 * devuelve el backend: la fila del certificado, su instantánea de contexto, las firmas de
 * la visita y las referencias de fotos. Es puro: no inventa datos; lo que falta se
 * muestra como "—" y las marcas "NO APLICA" / "DATO NO ENCONTRADO" se respetan.
 */

import { format, isValid, parseISO } from "date-fns"

import { CATALOGO_SEMILLA } from "@/lib/domain/catalogos"
import {
  formatNroCertificado,
  limpiarParaArchivo,
  nombreArchivoCertificado,
  VALOR_NO_DISPONIBLE_LABEL,
} from "@/lib/domain/rules"

export const SIN_DATO = "—"

export type ClaveFoto = "desarmada" | "ensamblada_prueba" | "placa_precinto"

export interface FotoVista {
  /** Dirección utilizable por el navegador; `null` si la foto existe pero no hay vista. */
  url: string | null
}

export interface FirmaVista {
  nombre: string
  fecha: string
  imagenUrl: string | null
}

export interface CasillaVista {
  label: string
  marcado: boolean
}

export interface EnsayoVista {
  valor: string
  unidad: string
}

export interface CertificadoVista {
  id: string
  estado: string
  numero: string
  fechaEjecucion: string
  pdRto: string
  ordenTrabajo: string
  ubicacion: {
    provincia: string
    yacimiento: string
    operadora: string
    contratista: string
    locacion: string
    equipo: string
  }
  valvula: {
    precinto: string
    servicio: string
    tag: string
    marca: string
    serie: string
    modelo: string
    tipo: string
    pv: string
    diametroEntrada: string
    diametroSalida: string
    rosca: string
    presionOperacion: string
    temperaturaOperacion: string
  }
  mantenimiento: { alcance: CasillaVista[]; repuestos: CasillaVista[]; otros: string | null }
  ensayos: {
    spInicial: EnsayoVista
    spApertura: EnsayoVista
    presionCierre: EnsayoVista
    patron: string
    vencimientoPatron: string
    ejecuto: string
  }
  fotos: Record<ClaveFoto, FotoVista[]>
  observaciones: string
  /** Personal del taller en la visita (RF-27, RF-38), si el backend lo informa. */
  nomina: string
  adicionales: { etiqueta: string; valor: string }[]
  firmas: { tecnico: FirmaVista | null; cliente: FirmaVista | null }
  logoCliente: FotoVista | null
  /** Nombre sugerido para el PDF, sin extensión (RN-16, provisorio hasta P-08). */
  nombreArchivo: string
}

export interface CertificadoFuente {
  certificate: Record<string, unknown>
  /** Instantánea de contexto; si no llega se usa la del propio certificado. */
  snapshot?: unknown
  signatures?: unknown[]
  images?: unknown[]
  clientLogo?: unknown
}

type Registro = Record<string, unknown>

function registro(value: unknown): Registro {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Registro) : {}
}

const vacio = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "")

/** Texto visible de un valor del backend; `null` si no hay dato. */
function textoDe(value: unknown): string | null {
  if (vacio(value)) return null
  if (typeof value === "number") return value.toLocaleString("es-AR")
  if (typeof value === "string") return value.trim()
  if (typeof value === "boolean") return value ? "Sí" : "No"
  if (Array.isArray(value)) {
    const partes = value.map(textoDe).filter((v): v is string => Boolean(v))
    return partes.length ? partes.join(", ") : null
  }
  const r = registro(value)
  return textoDe(r.label ?? r.etiqueta ?? r.nombre ?? r.valor)
}

const texto = (value: unknown) => textoDe(value) ?? SIN_DATO

/** Normaliza claves y etiquetas para compararlas: sin tildes, símbolos ni espacios. */
const normalizarClave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

/** Normaliza etiquetas de casillas para marcar las del modelo (O`RING = O'RING). */
const normalizarEtiqueta = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[`´’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()

function urlUtilizable(value: unknown): string | null {
  if (typeof value !== "string") return null
  return /^https:\/\//.test(value) || /^data:image\//.test(value) ? value : null
}

function fotosDe(value: unknown): FotoVista[] {
  if (vacio(value)) return []
  if (Array.isArray(value)) return value.flatMap(fotosDe)
  if (typeof value === "string") return [{ url: urlUtilizable(value) }]
  const r = registro(value)
  const url = [r.url, r.signed_url, r.signedUrl, r.public_url].map(urlUtilizable).find(Boolean)
  return [{ url: url ?? null }]
}

function fechaCorta(value: unknown, patron: string) {
  if (typeof value !== "string" || !value) return null
  const fecha = parseISO(value)
  return isValid(fecha) ? format(fecha, patron) : null
}

const ALIAS: Record<string, string[]> = {
  precinto: ["precinto"],
  servicio: ["servicio"],
  pv: ["pv", "variableproceso", "variabledeproceso"],
  presionOperacion: ["presionoperacion", "presiondeoperacion", "poperacion"],
  temperaturaOperacion: ["temperaturaoperacion", "temperaturadeoperacion", "toperacion"],
  pdRto: ["pdrto"],
  ordenTrabajo: ["ordentrabajo", "ordendetrabajo", "nroordentrabajo", "ot"],
}

const CLAVES_PROPIAS = new Set(["fechaejecucion", "tecnicoejecutor", "observaciones"])

function casillas(modelo: string[], elegidas: unknown): CasillaVista[] {
  const marcadas = (Array.isArray(elegidas) ? elegidas : [])
    .map(textoDe)
    .filter((v): v is string => Boolean(v))
  const marcadasNorm = new Set(marcadas.map(normalizarEtiqueta))
  const modeloNorm = new Set(modelo.map(normalizarEtiqueta))
  return [
    ...modelo.map((label) => ({ label, marcado: marcadasNorm.has(normalizarEtiqueta(label)) })),
    ...marcadas
      .filter((label) => !modeloNorm.has(normalizarEtiqueta(label)))
      .map((label) => ({ label, marcado: true })),
  ]
}

function ensayo(value: unknown): EnsayoVista {
  const r = registro(value)
  return { valor: texto(r.valor), unidad: texto(r.unidad) }
}

export function firmasDeVisita(signatures: unknown[] | undefined): CertificadoVista["firmas"] {
  const firmas: CertificadoVista["firmas"] = { tecnico: null, cliente: null }
  for (const item of signatures ?? []) {
    const r = registro(item)
    const parte = r.parte ?? r.party
    if (parte !== "tecnico" && parte !== "cliente") continue
    const imagen = registro(r.image ?? r.imagen)
    firmas[parte] = {
      nombre: texto(r.nombre_firmante ?? r.signer_name),
      fecha: fechaCorta(r.captured_at, "dd/MM/yyyy") ?? SIN_DATO,
      imagenUrl: [imagen.url, imagen.signed_url, r.url].map(urlUtilizable).find(Boolean) ?? null,
    }
  }
  return firmas
}

export function armarCertificadoVista(fuente: CertificadoFuente): CertificadoVista {
  const cert = fuente.certificate
  const contexto = registro(fuente.snapshot ?? cert.instantanea ?? cert.contexto_captura)
  const yacimiento = registro(contexto.yacimiento)
  const planta = registro(contexto.planta)
  const equipo = registro(contexto.equipo)
  const valvulaContexto = registro(contexto.valvula)

  const tecnicos = registro(cert.datos_tecnicos)
  const capturada = registro(tecnicos.valvula ?? tecnicos.valve)
  const pruebas = registro(tecnicos.ensayos ?? tecnicos.tests)
  const razon = (capturada.razon_disponibilidad ?? valvulaContexto.razon_disponibilidad) as
    string | null | undefined
  const marcaNoDisponible =
    razon === "not_applicable"
      ? VALOR_NO_DISPONIBLE_LABEL.NO_APLICA
      : razon === "not_found"
        ? VALOR_NO_DISPONIBLE_LABEL.DATO_NO_ENCONTRADO
        : SIN_DATO

  /** Lo capturado en el certificado manda; la instantánea completa lo que no se capturó. */
  const tecnico = (clave: string) => {
    const valor = clave in capturada ? capturada[clave] : valvulaContexto[clave]
    return textoDe(valor)
  }
  const tecnicoVisible = (clave: string) => tecnico(clave) ?? marcaNoDisponible
  const diametro = (medida: string, clase: string) => {
    const partes = [tecnico(medida), tecnico(clase)].filter(Boolean)
    return partes.length ? partes.join(" ") : marcaNoDisponible
  }

  // Campos de la plantilla: se ubican por clave o etiqueta; el resto queda como adicional.
  const personalizados = registro(cert.campos_personalizados)
  const etiquetas = new Map<string, string>()
  const camposPlantilla = registro(cert.plantilla_snapshot).campos
  if (Array.isArray(camposPlantilla)) {
    for (const campo of camposPlantilla) {
      const r = registro(campo)
      if (typeof r.clave === "string") etiquetas.set(r.clave, String(r.etiqueta ?? r.clave))
    }
  }
  const usados = new Set<string>()
  const buscar = (nombre: keyof typeof ALIAS) => {
    const alias = new Set(ALIAS[nombre])
    for (const [clave, valor] of Object.entries(personalizados)) {
      const etiqueta = etiquetas.get(clave) ?? clave
      if (alias.has(normalizarClave(clave)) || alias.has(normalizarClave(etiqueta))) {
        usados.add(clave)
        const visible = textoDe(valor)
        if (visible) return visible
      }
    }
    for (const fuenteDatos of [capturada, valvulaContexto]) {
      for (const [clave, valor] of Object.entries(fuenteDatos)) {
        if (alias.has(normalizarClave(clave)) && textoDe(valor)) return textoDe(valor)!
      }
    }
    return SIN_DATO
  }

  const valvula: CertificadoVista["valvula"] = {
    precinto: buscar("precinto"),
    servicio: buscar("servicio"),
    tag: textoDe(valvulaContexto.nombre ?? valvulaContexto.tag) ?? SIN_DATO,
    marca: tecnicoVisible("marca"),
    serie: tecnicoVisible("numero_serie"),
    modelo: tecnicoVisible("modelo"),
    tipo: tecnicoVisible("tipo"),
    pv: buscar("pv"),
    diametroEntrada: diametro("diametro_entrada", "clase_entrada"),
    diametroSalida: diametro("diametro_salida", "clase_salida"),
    rosca: tecnicoVisible("rosca"),
    presionOperacion: buscar("presionOperacion"),
    temperaturaOperacion: buscar("temperaturaOperacion"),
  }
  const pdRto = buscar("pdRto")
  const ordenTrabajo = buscar("ordenTrabajo")

  const adicionales = Object.entries(personalizados)
    .filter(([clave]) => !usados.has(clave) && !CLAVES_PROPIAS.has(normalizarClave(clave)))
    .map(([clave, valor]) => ({ etiqueta: etiquetas.get(clave) ?? clave, valor: texto(valor) }))

  // Fotos: la evidencia del certificado; si una sección está vacía se completa con las
  // referencias de imágenes del backend de la misma categoría.
  const evidencia = registro(cert.evidencia_fotografica)
  const imagenes = Array.isArray(fuente.images) ? fuente.images : []
  const fotos = {} as Record<ClaveFoto, FotoVista[]>
  for (const clave of ["desarmada", "ensamblada_prueba", "placa_precinto"] as const) {
    const propias = fotosDe(evidencia[clave])
    fotos[clave] = propias.length
      ? propias
      : imagenes.filter((img) => registro(img).categoria === clave).flatMap(fotosDe)
  }

  const repuestos = registro(cert.repuestos)
  const patron = registro(pruebas.patron)
  const fechaIso = typeof cert.fecha_ejecucion === "string" ? cert.fecha_ejecucion : null
  const nro = typeof cert.numero === "number" ? cert.numero : null
  const ubicacion = {
    provincia: texto(yacimiento.provincia),
    yacimiento: texto(yacimiento.nombre),
    operadora: texto(yacimiento.operadora),
    contratista: texto(yacimiento.contratista),
    locacion: texto(planta.nombre),
    equipo: texto(equipo.nombre),
  }
  const partesArchivo = [valvula.tag, ubicacion.equipo, ubicacion.locacion].map((p) =>
    p === SIN_DATO ? "" : p,
  )
  const nombreArchivo =
    nro !== null && fechaIso
      ? nombreArchivoCertificado({
          tag: partesArchivo[0],
          equipo: partesArchivo[1],
          locacion: partesArchivo[2],
          nro,
          fechaEjecucion: fechaIso,
        }).replace(/\.pdf$/, "")
      : [...partesArchivo, "SIN-NUMERO"].map(limpiarParaArchivo).filter(Boolean).join("_")

  const logo = fuente.clientLogo ?? contexto.client_logo
  return {
    id: String(cert.id ?? ""),
    estado: texto(cert.estado),
    numero:
      nro !== null ? (fechaIso ? formatNroCertificado(nro, fechaIso) : String(nro)) : "Pendiente",
    fechaEjecucion: fechaCorta(fechaIso, "dd-MM-yy") ?? SIN_DATO,
    pdRto,
    ordenTrabajo,
    ubicacion,
    valvula,
    mantenimiento: {
      alcance: casillas(CATALOGO_SEMILLA.alcance, cert.alcance_mantenimiento),
      repuestos: casillas(CATALOGO_SEMILLA.repuestos, repuestos.items),
      otros: textoDe(repuestos.otros),
    },
    ensayos: {
      spInicial: ensayo(pruebas.sp_inicial),
      spApertura: ensayo(pruebas.sp_apertura),
      presionCierre: ensayo(pruebas.presion_cierre),
      patron: texto(pruebas.patron),
      vencimientoPatron: fechaCorta(patron.vencimiento, "dd/MM/yyyy") ?? SIN_DATO,
      ejecuto: texto(cert.tecnico_ejecutor),
    },
    fotos,
    observaciones: texto(cert.observaciones),
    nomina: texto(cert.nomina ?? contexto.nomina ?? cert.personal_taller),
    adicionales,
    firmas: firmasDeVisita(fuente.signatures),
    logoCliente: vacio(logo) ? null : (fotosDe(logo)[0] ?? null),
    nombreArchivo,
  }
}

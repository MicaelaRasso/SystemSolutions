/**
 * Modelo de dominio. Refleja la forma de las futuras tablas de Supabase.
 * Fechas como string ISO (YYYY-MM-DD para fechas, ISO completo para timestamps).
 */

export type ID = string

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

export type Rol = "superadmin" | "admin" | "taller" | "cliente"

export interface Usuario {
  id: ID
  email: string
  nombre: string
  apellido: string
  rol: Rol
  /** Solo rol cliente: empresa a la que pertenece. */
  empresaId?: ID
  /** Solo rol taller: taller móvil asociado a la cuenta. */
  tallerId?: ID
  activo: boolean
  creadoEn: string
}

/** Nivel de la estructura sobre el que se otorga acceso a un usuario cliente (RN-09). */
export type NivelAcceso = "yacimiento" | "planta" | "equipo"

export interface AccesoCliente {
  usuarioId: ID
  nivel: NivelAcceso
  refId: ID
}

// ---------------------------------------------------------------------------
// Clientes y estructura
// ---------------------------------------------------------------------------

/** Empresa cliente del sistema (la contratista del certificado; ver planning §9). */
export interface Empresa {
  id: ID
  razonSocial: string
  cuit: string
  contacto: string
  telefono: string
  email: string
  direccion: string
  /** Data URL en mock; URL de Supabase Storage en producción. */
  logoUrl?: string
  /** "Requiere envío de advertencia de vencimiento" (RN-17). */
  avisoVencimiento: boolean
  activo: boolean
  creadoEn: string
}

export interface Yacimiento {
  id: ID
  empresaId: ID
  nombre: string
  provincia: string
  operadora: string
}

/** Planta / Locación. */
export interface Planta {
  id: ID
  yacimientoId: ID
  nombre: string
}

/** Equipo / Unidad. */
export interface Equipo {
  id: ID
  plantaId: ID
  nombre: string
  descripcion?: string
}

/** Tipo de funcionamiento: valor del catálogo "tipo" (PILOTADA, CONVENCIONAL, …). */
export type TipoValvula = string

export interface Valvula {
  id: ID
  equipoId: ID
  tag: string
  precinto?: string
  servicio?: string
  marca?: string
  /** Se releva en campo si no se conoce al alta (RF-08). */
  nroSerie?: string
  modelo?: string
  tipo?: TipoValvula
  /** Variable de proceso. */
  pv?: string
  diamEntrada?: string
  diamSalida?: string
  rosca?: string
  presionOperacion?: number
  temperaturaOperacion?: number
  notas?: string
}

/** Nodos navegables de la estructura, en orden jerárquico. */
export type NivelEstructura = "yacimiento" | "planta" | "equipo" | "valvula"

export interface ArbolValvula extends Valvula {
  certificados: number
}
export interface ArbolEquipo extends Equipo {
  valvulas: ArbolValvula[]
}
export interface ArbolPlanta extends Planta {
  equipos: ArbolEquipo[]
}
export interface ArbolYacimiento extends Yacimiento {
  plantas: ArbolPlanta[]
}

// ---------------------------------------------------------------------------
// Talleres y personal
// ---------------------------------------------------------------------------

export interface Taller {
  id: ID
  nombre: string
  /** Color para agenda y cronograma. */
  color: string
  activo: boolean
}

export interface Persona {
  id: ID
  nombre: string
  apellido: string
  dni: string
  activo: boolean
}

/** Personas afectadas a un taller en una jornada (RN-15). */
export interface NominaJornada {
  tallerId: ID
  fecha: string
  personaIds: ID[]
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export type EstadoTarea = "pendiente" | "asignada" | "en_curso" | "completada" | "cancelada"

export interface Adjunto {
  id: ID
  nombre: string
  url: string
  tipo: string
}

export interface Tarea {
  id: ID
  nroSolicitud: number
  empresaId: ID
  yacimientoId: ID
  plantaId: ID
  equipoId: ID
  tallerId?: ID
  contacto: string
  telefono: string
  fechaSolicitud: string
  fechaEjecucion: string
  horario?: string
  tipo: string
  detalle: string
  pdRto?: string
  ordenTrabajo?: string
  condiciones: string[]
  adjuntos: Adjunto[]
  estado: EstadoTarea
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

/** Valor de un campo obligatorio que admite "dato no disponible" (RN-07). */
export type ValorCampo =
  { tipo: "valor"; valor: string } | { tipo: "NO_APLICA" } | { tipo: "DATO_NO_ENCONTRADO" }

export interface Firma {
  nombre: string
  apellido: string
  dni: string
  /** Imagen PNG como data URL. */
  imagen: string
  fecha: string
}

export type SeccionFoto = "desarmada" | "armada_ensayo" | "armada_chapa"

export interface FotoCertificado {
  id: ID
  seccion: SeccionFoto
  url: string
}

export interface Ensayo {
  valor: number
  unidad: string
}

export interface Certificado {
  id: ID
  /** Correlativo asignado por el servidor al sincronizar (RN-12). */
  nro: number
  /** Identificador generado en la tablet; clave de idempotencia (RNF-04). */
  localId: ID
  tareaId: ID
  tallerId: ID
  empresaId: ID
  yacimientoId: ID
  plantaId: ID
  equipoId: ID
  valvulaId: ID
  /** Fecha real de ejecución en campo (RN-08). */
  fechaEjecucion: string
  /** Momento en que el servidor lo registró; inicia la ventana de 24 h (RN-14). */
  emitidoEn: string
  emitidoPor: ID
  pdRto?: string
  ordenTrabajo?: string

  /** Snapshot de la válvula al momento del servicio. */
  valvula: Record<string, ValorCampo>

  alcance: string[]
  repuestos: string[]
  repuestosOtros?: string

  ensayos: {
    spInicial: Ensayo
    spApertura: Ensayo
    presionCierre: Ensayo
    patronId: ID
    ejecuto: string
  }

  fotos: FotoCertificado[]
  observaciones?: string
  nomina: Pick<Persona, "nombre" | "apellido" | "dni">[]

  firmaTecnico?: Firma
  firmaCliente?: Firma

  nombreArchivo: string
  revision: number
}

export interface CorreccionCertificado {
  id: ID
  certificadoId: ID
  usuarioId: ID
  fecha: string
  cambios: { campo: string; antes: string; despues: string }[]
}

// ---------------------------------------------------------------------------
// Catálogos y configuración
// ---------------------------------------------------------------------------

export type ListaCatalogo =
  | "diamEntrada"
  | "diamSalida"
  | "rosca"
  | "unidad"
  | "tipo"
  | "alcance"
  | "repuestos"
  | "condicionesServicio"

export interface OpcionCatalogo {
  id: ID
  lista: ListaCatalogo
  valor: string
  orden: number
  activo: boolean
}

export interface Patron {
  id: ID
  nombre: string
  nroSerie: string
  vencimiento: string
  activo: boolean
}

// ---------------------------------------------------------------------------
// Sesión (mock) — en producción la provee Supabase Auth
// ---------------------------------------------------------------------------

export interface Sesion {
  usuarioId: ID
  rol: Rol
  nombre: string
  /** Epoch ms de expiración. */
  exp: number
}

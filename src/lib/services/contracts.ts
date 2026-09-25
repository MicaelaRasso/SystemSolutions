/**
 * Contratos de la capa de datos. Las pantallas solo conocen estas interfaces.
 * Hoy las implementa `mock/`; más adelante `supabase/` (consultas con RLS + Edge Functions).
 */

import type {
  AccesoCliente,
  Adjunto,
  ArbolYacimiento,
  Certificado,
  Empresa,
  Equipo,
  EstadoTarea,
  ID,
  ListaCatalogo,
  NominaJornada,
  OpcionCatalogo,
  Patron,
  Persona,
  Planta,
  Rol,
  Taller,
  Tarea,
  Usuario,
  Valvula,
  Yacimiento,
} from "@/lib/domain/types"

export type NuevoRegistro<T extends { id: ID }> = Omit<T, "id">
export type Cambios<T extends { id: ID }> = Partial<Omit<T, "id">>

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid" | "unauthorized" | "network" = "invalid",
  ) {
    super(message)
    this.name = "ServiceError"
  }
}

export interface AuthService {
  /** Futuro: supabase.auth.signInWithPassword */
  login(email: string, password: string): Promise<Usuario>
}

export interface EmpresasRepo {
  list(filtro?: { q?: string; incluirInactivas?: boolean }): Promise<EmpresaResumen[]>
  get(id: ID): Promise<Empresa>
  create(data: NuevoRegistro<Omit<Empresa, "creadoEn">> & { creadoEn?: string }): Promise<Empresa>
  update(id: ID, data: Cambios<Empresa>): Promise<Empresa>
  /** Futuro: upload a Supabase Storage (bucket `logos`). */
  setLogo(id: ID, archivo: File | null): Promise<Empresa>
}

export interface EmpresaResumen extends Empresa {
  yacimientos: number
  valvulas: number
  usuarios: number
}

export interface EstructuraRepo {
  arbol(empresaId: ID): Promise<ArbolYacimiento[]>

  createYacimiento(data: NuevoRegistro<Yacimiento>): Promise<Yacimiento>
  updateYacimiento(id: ID, data: Cambios<Yacimiento>): Promise<Yacimiento>
  deleteYacimiento(id: ID): Promise<void>

  createPlanta(data: NuevoRegistro<Planta>): Promise<Planta>
  updatePlanta(id: ID, data: Cambios<Planta>): Promise<Planta>
  deletePlanta(id: ID): Promise<void>

  createEquipo(data: NuevoRegistro<Equipo>): Promise<Equipo>
  updateEquipo(id: ID, data: Cambios<Equipo>): Promise<Equipo>
  deleteEquipo(id: ID): Promise<void>

  getValvula(id: ID): Promise<Valvula>
  createValvula(data: NuevoRegistro<Valvula>): Promise<Valvula>
  updateValvula(id: ID, data: Cambios<Valvula>): Promise<Valvula>
  deleteValvula(id: ID): Promise<void>
}

export interface UsuariosRepo {
  list(filtro?: { rol?: Rol; empresaId?: ID }): Promise<Usuario[]>
  get(id: ID): Promise<Usuario>
  /** Futuro: Edge Function `crear-usuario` (service role). */
  create(data: NuevoRegistro<Omit<Usuario, "creadoEn">>): Promise<Usuario>
  update(id: ID, data: Cambios<Usuario>): Promise<Usuario>
  delete(id: ID): Promise<void>
  getAccesos(usuarioId: ID): Promise<AccesoCliente[]>
  setAccesos(usuarioId: ID, accesos: Omit<AccesoCliente, "usuarioId">[]): Promise<void>
}

/** Taller con su cuenta de acceso (una por tablet, RN-10). */
export interface TallerConCuenta extends Taller {
  usuarioId: ID
  email: string
}

export interface TalleresRepo {
  list(): Promise<TallerConCuenta[]>
  /** Crea el taller y su cuenta de rol taller. Futuro: Edge Function `crear-usuario`. */
  create(data: { nombre: string; color: string; email: string }): Promise<TallerConCuenta>
  /** Desactivar el taller deshabilita también su cuenta. */
  update(
    id: ID,
    data: Partial<{ nombre: string; color: string; email: string; activo: boolean }>,
  ): Promise<TallerConCuenta>
}

export interface PersonasRepo {
  list(): Promise<Persona[]>
  create(data: NuevoRegistro<Persona>): Promise<Persona>
  update(id: ID, data: Cambios<Persona>): Promise<Persona>
}

export interface CatalogosRepo {
  /** Opciones activas de una lista, ordenadas (para los formularios). */
  opciones(lista: ListaCatalogo): Promise<OpcionCatalogo[]>
  /** Todas las opciones, incluidas las inactivas (para administrarlas). */
  listar(lista: ListaCatalogo): Promise<OpcionCatalogo[]>
  resumen(): Promise<Record<ListaCatalogo, { total: number; activas: number }>>
  crear(lista: ListaCatalogo, valor: string): Promise<OpcionCatalogo>
  /** No se eliminan opciones: se desactivan, porque los certificados emitidos las referencian. */
  actualizar(
    id: ID,
    data: Partial<Pick<OpcionCatalogo, "valor" | "activo">>,
  ): Promise<OpcionCatalogo>
  reordenar(lista: ListaCatalogo, ids: ID[]): Promise<void>
}

export interface PatronesRepo {
  list(): Promise<Patron[]>
  create(data: NuevoRegistro<Patron>): Promise<Patron>
  update(id: ID, data: Cambios<Patron>): Promise<Patron>
}

export interface FiltroTareas {
  /** Fecha de ejecución desde / hasta (inclusive, YYYY-MM-DD). */
  desde?: string
  hasta?: string
  estados?: EstadoTarea[]
  /** "sin_asignar" filtra las tareas sin taller. */
  tallerId?: ID | "sin_asignar"
  empresaId?: ID
  /** Busca en N° de solicitud, contacto, detalle y nombres de la ubicación. */
  q?: string
}

/** Tarea con los nombres de su ubicación y taller (futura vista SQL). */
export interface TareaResumen extends Tarea {
  empresaNombre: string
  yacimientoNombre: string
  plantaNombre: string
  equipoNombre: string
  tallerNombre?: string
  tallerColor?: string
}

export type NuevaTarea = Omit<Tarea, "id" | "nroSolicitud">

export interface TareasRepo {
  list(filtro?: FiltroTareas): Promise<TareaResumen[]>
  get(id: ID): Promise<TareaResumen>
  /** Asigna el número de solicitud (RN-11). Futuro: secuencia de Postgres. */
  create(data: NuevaTarea): Promise<Tarea>
  update(id: ID, data: Partial<NuevaTarea>): Promise<Tarea>
  /** Futuro: upload a Supabase Storage (bucket `adjuntos`). */
  subirAdjunto(archivo: File): Promise<Adjunto>
}

export interface CronogramaRepo {
  /** Nóminas cargadas entre dos fechas (inclusive). */
  nominas(desde: string, hasta: string): Promise<NominaJornada[]>
  /** Reemplaza la nómina de un taller en una jornada (RN-15). */
  setNomina(tallerId: ID, fecha: string, personaIds: ID[]): Promise<void>
  /** Copia las nóminas de la semana anterior en las jornadas vacías. Devuelve cuántas copió. */
  copiarSemanaAnterior(lunes: string): Promise<number>
}

export interface CertificadosRepo {
  listPorValvula(valvulaId: ID): Promise<Certificado[]>
}

/** Utilidades exclusivas del modo demo. */
export interface DemoService {
  reset(): Promise<void>
}

export interface Services {
  auth: AuthService
  empresas: EmpresasRepo
  estructura: EstructuraRepo
  usuarios: UsuariosRepo
  talleres: TalleresRepo
  personas: PersonasRepo
  catalogos: CatalogosRepo
  patrones: PatronesRepo
  tareas: TareasRepo
  cronograma: CronogramaRepo
  certificados: CertificadosRepo
  demo: DemoService
}

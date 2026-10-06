import type { z } from "zod"
import { z as zod } from "zod"

import type {
  ArbolYacimiento,
  Certificado,
  Equipo,
  ID,
  Planta,
  Usuario,
  Valvula,
  Yacimiento,
} from "@/lib/domain/types"
import { createAdminApi } from "../api/admin"
import { createOperationsApi, type OperationFilters, type OperationStatus } from "../api/operations"
import type { OperationSummary } from "../api/contracts"
import type { Adjunto } from "../domain/types"
import {
  ServiceError,
  type FiltroTareas,
  type NuevoRegistro,
  type Services,
  type TareaResumen,
} from "./contracts"
import {
  browserSupabase,
  EdgeTransport,
  type BrowserSupabaseClient,
  type EdgeFunctionName,
} from "./edge-transport"

export { browserSupabase } from "./edge-transport"

export type EdgeContext = {
  cuenta_id: string
  rol: "cliente" | "taller_movil" | "administrador_regular" | "super_administrador"
  taller_movil_id: string | null
  cliente: boolean
  estado: "pendiente" | "activa" | "deshabilitada"
}

const roleMap: Record<EdgeContext["rol"], Usuario["rol"]> = {
  cliente: "cliente",
  taller_movil: "taller",
  administrador_regular: "admin",
  super_administrador: "superadmin",
}

function isEdgeContext(value: unknown): value is EdgeContext {
  if (!value || typeof value !== "object") return false
  const context = value as Partial<EdgeContext>
  return (
    typeof context.cuenta_id === "string" &&
    (context.rol === "cliente" ||
      context.rol === "taller_movil" ||
      context.rol === "administrador_regular" ||
      context.rol === "super_administrador") &&
    (typeof context.taller_movil_id === "string" || context.taller_movil_id === null) &&
    typeof context.cliente === "boolean" &&
    (context.estado === "pendiente" ||
      context.estado === "activa" ||
      context.estado === "deshabilitada")
  )
}

type AuthUserDetails = {
  email?: string
  user_metadata?: Record<string, unknown>
}

const unsupported = (operation: string): never => {
  throw new ServiceError(`${operation} todavía no está disponible`, "invalid")
}

/**
 * Deep adapter for authenticated Edge Functions.
 * The browser knows only this interface; it never creates a database client
 * or reads a Supabase table directly.
 */
export class EdgeAccessClient {
  private readonly transport: EdgeTransport
  private readonly auth: (() => BrowserSupabaseClient) | undefined
  private currentUser?: Usuario

  constructor({
    baseUrl,
    publishableKey,
    functionUrls,
    request = fetch,
    auth,
    correlationId,
  }: {
    baseUrl?: string
    publishableKey?: string
    functionUrls?: Partial<Record<EdgeFunctionName, string>>
    request?: typeof fetch
    auth?: () => BrowserSupabaseClient
    correlationId?: string | (() => string)
  } = {}) {
    this.auth = auth ?? (typeof window === "undefined" ? undefined : browserSupabase)
    this.transport = new EdgeTransport({
      functionUrls,
      baseUrl,
      publishableKey,
      request,
      auth: this.auth,
      correlationId,
    })
  }

  clearSession() {
    this.currentUser = undefined
  }

  user() {
    return this.currentUser
  }

  private userFromContext(context: EdgeContext, authUser?: AuthUserDetails): Usuario {
    return {
      id: context.cuenta_id,
      // These fields are display-only. Role and account identity always come
      // from the authorized Edge Function context, never user metadata.
      email: authUser?.email ?? "",
      nombre:
        typeof authUser?.user_metadata?.nombre === "string" ? authUser.user_metadata.nombre : "",
      apellido:
        typeof authUser?.user_metadata?.apellido === "string"
          ? authUser.user_metadata.apellido
          : "",
      rol: roleMap[context.rol],
      estadoCuenta: context.estado,
      tallerId: context.taller_movil_id ?? undefined,
      activo: context.estado === "activa",
      creadoEn: "",
    }
  }

  async authenticatedUser(): Promise<Usuario> {
    if (!this.auth)
      throw new ServiceError("Supabase Auth solo está disponible en el navegador", "network")
    const { data, error } = await this.auth().auth.getSession()
    if (error || !data.session?.user)
      throw new ServiceError("Authentication required", "unauthorized")

    const user = this.userFromContext(await this.context(), data.session.user)
    this.currentUser = user
    return user
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.transport.request(this.functionForPath(path), path, init) as Promise<T>
  }

  functionForPath(path: string): EdgeFunctionName {
    const route = path.replace(/^\//, "").split("?", 1)[0]
    if (route === "backups") return "backup-export"
    if (
      /^(context(?:\/|$)|accounts(?:\/|$)|mobile-workshops(?:\/|$)|technicians(?:\/|$)|staffing(?:\/|$)|catalogs(?:\/|$)|catalog-options(?:\/|$)|test-standards(?:\/|$))/.test(
        route,
      )
    )
      return "identity-admin"
    if (route === "clients/me/pending-certificates") return "certificate-field"
    if (
      route === "certificate-templates/active" ||
      route === "certificate-templates" ||
      route.startsWith("certificate-templates/") ||
      route === "certificate-capture/catalogs"
    )
      return "certificate-field"
    if (route === "clients" || route.startsWith("clients/")) return "asset-access"
    if (/^(?:operations|audit|admin)(?:\/|$)/.test(route) || route === "attachments")
      return "service-workflow"
    if (
      route.startsWith("offline/") ||
      route.startsWith("conflicts/") ||
      route === "conflicts" ||
      /^(?:visits\/[^/]+\/(?:sync|claim|media))$/.test(route)
    )
      return "offline-sync"
    if (
      route.startsWith("certificates/") ||
      /^(?:work-orders\/[^/]+\/certificate-draft)$/.test(route) ||
      /^(?:valves\/[^/]+\/certificates)$/.test(route) ||
      /^(?:visits\/[^/]+\/signatures)$/.test(route)
    ) {
      return "certificate-field"
    }
    if (/^(requests(?:\/|$)|work-orders\/[^/]+$|visits(?:\/|$))/.test(route)) {
      return "service-workflow"
    }
    if (
      route === "yacimientos" ||
      route.startsWith("yacimientos/") ||
      route === "hierarchy" ||
      route.startsWith("hierarchy/") ||
      route.startsWith("valves/")
    ) {
      return "asset-access"
    }
    throw new ServiceError(`Ruta Edge sin propietario: ${route}`, "not_found")
  }

  /**
   * Typed seam used by capability clients. It is deliberately the only place
   * that turns an Edge Function response into browser data, so a successful
   * but malformed response cannot reach a component as an unchecked cast.
   */
  async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const data = await this.call<unknown>(path, init)
    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      throw new ServiceError("La Edge Function devolvió una respuesta inválida", "network")
    }
    return parsed.data
  }

  async download(path: string, init: RequestInit = {}): Promise<Response> {
    return this.transport.response(this.functionForPath(path), path, init)
  }

  async login(email: string, password: string): Promise<Usuario> {
    if (!this.auth)
      throw new ServiceError("Supabase Auth solo está disponible en el navegador", "network")
    const { data, error } = await this.auth().auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error || !data.user || !data.session) {
      throw new ServiceError(error?.message ?? "Email o contraseña incorrectos", "unauthorized")
    }
    const user = this.userFromContext(await this.context(), data.user)
    this.currentUser = user
    return user
  }

  async context(): Promise<EdgeContext> {
    const response = await this.call<EdgeContext | EdgeContext[]>("context")
    const context = Array.isArray(response) ? response[0] : response
    if (!isEdgeContext(context))
      throw new ServiceError("La Edge Function devolvió un contexto inválido", "network")
    if (context.estado !== "activa")
      throw new ServiceError("La cuenta no está activa", "unauthorized")
    return context
  }

  async listYacimientos(): Promise<Record<string, unknown>[]> {
    return this.call<Record<string, unknown>[]>("yacimientos")
  }

  async tree(id: ID): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(`yacimientos/${id}/tree`)
  }

  async createYacimiento(data: {
    name: string
    provincia: string
    operadora: string
    contratista: string
  }) {
    return this.call<Record<string, unknown>>("yacimientos", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateYacimiento(
    id: ID,
    data: { name: string; provincia: string; operadora: string; contratista: string },
  ) {
    return this.call<Record<string, unknown>>(`yacimientos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async valve(id: ID) {
    return this.call<{ valve: Record<string, unknown>; revisions: Record<string, unknown>[] }>(
      `valves/${id}`,
    )
  }

  async createDescendant(kind: "planta" | "equipo" | "valvula", parentId: ID, name: string) {
    return this.call<Record<string, unknown>>("hierarchy", {
      method: "POST",
      body: JSON.stringify({ kind, parent_id: parentId, name }),
    })
  }

  async updateDescendant(kind: "planta" | "equipo" | "valvula", id: ID, name: string) {
    return this.call<Record<string, unknown>>(`hierarchy/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ kind, name }),
    })
  }

  async certificatesForValve(id: ID) {
    return this.call<{
      current_certificate_id: string | null
      certificates: Record<string, unknown>[]
    }>(`valves/${id}/certificates`)
  }

  async syncVisit(visitId: ID, operations: unknown[], deviceId: string) {
    return this.call<Record<string, unknown>>(`visits/${visitId}/sync`, {
      method: "POST",
      body: JSON.stringify({ operations, device_id: deviceId }),
    })
  }

  async workingSet() {
    return this.call<Record<string, unknown>>("offline/working-set")
  }
}

const edge = new EdgeAccessClient()

export const edgeAccess = edge

function mapYacimiento(raw: Record<string, unknown>): Yacimiento {
  return {
    id: String(raw.id),
    empresaId: String(raw.cliente_cuenta_id),
    nombre: String(raw.nombre),
    provincia: String(raw.provincia ?? ""),
    operadora: String(raw.operadora ?? ""),
  }
}

function mapTree(raw: Record<string, unknown>): ArbolYacimiento {
  const y = raw.yacimiento as Record<string, unknown>
  const plantas = (raw.plantas as Record<string, unknown>[] | undefined) ?? []
  const equipos = (raw.equipos as Record<string, unknown>[] | undefined) ?? []
  const valvulas = (raw.valvulas as Record<string, unknown>[] | undefined) ?? []
  return {
    ...mapYacimiento(y),
    plantas: plantas.map((plant) => ({
      id: String(plant.id),
      yacimientoId: String(plant.yacimiento_id),
      nombre: String(plant.nombre),
      equipos: equipos
        .filter((team) => String(team.planta_id) === String(plant.id))
        .map((team) => ({
          id: String(team.id),
          plantaId: String(team.planta_id),
          nombre: String(team.nombre),
          valvulas: valvulas
            .filter((valve) => String(valve.equipo_id) === String(team.id))
            .map((valve) => ({
              id: String(valve.id),
              equipoId: String(valve.equipo_id),
              tag: String(valve.nombre),
              certificados: 0,
            })),
        })),
    })),
  }
}

const mapPlanta = (raw: Record<string, unknown>): Planta => ({
  id: String(raw.id),
  yacimientoId: String(raw.yacimiento_id),
  nombre: String(raw.nombre),
})

const mapEquipo = (raw: Record<string, unknown>): Equipo => ({
  id: String(raw.id),
  plantaId: String(raw.planta_id),
  nombre: String(raw.nombre),
})

const mapValvula = (raw: Record<string, unknown>): Valvula => ({
  id: String(raw.id),
  equipoId: String(raw.equipo_id),
  tag: String(raw.nombre),
})

const legacyOperationStatus: Record<OperationSummary["estado"], TareaResumen["estado"]> = {
  solicitada: "pendiente",
  programada: "pendiente",
  aceptada: "asignada",
  en_curso: "en_curso",
  completada: "completada",
  cancelada: "cancelada",
}

function toLegacyTarea(operation: OperationSummary): TareaResumen {
  return {
    id: operation.id,
    nroSolicitud: operation.numero_solicitud,
    empresaId: operation.cliente.id,
    yacimientoId: operation.yacimiento.id,
    plantaId: "",
    equipoId: "",
    tallerId: operation.taller_movil?.id,
    contacto: "",
    telefono: "",
    fechaSolicitud: "",
    fechaEjecucion: operation.starts_at,
    tipo: "Certificación",
    detalle: "",
    condiciones: [],
    adjuntos: [] as Adjunto[],
    estado: legacyOperationStatus[operation.estado],
    empresaNombre: operation.cliente.nombre,
    yacimientoNombre: operation.yacimiento.nombre,
    plantaNombre: "—",
    equipoNombre: "—",
    tallerNombre: operation.taller_movil?.nombre,
  }
}

function toOperationFilters(filter: FiltroTareas): OperationFilters {
  const status: OperationStatus[] | undefined = filter.estados?.flatMap((state) => {
    if (state === "pendiente") return ["solicitada"]
    if (state === "asignada") return ["programada", "aceptada"]
    return [state]
  })
  return {
    from: filter.desde,
    to: filter.hasta,
    status,
    workshopId: filter.tallerId === "sin_asignar" ? undefined : filter.tallerId,
    clientId: filter.empresaId,
    q: filter.q,
  }
}

const attachmentDtoSchema = zod.object({
  id: zod.string(),
  nombre: zod.string(),
  tipo: zod.string(),
  url: zod.string(),
})

function uploadAttachment(edge: EdgeAccessClient, file: File) {
  const form = new FormData()
  form.set("file", file)
  return edge.request("attachments", attachmentDtoSchema, {
    method: "POST",
    body: form,
  }) as Promise<Adjunto>
}

const estructura = {
  arbol: async (empresaId: ID) => [mapTree(await edge.tree(empresaId))],
  createYacimiento: async (data: NuevoRegistro<Yacimiento>) =>
    mapYacimiento(
      await edge.createYacimiento({
        name: data.nombre,
        provincia: data.provincia,
        operadora: data.operadora,
        contratista: "No informado",
      }),
    ),
  updateYacimiento: async (id: ID, data: Partial<Yacimiento>) => {
    const current = mapYacimiento((await edge.tree(id)).yacimiento as Record<string, unknown>)
    return mapYacimiento(
      await edge.updateYacimiento(id, {
        name: data.nombre ?? current.nombre,
        provincia: data.provincia ?? current.provincia,
        operadora: data.operadora ?? current.operadora,
        contratista: "No informado",
      }),
    )
  },
  deleteYacimiento: async () => unsupported("deleteYacimiento"),
  createPlanta: async (data: NuevoRegistro<Planta>) =>
    mapPlanta(await edge.createDescendant("planta", data.yacimientoId, data.nombre)),
  updatePlanta: async (id: ID, data: Partial<Planta>) =>
    mapPlanta(await edge.updateDescendant("planta", id, data.nombre ?? "")),
  deletePlanta: async () => unsupported("deletePlanta"),
  createEquipo: async (data: NuevoRegistro<Equipo>) =>
    mapEquipo(await edge.createDescendant("equipo", data.plantaId, data.nombre)),
  updateEquipo: async (id: ID, data: Partial<Equipo>) =>
    mapEquipo(await edge.updateDescendant("equipo", id, data.nombre ?? "")),
  deleteEquipo: async () => unsupported("deleteEquipo"),
  getValvula: async (id: ID) => {
    const response = await edge.valve(id)
    const valve = mapValvula(response.valve)
    return {
      ...valve,
      marca: response.valve.marca as string | undefined,
      nroSerie: response.valve.numero_serie as string | undefined,
      modelo: response.valve.modelo as string | undefined,
      tipo: response.valve.tipo as string | undefined,
      diamEntrada: response.valve.diametro_entrada as string | undefined,
      diamSalida: response.valve.diametro_salida as string | undefined,
      rosca: response.valve.rosca as string | undefined,
    }
  },
  createValvula: async (data: NuevoRegistro<Valvula>) =>
    mapValvula(await edge.createDescendant("valvula", data.equipoId, data.tag)),
  updateValvula: async (id: ID, data: Partial<Valvula>) =>
    mapValvula(await edge.updateDescendant("valvula", id, data.tag ?? "")),
  deleteValvula: async () => unsupported("deleteValvula"),
}

const adminApi = createAdminApi(edge)
const operationsApi = createOperationsApi(edge)

export const edgeServices: Services = {
  auth: {
    login: (email, password) => edge.login(email, password),
    logout: async () => {
      const { error } = await browserSupabase().auth.signOut()
      edge.clearSession()
      if (error) throw new ServiceError(error.message, "network")
    },
  },
  // Frontend Empresa maps to the backend Cliente API owned by asset-access.
  empresas: adminApi.clients,
  estructura,
  usuarios: {
    list: async (filter = {}) => adminApi.accounts.list(filter.empresaId ?? ""),
    get: async (id) => {
      const context = await edge.context()
      if (context.cuenta_id === id)
        return (
          edge.user() ?? {
            id,
            email: "",
            nombre: "",
            apellido: "",
            rol: roleMap[context.rol],
            tallerId: context.taller_movil_id ?? undefined,
            activo: true,
            creadoEn: "",
          }
        )
      const rows = await adminApi.accounts.list("")
      const user = rows.find((row) => row.id === id)
      if (!user) throw new ServiceError("Usuario no encontrado", "not_found")
      return user
    },
    create: async (data) => adminApi.accounts.create(data.empresaId ?? "", data),
    update: (id, data) => adminApi.accounts.update(id, data),
    delete: (id) => adminApi.accounts.remove(id),
    getAccesos: async (id) =>
      (await adminApi.accounts.access(id)).map((row) => ({
        usuarioId: row.usuario_id,
        nivel: row.nivel,
        refId: row.ref_id,
      })),
    setAccesos: async (id, access) => {
      await adminApi.accounts.setAccess(id, access)
    },
  },
  talleres: adminApi.workshops,
  personas: adminApi.people,
  catalogos: {
    opciones: adminApi.catalogs.options,
    listar: adminApi.catalogs.list,
    resumen: adminApi.catalogs.summary,
    crear: adminApi.catalogs.create,
    actualizar: adminApi.catalogs.update,
    reordenar: adminApi.catalogs.reorder,
  },
  patrones: adminApi.standards,
  // This is a temporary UI seam. The canonical operations adapter returns
  // operation DTOs; only this legacy repository maps them to TareaResumen.
  tareas: {
    list: async (filter = {}) => {
      const operations = await operationsApi.list(toOperationFilters(filter))
      return operations.items
        .filter((operation) => filter.tallerId !== "sin_asignar" || !operation.taller_movil)
        .map(toLegacyTarea)
    },
    get: async (id) => toLegacyTarea((await operationsApi.get(id)).operation),
    create: async () => unsupported("tareas.create"),
    update: async () => unsupported("tareas.update"),
    subirAdjunto: (file) => uploadAttachment(edge, file),
  },
  cronograma: {
    nominas: adminApi.staffing.list,
    setNomina: adminApi.staffing.set,
    copiarSemanaAnterior: adminApi.staffing.copyPreviousWeek,
  },
  certificados: {
    listPorValvula: async (valvulaId): Promise<Certificado[]> => {
      const history = await edge.certificatesForValve(valvulaId)
      return history.certificates.map((entry) => entry.certificate as unknown as Certificado)
    },
  },
  demo: { reset: async () => unsupported("reset demo") },
}

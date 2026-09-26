import type { z } from "zod"

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
import { ServiceError, type NuevoRegistro, type Services } from "./contracts"
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
    typeof context.cliente === "boolean"
  )
}

type AuthUserDetails = {
  email?: string
  user_metadata?: Record<string, unknown>
}

const unsupported = (operation: string): never => {
  throw new ServiceError(
    `${operation} todavía no está expuesto por la Edge Function service-access`,
    "invalid",
  )
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
    anonKey,
    functionUrls,
    serviceAccessUrl,
    request = fetch,
    auth,
    correlationId,
  }: {
    baseUrl?: string
    anonKey?: string
    functionUrls?: Partial<Record<EdgeFunctionName, string>>
    serviceAccessUrl?: string
    request?: typeof fetch
    auth?: () => BrowserSupabaseClient
    correlationId?: string | (() => string)
  } = {}) {
    this.auth = auth ?? (typeof window === "undefined" ? undefined : browserSupabase)
    this.transport = new EdgeTransport({
      functionUrls,
      serviceAccessUrl: baseUrl ?? serviceAccessUrl,
      anonKey,
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
      tallerId: context.taller_movil_id ?? undefined,
      activo: true,
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

  private functionForPath(path: string): EdgeFunctionName {
    const route = path.replace(/^\//, "")
    if (route === "context") return "identity-admin"
    if (route.startsWith("offline/") || /^(?:visits\/[^/]+\/sync)$/.test(route))
      return "offline-sync"
    if (
      route.startsWith("certificates/") ||
      /^(?:work-orders\/[^/]+\/certificate-draft)$/.test(route) ||
      /^(?:valves\/[^/]+\/certificates)$/.test(route) ||
      /^(?:visits\/[^/]+\/signatures)$/.test(route)
    ) {
      return "certificate-field"
    }
    if (
      route.startsWith("requests/") ||
      route === "requests" ||
      route.startsWith("work-orders/") ||
      route.startsWith("visits/")
    ) {
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
    return "service-access"
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
    const user = this.userFromContext(await this.call<EdgeContext>("context"), data.user)
    this.currentUser = user
    return user
  }

  async context(): Promise<EdgeContext> {
    const response = await this.call<EdgeContext | EdgeContext[]>("context")
    const context = Array.isArray(response) ? response[0] : response
    if (!isEdgeContext(context))
      throw new ServiceError("La Edge Function devolvió un contexto inválido", "network")
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

function unsupportedRepo<T extends object>(): T {
  return new Proxy(
    {},
    {
      get(_target, property: string) {
        return () => unsupported(String(property))
      },
    },
  ) as T
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
  getValvula: async (id: ID) => unsupported(`getValvula:${id}`),
  createValvula: async (data: NuevoRegistro<Valvula>) =>
    mapValvula(await edge.createDescendant("valvula", data.equipoId, data.tag)),
  updateValvula: async (id: ID, data: Partial<Valvula>) =>
    mapValvula(await edge.updateDescendant("valvula", id, data.tag ?? "")),
  deleteValvula: async () => unsupported("deleteValvula"),
}

export const edgeServices: Services = {
  auth: {
    login: (email, password) => edge.login(email, password),
    logout: async () => {
      const { error } = await browserSupabase().auth.signOut()
      edge.clearSession()
      if (error) throw new ServiceError(error.message, "network")
    },
  },
  empresas: unsupportedRepo<Services["empresas"]>(),
  estructura,
  usuarios: {
    list: async () => unsupported("list usuarios"),
    get: async (id) => {
      const currentUser = edge.user()
      if (!currentUser || currentUser.id !== id) {
        const context = await edge.context()
        return {
          id: context.cuenta_id,
          email: "",
          nombre: "",
          apellido: "",
          rol: roleMap[context.rol],
          tallerId: context.taller_movil_id ?? undefined,
          activo: true,
          creadoEn: "",
        }
      }
      return currentUser
    },
    create: async () => unsupported("create usuario"),
    update: async () => unsupported("update usuario"),
    delete: async () => unsupported("delete usuario"),
    getAccesos: async () => unsupported("getAccesos"),
    setAccesos: async () => unsupported("setAccesos"),
  },
  talleres: unsupportedRepo<Services["talleres"]>(),
  personas: unsupportedRepo<Services["personas"]>(),
  catalogos: unsupportedRepo<Services["catalogos"]>(),
  patrones: unsupportedRepo<Services["patrones"]>(),
  tareas: unsupportedRepo<Services["tareas"]>(),
  cronograma: unsupportedRepo<Services["cronograma"]>(),
  certificados: {
    listPorValvula: async (valvulaId): Promise<Certificado[]> => {
      const history = await edge.certificatesForValve(valvulaId)
      return history.certificates.map((entry) => entry.certificate as unknown as Certificado)
    },
  },
  demo: { reset: async () => unsupported("reset demo") },
}

import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
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

export type EdgeContext = {
  cuenta_id: string
  rol: "cliente" | "taller_movil" | "administrador_regular" | "super_administrador"
  taller_movil_id: string | null
  cliente: boolean
}

type EdgeFetch = typeof fetch

type BrowserSupabaseClient = Pick<SupabaseClient, "auth">

let browserSupabaseClient: BrowserSupabaseClient | undefined

/**
 * The sole browser Supabase client. `@supabase/ssr` persists its Auth session
 * in cookies, which keeps it aligned with the server/proxy session.
 */
export function browserSupabase(): BrowserSupabaseClient {
  if (browserSupabaseClient) return browserSupabaseClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new ServiceError("Falta configurar Supabase Auth", "network")

  browserSupabaseClient = createBrowserClient(url, key)
  return browserSupabaseClient
}

const roleMap: Record<EdgeContext["rol"], Usuario["rol"]> = {
  cliente: "cliente",
  taller_movil: "taller",
  administrador_regular: "admin",
  super_administrador: "superadmin",
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
 * Deep adapter for the authenticated `service-access` Edge Function.
 * The browser knows only this interface; it never creates a database client
 * or reads a Supabase table directly.
 */
export class EdgeAccessClient {
  private readonly baseUrl: string
  private readonly anonKey: string
  private readonly fetcher: EdgeFetch
  private readonly auth: (() => BrowserSupabaseClient) | undefined
  private currentUser?: Usuario

  constructor({
    baseUrl = process.env.NEXT_PUBLIC_SERVICE_ACCESS_URL ??
      `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/service-access`,
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
    request = fetch,
    auth,
  }: {
    baseUrl?: string
    anonKey?: string
    request?: EdgeFetch
    auth?: () => BrowserSupabaseClient
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.anonKey = anonKey
    this.fetcher = request
    this.auth = auth ?? (typeof window === "undefined" ? undefined : browserSupabase)
  }

  private async token() {
    if (!this.auth) return undefined
    const { data, error } = await this.auth().auth.getSession()
    if (error) throw new ServiceError("No se pudo obtener la sesión de Supabase", "unauthorized")
    return data.session?.access_token
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
    if (!this.baseUrl) throw new ServiceError("Falta configurar la URL de Supabase", "network")
    const token = await this.token()
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}/${path.replace(/^\//, "")}`, {
        ...init,
        headers: {
          apikey: this.anonKey,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      })
    } catch (error) {
      throw new ServiceError(
        error instanceof Error ? error.message : "No se pudo conectar con la Edge Function",
        "network",
      )
    }
    const data = (await response.json().catch(() => null)) as { error?: string } | T | null
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data ? data.error : undefined
      const code =
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : response.status === 404
            ? "not_found"
            : response.status === 409
              ? "conflict"
              : response.status >= 500
                ? "network"
                : "invalid"
      throw new ServiceError(message ?? "La Edge Function rechazó la solicitud", code)
    }
    return data as T
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
    return this.call<EdgeContext>("context")
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

  async syncVisit(visitId: ID, operations: unknown[], deviceId?: string) {
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

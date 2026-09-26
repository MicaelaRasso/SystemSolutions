import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseConfig, type EdgeFunctionName } from "../supabase/config"
import { ServiceError } from "./contracts"

export type { EdgeFunctionName } from "../supabase/config"

export type BrowserSupabaseClient = Pick<SupabaseClient, "auth">
export type EdgeFetch = typeof fetch
export type EdgeFunctionRegistry = Readonly<Record<EdgeFunctionName, string>>

export type EdgeTransportOptions = {
  functionUrls?: Partial<Record<EdgeFunctionName, string>>
  serviceAccessUrl?: string
  anonKey?: string
  request?: EdgeFetch
  auth?: (() => BrowserSupabaseClient) | undefined
  correlationId?: string | (() => string)
}

let browserSupabaseClient: BrowserSupabaseClient | undefined

/** The browser Supabase client is intentionally typed and used as Auth-only. */
export function browserSupabase(): BrowserSupabaseClient {
  if (browserSupabaseClient) return browserSupabaseClient

  const { url, publishableKey } = getSupabaseConfig()
  browserSupabaseClient = createBrowserClient(url, publishableKey)
  return browserSupabaseClient
}

function normalizeUrl(url: string) {
  return url.replace(/\/$/, "")
}

function defaultServiceAccessUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return (
    process.env.NEXT_PUBLIC_SERVICE_ACCESS_URL ??
    (url ? `${url.replace(/\/$/, "")}/functions/v1/service-access` : "")
  )
}

function configuredFunctions() {
  try {
    return getSupabaseConfig()
  } catch {
    return undefined
  }
}

export function createEdgeFunctionRegistry({
  functionUrls,
  serviceAccessUrl,
}: Pick<EdgeTransportOptions, "functionUrls" | "serviceAccessUrl"> = {}): EdgeFunctionRegistry {
  const configured = configuredFunctions()
  const fallback = normalizeUrl(
    serviceAccessUrl ?? configured?.serviceAccessUrl ?? defaultServiceAccessUrl(),
  )
  const urls =
    functionUrls ?? (serviceAccessUrl !== undefined ? {} : configured?.edgeFunctions) ?? {}

  return {
    "identity-admin": normalizeUrl(urls["identity-admin"] ?? fallback),
    "asset-access": normalizeUrl(urls["asset-access"] ?? fallback),
    "service-workflow": normalizeUrl(urls["service-workflow"] ?? fallback),
    "certificate-field": normalizeUrl(urls["certificate-field"] ?? fallback),
    "offline-sync": normalizeUrl(urls["offline-sync"] ?? fallback),
    "service-access": fallback,
  }
}

function nextCorrelationId() {
  return globalThis.crypto?.randomUUID?.() ?? `correlation-${Date.now()}-${Math.random()}`
}

function errorCode(status: number): ConstructorParameters<typeof ServiceError>[1] {
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status >= 500) return "network"
  return "invalid"
}

function responseMessage(data: unknown) {
  if (!data || typeof data !== "object") return undefined
  const payload = data as { error?: unknown; message?: unknown }
  if (typeof payload.error === "string") return payload.error
  if (payload.error && typeof payload.error === "object") {
    const nested = payload.error as { message?: unknown }
    if (typeof nested.message === "string") return nested.message
  }
  return typeof payload.message === "string" ? payload.message : undefined
}

async function responseData(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => "")
  if (!body.trim()) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** Shared authenticated browser transport for all capability-owning functions. */
export class EdgeTransport {
  readonly functions: EdgeFunctionRegistry
  private readonly anonKey: string
  private readonly fetcher: EdgeFetch
  private readonly auth: (() => BrowserSupabaseClient) | undefined
  private readonly correlationId: () => string

  constructor({
    functionUrls,
    serviceAccessUrl,
    anonKey,
    request = fetch,
    auth,
    correlationId = nextCorrelationId,
  }: EdgeTransportOptions = {}) {
    const configuredKey =
      anonKey ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      ""
    this.functions = createEdgeFunctionRegistry({ functionUrls, serviceAccessUrl })
    this.anonKey = configuredKey
    this.fetcher = request
    this.auth = auth
    this.correlationId = typeof correlationId === "function" ? correlationId : () => correlationId
  }

  private async token() {
    if (!this.auth) return undefined
    const { data, error } = await this.auth().auth.getSession()
    if (error) throw new ServiceError("No se pudo obtener la sesión de Supabase", "unauthorized")
    return data.session?.access_token
  }

  async request(functionName: EdgeFunctionName, path: string, init: RequestInit = {}) {
    const baseUrl = this.functions[functionName]
    if (!baseUrl) throw new ServiceError("Falta configurar la URL de Supabase", "network")

    const token = await this.token()
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    if (init.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json"
    }
    headers.apikey = this.anonKey
    headers["x-correlation-id"] = this.correlationId()
    if (token) headers.authorization = `Bearer ${token}`

    let response: Response
    try {
      response = await this.fetcher(`${baseUrl}/${path.replace(/^\//, "")}`, {
        ...init,
        headers,
      })
    } catch (error) {
      throw new ServiceError(
        error instanceof Error ? error.message : "No se pudo conectar con la Edge Function",
        "network",
      )
    }

    const data = await responseData(response)
    if (!response.ok) {
      throw new ServiceError(
        responseMessage(data) ?? "La Edge Function rechazó la solicitud",
        errorCode(response.status),
      )
    }
    return data
  }
}

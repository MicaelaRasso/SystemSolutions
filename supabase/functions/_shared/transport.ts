import { authenticateRequest, type AuthenticatedActor } from "./auth.ts"
import { correlationId } from "./correlation.ts"
import { createServiceRoleClient, type ServiceRoleClient, type RpcResult } from "./db.ts"
import { errorJson, json, preflight, routeNotFound } from "./http.ts"
import { errorMessage, errorStatus, HttpError } from "./errors.ts"
import { canHandleRoute, parseRoute, type FunctionName } from "./route.ts"
import { requestMetadata, type RequestMetadata } from "./request-metadata.ts"
import { parseJsonObject } from "./validation.ts"

export type TransportContext = {
  request: Request
  body: Record<string, unknown>
  route: string[]
  actor: AuthenticatedActor
  db: ServiceRoleClient
  correlationId: string
  metadata: RequestMetadata
}

export type RouteHandler = (context: TransportContext) => Promise<Response | RpcResult>

export type HandleRequestDependencies = {
  authenticateRequest?: typeof authenticateRequest
  createServiceRoleClient?: typeof createServiceRoleClient
}

const logFailure = (
  metadata: RequestMetadata,
  actor: AuthenticatedActor | undefined,
  error: unknown,
) => {
  console.error(
    JSON.stringify({
      event: "edge_request_error",
      ...metadata,
      actorId: actor?.id ?? null,
      error: errorMessage(error),
    }),
  )
}

type RejectedSensitiveAttempt = {
  action: "access_denied" | "sensitive_export_denied" | "account_admin_denied" | "conflict_resolution_denied"
  targetType: string
  targetId: string | null
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const rejectedSensitiveAttempt = (
  method: string,
  route: string[],
): RejectedSensitiveAttempt | null => {
  if (method === "GET" && route[0] === "audit" && route[1] === "export")
    return { action: "sensitive_export_denied", targetType: "registro_auditoria", targetId: null }
  if (method === "POST" && route.length === 1 && route[0] === "backups")
    return { action: "sensitive_export_denied", targetType: "backup_manual", targetId: null }
  if (method === "GET" && route[0] === "certificates" && route[2] === "download")
    return { action: "sensitive_export_denied", targetType: "certificado", targetId: route[1] ?? null }
  if (method === "GET" && route[0] === "admin" && route[1] === "certificates" && route[3] === "download")
    return { action: "sensitive_export_denied", targetType: "certificado", targetId: route[2] ?? null }
  if (method === "GET") return null

  const accountAdminRoutes = new Set([
    "accounts", "mobile-workshops", "technicians", "staffing", "catalogs",
    "catalog-options", "test-standards", "certificate-templates",
  ])
  if (accountAdminRoutes.has(route[0])) {
    const targetId = route.find((segment) => UUID_SEGMENT.test(segment)) ?? null
    return { action: "account_admin_denied", targetType: "administracion", targetId }
  }
  if (route.includes("conflicts")) {
    const targetId = route.find((segment) => UUID_SEGMENT.test(segment)) ?? null
    return { action: "conflict_resolution_denied", targetType: "conflicto_sincronizacion", targetId }
  }
  if (["requests", "visits", "work-orders", "certificates", "clients", "yacimientos", "hierarchy", "valves"].includes(route[0])) {
    const targetId = route.find((segment) => UUID_SEGMENT.test(segment)) ?? null
    const targetType = route[0] === "visits" ? "visita_servicio"
      : route[0] === "requests" ? "solicitud_servicio"
      : route[0] === "work-orders" ? "orden_trabajo"
      : route[0] === "certificates" ? "certificado"
      : "administracion"
    return { action: "access_denied", targetType, targetId }
  }
  return null
}

const recordRejectedSensitiveAttempt = async (
  db: ServiceRoleClient,
  method: string,
  route: string[],
  code: string | undefined,
) => {
  if (code !== "42501" && code !== "insufficient_privilege") return
  const rejected = rejectedSensitiveAttempt(method, route)
  if (!rejected) return
  try {
    await db.rpc("record_sensitive_rejection", {
      action_name: rejected.action,
      target_type: rejected.targetType,
      target_id: rejected.targetId,
      change_summary: { method, route: route.join("/"), denial_code: code },
      related_ids: {},
    })
  } catch {
    // Keep the original denial response if the audit write itself fails.
  }
}
export const handleRequest = async (
  request: Request,
  functionName: FunctionName,
  handler: RouteHandler,
  dependencies: HandleRequestDependencies = {},
): Promise<Response> => {
  const id = correlationId(request.headers)
  const route = parseRoute(request, functionName)
  const metadata = requestMetadata(request, functionName, route, id)

  if (request.method === "OPTIONS") return preflight(request, id)

  let actor: AuthenticatedActor | undefined
  try {
    actor = await (dependencies.authenticateRequest ?? authenticateRequest)(request)
    const db = await (dependencies.createServiceRoleClient ?? createServiceRoleClient)({
      actorId: actor.id,
      correlationId: id,
      functionName,
    })

    if (!canHandleRoute(functionName, request.method, route)) return routeNotFound(request, id)

    // Some handlers call Storage before making a PostgREST request. Verify the
    // current Cuenta state centrally so those side effects receive the same
    // immediate disablement behavior as database-backed handlers.
    const accountContext = await db.rpc("api_context")
    if (accountContext.error) {
      const denied = accountContext.error.code === "42501" ||
        accountContext.error.code === "insufficient_privilege"
      const inactive = accountContext.error.message?.includes("Cuenta is not active") ?? false
      if (denied) {
        await recordRejectedSensitiveAttempt(db, request.method, route, accountContext.error.code)
        const message = inactive ? "Cuenta is not active" : "Application access denied"
        return errorJson(request, { message }, 403, id)
      }
      return errorJson(request, { message: "Unable to verify account access" }, 503, id)
    }

    const contextRows = Array.isArray(accountContext.data)
      ? accountContext.data
      : accountContext.data && typeof accountContext.data === "object"
        ? [accountContext.data]
        : []
    const currentContext = contextRows.find(
      (row) => row && typeof row === "object" && (row as { cuenta_id?: unknown }).cuenta_id === actor?.id,
    ) as { estado?: unknown } | undefined
    if (currentContext?.estado !== "activa") {
      await recordRejectedSensitiveAttempt(db, request.method, route, "42501")
      return errorJson(request, { message: "Cuenta is not active" }, 403, id)
    }

    const body = request.method === "GET" ? {} : await parseBody(request)
    const outcome = await handler({
      request,
      body,
      route,
      actor,
      db,
      correlationId: id,
      metadata,
    })

    if (outcome instanceof Response) return outcome
    if (outcome.error) {
      await recordRejectedSensitiveAttempt(db, request.method, route, outcome.error.code)
      return errorJson(request, outcome.error, errorStatus(outcome.error), id)
    }
    return json(request, outcome.data, 200, id)
  } catch (error) {
    logFailure(metadata, actor, error)
    if (error instanceof HttpError) return errorJson(request, error, error.status, id)
    return errorJson(request, { message: "Service unavailable" }, 500, id)
  }
}

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData()
    return Object.fromEntries(form.entries())
  }
  return parseJsonObject(request)
}

export const serveFunction = (functionName: FunctionName, handler: RouteHandler) => {
  Deno.serve((request) => handleRequest(request, functionName, handler))
}

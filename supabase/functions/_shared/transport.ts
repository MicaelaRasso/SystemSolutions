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
    if (outcome.error) return errorJson(request, outcome.error, errorStatus(outcome.error), id)
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

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
): Promise<Response> => {
  const id = correlationId(request.headers)
  const route = parseRoute(request, functionName)
  const metadata = requestMetadata(request, functionName, route, id)

  if (request.method === "OPTIONS") return preflight(request, id)

  let actor: AuthenticatedActor | undefined
  try {
    actor = await authenticateRequest(request)
    const db = await createServiceRoleClient({
      actorId: actor.id,
      correlationId: id,
      functionName,
    })

    if (!canHandleRoute(functionName, request.method, route)) return routeNotFound(request, id)

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

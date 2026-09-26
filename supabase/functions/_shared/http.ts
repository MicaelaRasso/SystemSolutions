import { correlationHeaders } from "./correlation.ts"
import { corsHeaders, isAllowedOrigin } from "./cors.ts"
import { errorMessage } from "./errors.ts"
import { runtimeEnv } from "./runtime-env.ts"

const configuredOrigins = () => {
  const env = runtimeEnv()
  return env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN
}

export const json = (request: Request, body: unknown, status = 200, id?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(request.headers.get("origin"), configuredOrigins()),
      ...(id ? correlationHeaders(id) : {}),
    },
  })

export const preflight = (request: Request, id: string) => {
  if (!isAllowedOrigin(request.headers.get("origin"), configuredOrigins())) {
    return json(request, { error: "Origin not allowed" }, 403, id)
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request.headers.get("origin"), configuredOrigins()),
      ...correlationHeaders(id),
    },
  })
}

export const routeNotFound = (request: Request, id: string) =>
  json(request, { error: "Route not found" }, 404, id)

export const errorJson = (request: Request, error: unknown, status: number, id: string) =>
  json(request, { error: errorMessage(error) }, status, id)

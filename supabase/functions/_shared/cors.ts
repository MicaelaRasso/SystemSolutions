const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  "x-correlation-id",
  "traceparent",
  "tracestate",
  "baggage",
].join(", ")

const allowedOrigins = (configuredOrigins: string | undefined) =>
  new Set(
    (configuredOrigins ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )

export const isAllowedOrigin = (origin: string | null, configuredOrigins: string | undefined) =>
  !!origin && allowedOrigins(configuredOrigins).has(origin)

export const corsHeaders = (
  origin: string | null,
  configuredOrigins: string | undefined,
): HeadersInit => {
  if (!isAllowedOrigin(origin, configuredOrigins)) return {}

  return {
    "access-control-allow-origin": origin!,
    "access-control-allow-headers": DEFAULT_ALLOWED_HEADERS,
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    vary: "Origin",
  }
}

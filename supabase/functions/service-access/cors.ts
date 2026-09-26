const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
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

/**
 * CORS is opt-in. A deployment must explicitly configure ALLOWED_ORIGINS
 * (comma-separated) or the legacy single ALLOWED_ORIGIN; it never falls back
 * to a wildcard.
 */
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
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    vary: "Origin",
  }
}

export type RequestMetadata = {
  functionName: string
  method: string
  path: string
  route: string
  correlationId: string
  origin: string | null
  userAgent: string | null
  traceparent: string | null
  contentLength: string | null
}

export const requestMetadata = (
  request: Request,
  functionName: string,
  route: string[],
  correlationId: string,
): RequestMetadata => ({
  functionName,
  method: request.method,
  path: new URL(request.url).pathname,
  route: `/${route.join("/")}`,
  correlationId,
  origin: request.headers.get("origin"),
  userAgent: request.headers.get("user-agent"),
  traceparent: request.headers.get("traceparent"),
  contentLength: request.headers.get("content-length"),
})

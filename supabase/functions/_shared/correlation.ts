const CORRELATION_ID_HEADER = "x-correlation-id"
const REQUEST_ID_HEADER = "x-request-id"
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/

export const correlationId = (headers: Headers): string => {
  const supplied = headers.get(CORRELATION_ID_HEADER) ?? headers.get(REQUEST_ID_HEADER)
  return supplied && SAFE_CORRELATION_ID.test(supplied) ? supplied : crypto.randomUUID()
}

export const correlationHeaders = (id: string): HeadersInit => ({
  [CORRELATION_ID_HEADER]: id,
})

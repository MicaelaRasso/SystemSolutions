export type DatabaseError = {
  code?: string
  message?: string
}

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

export const errorStatus = (error: DatabaseError) => {
  if (error.code === "insufficient_privilege" || error.code === "42501") return 403
  if (error.code === "PGRST116" || error.code === "P0002" || error.code === "02000") return 404
  if (
    error.code === "23P01" ||
    error.code === "23514" ||
    error.code === "check_violation" ||
    error.code === "exclusion_violation"
  )
    return 409
  if (
    error.code === "invalid_parameter_value" ||
    error.code === "22023" ||
    error.code === "foreign_key_violation" ||
    error.code === "23503"
  )
    return 400
  return 500
}

export const errorMessage = (error: unknown, fallback = "Invalid request") => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  return fallback
}

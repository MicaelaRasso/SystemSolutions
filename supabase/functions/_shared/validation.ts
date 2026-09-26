import { HttpError } from "./errors.ts"

export const MAX_JSON_BODY_BYTES = 1_048_576

export const parseJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES)
    throw new HttpError(413, "Request body is too large")

  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HttpError(400, "Invalid JSON request body")
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "JSON request body must be an object")
  return value as Record<string, unknown>
}

const nullableTextFields = [
  "marca",
  "numero_serie",
  "modelo",
  "tipo",
  "diametro_entrada",
  "clase_entrada",
  "diametro_salida",
  "clase_salida",
  "rosca",
] as const

type NullableTextField = (typeof nullableTextFields)[number]

export type ValveUpdatePayload = {
  name: string
  razon_disponibilidad: "not_applicable" | "not_found" | null
} & Record<NullableTextField, string | null>

const isNullableText = (value: unknown): value is string | null =>
  typeof value === "string" || value === null

export const isValveUpdatePayload = (value: unknown): value is ValveUpdatePayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const payload = value as Record<string, unknown>
  return (
    typeof payload.name === "string" &&
    payload.name.trim().length > 0 &&
    nullableTextFields.every((field) => isNullableText(payload[field])) &&
    (payload.razon_disponibilidad === null ||
      payload.razon_disponibilidad === "not_applicable" ||
      payload.razon_disponibilidad === "not_found")
  )
}

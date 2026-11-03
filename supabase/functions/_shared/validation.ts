import { HttpError } from "./errors.ts"

export const MAX_JSON_BODY_BYTES = 1_048_576

export const parseJsonObject = async (request: Request): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES)
    throw new HttpError(413, "Request body is too large")

  const text = await request.text()
  if (!text.trim()) return {}

  let value: unknown
  try {
    value = JSON.parse(text)
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

const optionalNullableTextFields = [
  "precinto",
  "servicio",
  "pv",
  "notas",
] as const

const optionalNullableNumberFields = [
  "presion_operacion",
  "temperatura_operacion",
] as const

type NullableTextField = (typeof nullableTextFields)[number]
type OptionalNullableTextField = (typeof optionalNullableTextFields)[number]
type OptionalNullableNumberField = (typeof optionalNullableNumberFields)[number]

export type ValveUpdatePayload = {
  name: string
  razon_disponibilidad: "not_applicable" | "not_found" | null
} & Record<NullableTextField, string | null> &
  Partial<Record<OptionalNullableTextField, string | null>> &
  Partial<Record<OptionalNullableNumberField, number | null>>

const isNullableText = (value: unknown): value is string | null =>
  typeof value === "string" || value === null

const isOptionalNullableText = (value: unknown): value is string | null | undefined =>
  value === undefined || typeof value === "string" || value === null

const isOptionalNullableNumber = (value: unknown): value is number | null | undefined =>
  value === undefined ||
  value === null ||
  (typeof value === "number" && Number.isFinite(value))

export const isValveUpdatePayload = (value: unknown): value is ValveUpdatePayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const payload = value as Record<string, unknown>
  return (
    typeof payload.name === "string" &&
    payload.name.trim().length > 0 &&
    nullableTextFields.every((field) => isNullableText(payload[field])) &&
    optionalNullableTextFields.every((field) => isOptionalNullableText(payload[field])) &&
    optionalNullableNumberFields.every((field) => isOptionalNullableNumber(payload[field])) &&
    (payload.razon_disponibilidad === null ||
      payload.razon_disponibilidad === "not_applicable" ||
      payload.razon_disponibilidad === "not_found")
  )
}

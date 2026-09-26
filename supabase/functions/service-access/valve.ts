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

/**
 * Valve updates currently replace the complete technical-data document. Keeping
 * this check at the Edge boundary prevents an omitted field from becoming null
 * through an RPC default value.
 */
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

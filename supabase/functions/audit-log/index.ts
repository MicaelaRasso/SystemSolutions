import { HttpError } from "../_shared/errors.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { isUuid } from "../_shared/route.ts"
import { runtimeEnv } from "../_shared/runtime-env.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const isDate = (value: string) => {
  const match = DATE.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const optionalUuid = (value: string | null, name: string) => {
  if (value !== null && !isUuid(value)) throw new HttpError(400, `${name} must be a UUID`)
  return value
}

const csvCell = (value: unknown) => {
  const raw = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value) ?? String(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

const csvColumns = [
  ["id", "ID"],
  ["recibida_en", "Recibido en servidor"],
  ["evento_dispositivo_en", "Evento en dispositivo"],
  ["actor_cuenta_id", "ID de cuenta del actor"],
  ["actor_email", "Correo del actor"],
  ["actor_rol", "Rol del actor"],
  ["accion", "Acción"],
  ["tipo_objetivo", "Tipo de objetivo"],
  ["objetivo_id", "ID del objetivo"],
  ["resultado", "Resultado"],
  ["identidad_correlacion", "ID de correlación"],
  ["cliente_cuenta_id", "ID de cuenta del Cliente"],
  ["yacimiento_id", "ID de Yacimiento"],
  ["yacimiento_nombre", "Yacimiento"],
  ["visita_id", "ID de Visita de servicio"],
  ["certificado_id", "ID de Certificado"],
  ["resumen_cambio", "Resumen del cambio"],
  ["identificadores_relacionados", "Identificadores relacionados"],
] as const

const parseFilters = (request: Request) => {
  const query = new URL(request.url).searchParams
  const from = query.get("from")
  const to = query.get("to")
  if (from !== null && !isDate(from)) throw new HttpError(400, "from must be a valid date in YYYY-MM-DD format")
  if (to !== null && !isDate(to)) throw new HttpError(400, "to must be a valid date in YYYY-MM-DD format")
  if (from !== null && to !== null && from > to) throw new HttpError(400, "from must be before or equal to to")

  const outcome = query.get("outcome")
  if (outcome !== null && outcome !== "exitoso" && outcome !== "fallido")
    throw new HttpError(400, "outcome must be exitoso or fallido")

  const limitValue = query.get("limit") ?? "100"
  const offsetValue = query.get("offset") ?? "0"
  if (!/^(0|[1-9]\d*)$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100)
    throw new HttpError(400, "limit must be an integer between 1 and 100")
  if (!/^(0|[1-9]\d*)$/.test(offsetValue) || !Number.isSafeInteger(Number(offsetValue)))
    throw new HttpError(400, "offset must be a non-negative integer")

  return {
    from_date: from,
    to_date: to,
    actor_filter: optionalUuid(query.get("actor_id"), "actor_id"),
    action_filter: query.get("action"),
    target_type_filter: query.get("target_type"),
    outcome_filter: outcome,
    client_filter: optionalUuid(query.get("client_id"), "client_id"),
    yacimiento_filter: optionalUuid(query.get("yacimiento_id"), "yacimiento_id"),
    visit_filter: optionalUuid(query.get("visit_id"), "visit_id"),
    certificate_filter: optionalUuid(query.get("certificate_id"), "certificate_id"),
    limit_count: Number(limitValue),
    offset_count: Number(offsetValue),
  }
}

export const createAuditLogHandler = (): RouteHandler => async ({ request, route, db, correlationId }) => {
  if (request.method !== "GET" || route[0] !== "audit")
    return routeNotFound(request, correlationId)

  if (route.length === 2 && route[1] !== "export") {
    if (!isUuid(route[1])) throw new HttpError(400, "eventId must be a UUID")
    return db.rpc("api_audit_event", { event_id: route[1] })
  }

  if (route.length !== 1 && !(route.length === 2 && route[1] === "export"))
    return routeNotFound(request, correlationId)

  const isExport = route.length === 2
  const query = new URL(request.url).searchParams
  const format = query.get("format")
  const env = runtimeEnv()
  const headers = {
    ...corsHeaders(request.headers.get("origin"), env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN),
    "cache-control": "no-store",
    ...(correlationId ? { "x-correlation-id": correlationId } : {}),
  }
  if (isExport && format !== "json" && format !== "csv")
    return json(request, { error: "format must be json or csv" }, 400, correlationId)

  const result = await db.rpc(isExport ? "api_audit_export" : "api_audit_events", parseFilters(request))
  if (result.error || !isExport) return result

  const envelope = result.data as { items?: Record<string, unknown>[] } | null
  const events = envelope?.items ?? []
  if (format === "json")
    return new Response(JSON.stringify(events), {
      status: 200,
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=auditoria.json",
      },
    })

  const csv = [
    csvColumns.map(([, label]) => csvCell(label)).join(","),
    ...events.map((row) => csvColumns.map(([column]) => csvCell(row[column])).join(",")),
  ].join("\r\n")
  return new Response(`\uFEFF${csv}\r\n`, {
    status: 200,
    headers: {
      ...headers,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=auditoria.csv",
    },
  })
}

export const auditLogHandler = createAuditLogHandler()

serveFunction("audit-log", auditLogHandler)

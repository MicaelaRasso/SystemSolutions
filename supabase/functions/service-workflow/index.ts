import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { OPERATION_STATUSES, isUuid, parseOperationsQuery } from "../_shared/route.ts"
import {
  createSignedStorageUrl,
  uploadStorageObject,
  validateStorageObject,
} from "../_shared/storage.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"
import { runtimeEnv } from "../_shared/runtime-env.ts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.length > 0

const csvCell = (value: unknown) => {
  const raw = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

const auditCsvColumns = [
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

type OperationSummary = Record<string, unknown>
type OperationsListEnvelope = {
  items: OperationSummary[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}
type OperationDetailEnvelope = {
  operation: OperationSummary
  visit: Record<string, unknown>
  request: Record<string, unknown>
  work_orders: Record<string, unknown>[]
}

const isOperationSummary = (value: unknown): value is OperationSummary =>
  isRecord(value) &&
  Object.keys(value).length === 10 &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.solicitud_id) &&
  typeof value.numero_solicitud === "number" &&
  Number.isSafeInteger(value.numero_solicitud) &&
  OPERATION_STATUSES.includes(value.estado as (typeof OPERATION_STATUSES)[number]) &&
  isNonEmptyString(value.starts_at) &&
  isNonEmptyString(value.ends_at) &&
  isNamedReference(value.cliente) &&
  isNamedReference(value.yacimiento) &&
  (value.taller_movil === null || isNamedReference(value.taller_movil)) &&
  isOperationCounts(value.ordenes)

const isNamedReference = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isNonEmptyString(value.id) &&
  isString(value.nombre)

const isOperationCounts = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === 4 &&
  ["total", "pendientes", "evaluadas", "no_evaluadas"].every(
    (key) =>
      typeof value[key] === "number" &&
      Number.isSafeInteger(value[key]) &&
      (value[key] as number) >= 0,
  )

export const isOperationRow = (value: unknown): value is OperationSummary =>
  isOperationSummary(value)

const isOperationsListEnvelope = (
  value: unknown,
  query: { limit: number; offset: number },
): value is OperationsListEnvelope => {
  if (!isRecord(value)) return false
  return (
    Object.keys(value).length === 5 &&
    Array.isArray(value.items) &&
    value.items.every(isOperationRow) &&
    typeof value.total === "number" &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    value.limit === query.limit &&
    Number.isSafeInteger(value.limit) &&
    value.limit > 0 &&
    value.limit <= 100 &&
    value.offset === query.offset &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0 &&
    typeof value.has_more === "boolean"
  )
}

const isOperationDetailEnvelope = (value: unknown): value is OperationDetailEnvelope =>
  isRecord(value) &&
  Object.keys(value).length === 4 &&
  isOperationSummary(value.operation) &&
  isVisitDto(value.visit) &&
  isRequestDto(value.request) &&
  Array.isArray(value.work_orders) &&
  value.work_orders.every(isWorkOrderDto)

const isVisitDto = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isRecord(value.visit) &&
  isNonEmptyString(value.visit.id) &&
  Array.isArray(value.work_orders) &&
  value.work_orders.every((workOrder) => isRawWorkOrderDto(workOrder) || isWorkOrderDto(workOrder))

const isRequestDto = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isRecord(value.request) &&
  isNonEmptyString(value.request.id) &&
  Array.isArray(value.selected_valves) &&
  value.selected_valves.every(
    (selected) => isRecord(selected) && isNonEmptyString(selected.id) && isString(selected.name),
  )

const isRawWorkOrderDto = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isNonEmptyString(value.id)

const isWorkOrderDto = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === 3 &&
  isRawWorkOrderDto(value.work_order) &&
  isValveDto(value.valve) &&
  isWorkOrderContext(value.context)

const isValveDto = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.equipo_id) &&
  isString(value.nombre)

const isWorkOrderContext = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isContextYacimiento(value.yacimiento) &&
  isContextPlanta(value.planta) &&
  isContextEquipo(value.equipo)

const isContextYacimiento = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isNonEmptyString(value.id) && isString(value.nombre)

const isContextPlanta = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.yacimiento_id) &&
  isString(value.nombre)

const isContextEquipo = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.planta_id) &&
  isString(value.nombre)

const invalidRpcResponse = (): never => {
  throw new HttpError(502, "Invalid operation response")
}

export const serviceWorkflowHandler: RouteHandler = async ({
  request,
  route,
  body,
  db,
  correlationId,
}) => {
  const segments = route

  if (segments[0] === "attachments" && request.method === "POST" && segments.length === 1) {
    const file = body.file instanceof File ? body.file : null
    if (!file) return json(request, { error: "An attachment file is required" }, 400, correlationId)
    const objectName = `temporary/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "-")}`
    const validation = validateStorageObject(
      { objectName, contentType: file.type, size: file.size },
      {
        allowedMimeTypes: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/msword",
        ],
        maxBytes: 10 * 1024 * 1024,
      },
    )
    if (!validation.ok) return json(request, { error: validation.error }, 400, correlationId)
    await uploadStorageObject("attachments", validation.metadata.objectName, file)
    return json(
      request,
      {
        id: crypto.randomUUID(),
        nombre: file.name,
        tipo: file.type || "application/octet-stream",
        url: await createSignedStorageUrl("attachments", validation.metadata.objectName),
      },
      200,
      correlationId,
    )
  }

  // Frontend: legacy TareaResumen -> backend: canonical Solicitud/Visita
  // projection. No Tarea table is created.
  if (segments[0] === "operations" && request.method === "GET" && segments.length === 1) {
    const query = parseOperationsQuery(request)
    const result = await db.rpc("api_operations", {
      from_date: query.from,
      to_date: query.to,
      status_filter: query.status,
      workshop_filter: query.workshopId,
      client_filter: query.clientId,
      search_text: query.q,
      limit_count: query.limit,
      offset_count: query.offset,
    })
    if (result.error) return result
    if (!isOperationsListEnvelope(result.data, query)) invalidRpcResponse()
    return result
  }
  if (segments[0] === "operations" && request.method === "GET" && segments.length === 2) {
    if (!isUuid(segments[1])) throw new HttpError(400, "operationId must be a UUID")
    const result = await db.rpc("api_operation", { target_visit: segments[1] })
    if (result.error) return result
    if (result.data === null)
      return json(request, { error: "Operation not found" }, 404, correlationId)
    if (!isOperationDetailEnvelope(result.data)) invalidRpcResponse()
    return { data: result.data, error: null }
  }

  if (segments[0] === "audit" && request.method === "GET" && (segments.length === 1 || (segments.length === 2 && segments[1] === "export"))) {
    const query = new URL(request.url).searchParams
    const isExport = segments[1] === "export"
    const format = query.get("format")
    if (isExport && format !== "json" && format !== "csv")
      return json(request, { error: "format must be json or csv" }, 400, correlationId)
    const result = await db.rpc(isExport ? "api_audit_export" : "api_audit_events", {
      from_date: query.get("from"), to_date: query.get("to"),
      actor_filter: query.get("actor_id"), action_filter: query.get("action"),
      target_type_filter: query.get("target_type"), outcome_filter: query.get("outcome"),
      client_filter: query.get("client_id"), yacimiento_filter: query.get("yacimiento_id"),
      visit_filter: query.get("visit_id"), certificate_filter: query.get("certificate_id"),
      limit_count: Number(query.get("limit") ?? 100), offset_count: Number(query.get("offset") ?? 0),
    })
    if (result.error) return result
    if (!isExport) return result
    const envelope = result.data as { items?: Record<string, unknown>[] }
    const events = envelope.items ?? []
    if (format === "json") return new Response(JSON.stringify(events), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=auditoria.json", ...(correlationId ? { "x-correlation-id": correlationId } : {}) } })
    const csv = [auditCsvColumns.map(([, label]) => csvCell(label)).join(","), ...events.map((row) => auditCsvColumns.map(([column]) => csvCell(row[column])).join(","))].join("\r\n")
    return new Response(`\uFEFF${csv}\r\n`, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=auditoria.csv",
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
    })
  }

  if (segments[0] === "audit" && request.method === "GET" && segments.length === 2)
    return db.rpc("api_audit_event", { event_id: segments[1] })

  if (segments[0] === "admin" && request.method === "GET" && segments[1] === "metrics") {
    const query = new URL(request.url).searchParams
    return db.rpc("api_admin_metrics", { period_from: query.get("from"), period_to: query.get("to") })
  }
  if (segments[0] === "admin" && request.method === "GET" && segments[1] === "certificates" && !segments[2]) {
    const query = new URL(request.url).searchParams
    return db.rpc("api_admin_certificate_history", {
      client_filter: query.get("client_id"), yacimiento_filter: query.get("yacimiento_id"), plant_filter: query.get("plant_id"),
      valve_filter: query.get("valve_id"), state_filter: query.get("state"), signature_state_filter: query.get("signature_state"),
      valid_until_filter: query.get("valid_until"),
      search_text: query.get("q"),
      limit_count: Number(query.get("limit") ?? 100), offset_count: Number(query.get("offset") ?? 0),
    })
  }
  if (segments[0] === "admin" && request.method === "GET" && segments[1] === "certificates" && segments[2])
    return db.rpc(segments[3] === "download" ? "api_admin_certificate_export" : "api_admin_certificate", { certificate_id: segments[2] })

  if (
    segments[0] === "admin" && segments[1] === "requests" &&
    request.method === "POST" && segments.length === 2
  ) {
    const authorization = await db.rpc("api_actor_is_admin", {})
    if (authorization.error) return authorization
    if (authorization.data !== true) throw new HttpError(403, "Only an active Administrador can create a service request")
    return db.rpc("api_admin_create_service_request", {
      target_client: body.cliente_cuenta_id,
      target_yacimiento: body.yacimiento_id,
      selections: body.selections,
    })
  }

  if (
    segments[0] === "requests" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "schedule"
  )
    return db.rpc("api_schedule_visit", {
      request_id: segments[1],
      provider_id: body.taller_movil_id,
      visit_starts_at: body.starts_at ?? null,
      visit_ends_at: body.ends_at ?? null,
    })
  if (segments[0] === "requests" && request.method === "GET" && !segments[1])
    return db.rpc("api_service_requests")
  if (segments[0] === "requests" && request.method === "GET" && segments[1])
    return db.rpc("api_service_request", {
      request_id: segments[1],
    })
  if (segments[0] === "requests" && request.method === "POST" && !segments[1])
    return db.rpc("api_create_service_request", {
      target_yacimiento: body.yacimiento_id,
      selections: body.selections,
    })
  if (segments[0] === "requests" && request.method === "PATCH" && segments[1])
    return db.rpc("api_update_service_request", {
      request_id: segments[1],
      selections: body.selections,
    })
  if (segments[0] === "visits" && request.method === "GET" && !segments[1])
    return db.rpc("api_visits")
  if (segments[0] === "visits" && request.method === "GET" && segments[1] && !segments[2])
    return db.rpc("api_visit", { visit_id: segments[1] })
  if (
    segments[0] === "visits" && request.method === "POST" &&
    segments[1] && segments[2] === "assign"
  )
    return db.rpc("api_assign_visit", {
      visit_id: segments[1],
      provider_id: body.taller_movil_id,
      action_reason: body.reason,
      visit_starts_at: body.starts_at ?? null,
      visit_ends_at: body.ends_at ?? null,
    })
  if (
    segments[0] === "visits" && request.method === "POST" &&
    segments[1] && segments[2] === "unassign"
  )
    return db.rpc("api_unassign_visit", {
      visit_id: segments[1],
      action_reason: body.reason,
    })
  if (
    segments[0] === "visits" && request.method === "POST" &&
    segments[1] && segments[2] === "reassign"
  )
    return db.rpc("api_reassign_visit", {
      visit_id: segments[1],
      provider_id: body.taller_movil_id,
      action_reason: body.reason,
      visit_starts_at: body.starts_at,
      visit_ends_at: body.ends_at,
    })
  if (
    segments[0] === "visits" && request.method === "POST" &&
    segments[1] && segments[2] === "cancel-administrator"
  )
    return db.rpc("api_admin_cancel_visit", {
      visit_id: segments[1],
      action_reason: body.reason,
    })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "accept"
  )
    return db.rpc("api_accept_visit", { visit_id: segments[1] })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "reject"
  )
    return db.rpc("api_reject_visit", { visit_id: segments[1] })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "cancel"
  )
    return db.rpc("api_cancel_visit", { visit_id: segments[1] })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "start"
  ) {
    const replacementCatalogVersionId = typeof body.replacement_catalog_version_id === "string"
      ? body.replacement_catalog_version_id
      : ""
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    if (!isUuid(replacementCatalogVersionId) || !isUuid(deviceId))
      throw new HttpError(400, "A valid replacement catalog version and device_id are required")
    return db.rpc("api_start_visit_with_catalog", {
      visit_id: segments[1],
      replacement_catalog_version_id: replacementCatalogVersionId,
      target_device: deviceId,
    })
  }
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "complete"
  ) {
    const completed = await db.rpc("api_complete_visit", { visit_id: segments[1] })
    const env = runtimeEnv()
    if (!completed.error && env.SUPABASE_URL && env.MAILER_WORKER_TOKEN) {
      const wakeMailer = async () => {
        try {
          const response = await fetch(`${env.SUPABASE_URL}/functions/v1/email-delivery/internal/process`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-mailer-worker-token": env.MAILER_WORKER_TOKEN },
            body: JSON.stringify({ enqueue_expiry: false }),
            signal: AbortSignal.timeout(30_000),
          })
          if (!response.ok) throw new Error(`Mailer worker returned ${response.status}`)
        } catch (error) {
          // The visit and its queued notice are already committed. The scheduled
          // worker will deliver it if this best-effort immediate wake-up fails.
          console.error("pending_signature_worker_wakeup_failed", error)
        }
      }
      const edgeRuntime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void }
      }).EdgeRuntime
      if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(wakeMailer())
      else await wakeMailer()
    }
    return completed
  }
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "work-orders"
  )
    return db.rpc("api_add_work_order", {
      visit_id: segments[1],
      target_valvula: body.valvula_id,
    })
  if (segments[0] === "work-orders" && request.method === "PATCH" && segments[1])
    return db.rpc("api_update_work_order", {
      work_order_id: segments[1],
      outcome: body.outcome,
      not_evaluated_reason: body.not_evaluated_reason,
    })

  return routeNotFound(request, correlationId)
}

serveFunction("service-workflow", serviceWorkflowHandler)

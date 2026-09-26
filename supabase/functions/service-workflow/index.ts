import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { OPERATION_STATUSES, isUuid, parseOperationsQuery } from "../_shared/route.ts"
import {
  createSignedStorageUrl,
  uploadStorageObject,
  validateStorageObject,
} from "../_shared/storage.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.length > 0

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

  if (
    segments[0] === "requests" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "schedule"
  )
    return db.rpc("api_schedule_visit", {
      request_id: segments[1],
      provider_id: body.taller_movil_id,
      visit_starts_at: body.starts_at,
      visit_ends_at: body.ends_at,
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
  )
    return db.rpc("api_start_visit", { visit_id: segments[1] })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "complete"
  )
    return db.rpc("api_complete_visit", { visit_id: segments[1] })
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

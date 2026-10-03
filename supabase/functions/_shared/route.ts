import { HttpError } from "./errors.ts"

export type FunctionName =
  | "identity-admin"
  | "asset-access"
  | "service-workflow"
  | "certificate-field"
  | "offline-sync"
  | "backup-export"

export const parseRoute = (request: Request, functionName: string): string[] => {
  const rawSegments = new URL(request.url).pathname.split("/").filter(Boolean)
  const functionIndex = rawSegments.indexOf(functionName)
  return functionIndex >= 0 ? rawSegments.slice(functionIndex + 1) : rawSegments
}

const is = (route: string[], ...expected: string[]) =>
  route.length === expected.length && expected.every((segment, index) => segment === route[index])

export const OPERATION_STATUSES = [
  "solicitada",
  "programada",
  "aceptada",
  "en_curso",
  "completada",
  "cancelada",
] as const

export type OperationStatus = (typeof OPERATION_STATUSES)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const INTEGER = /^(0|[1-9]\d*)$/

export const isUuid = (value: string) => UUID.test(value)

const isDate = (value: string) => {
  const match = DATE.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const invalidQuery = (message: string): never => {
  throw new HttpError(400, message)
}

const parseQueryInteger = (
  value: string | null,
  name: string,
  fallback: number,
  maximum?: number,
) => {
  if (value === null) return fallback
  if (!INTEGER.test(value)) invalidQuery(`${name} must be a non-negative integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) invalidQuery(`${name} is too large`)
  if (maximum !== undefined && parsed > maximum) invalidQuery(`${name} must be at most ${maximum}`)
  if (name === "limit" && parsed === 0) invalidQuery("limit must be greater than zero")
  return parsed
}

export type OperationsQuery = {
  from: string | null
  to: string | null
  status: string | null
  workshopId: string | null
  clientId: string | null
  q: string | null
  limit: number
  offset: number
}

export const parseOperationsQuery = (request: Request): OperationsQuery => {
  const query = new URL(request.url).searchParams
  const from = query.get("from")
  const to = query.get("to")
  if (from !== null && !isDate(from)) invalidQuery("from must be a valid date in YYYY-MM-DD format")
  if (to !== null && !isDate(to)) invalidQuery("to must be a valid date in YYYY-MM-DD format")
  if (from !== null && to !== null && from > to) invalidQuery("from must be before or equal to to")

  const statusValue = query.get("status")
  let status: string | null = null
  if (statusValue !== null) {
    const statuses = statusValue.split(",").map((item) => item.trim())
    if (statuses.some((item) => !OPERATION_STATUSES.includes(item as OperationStatus)))
      invalidQuery("status contains an unsupported operation status")
    status = statuses.join(",")
  }

  const workshopId = query.get("workshop_id")
  if (workshopId !== null && !isUuid(workshopId)) invalidQuery("workshop_id must be a UUID")
  const clientId = query.get("client_id")
  if (clientId !== null && !isUuid(clientId)) invalidQuery("client_id must be a UUID")

  const rawQ = query.get("q")
  const q = rawQ?.trim() ?? null
  if (q !== null && (!q || q.length > 200 || /[\u0000-\u001f\u007f]/.test(q)))
    invalidQuery("q must be a valid search string of at most 200 characters")

  return {
    from,
    to,
    status,
    workshopId,
    clientId,
    q,
    limit: parseQueryInteger(query.get("limit"), "limit", 100, 100),
    offset: parseQueryInteger(query.get("offset"), "offset", 0),
  }
}

export const routeOwner = (method: string, route: string[]): FunctionName | null => {
  if (method === "POST" && route.length === 1 && route[0] === "backups") return "backup-export"

  if (
    (method === "GET" && (route.length === 0 || is(route, "context"))) ||
    (route[0] === "accounts" && ["GET", "PATCH", "DELETE", "PUT"].includes(method)) ||
    (route[0] === "mobile-workshops" && ["GET", "POST", "PATCH"].includes(method)) ||
    (route[0] === "technicians" && ["GET", "POST", "PATCH"].includes(method)) ||
    (route[0] === "staffing" && ["GET", "PUT"].includes(method)) ||
    (route[0] === "catalogs" && ["GET", "POST", "PUT"].includes(method)) ||
    (route[0] === "catalog-options" && method === "PATCH") ||
    (route[0] === "test-standards" && ["GET", "POST", "PATCH"].includes(method))
  )
    return "identity-admin"

  if (method === "GET" && is(route, "clients", "me", "pending-certificates"))
    return "certificate-field"

  if (
    (method === "GET" && is(route, "certificate-templates", "active")) ||
    (method === "GET" && is(route, "certificate-templates")) ||
    (method === "POST" && is(route, "certificate-templates")) ||
    (method === "PATCH" && route[0] === "certificate-templates" && route.length === 2) ||
    (method === "POST" &&
      route[0] === "certificate-templates" &&
      route.length === 3 &&
      route[2] === "activate") ||
    (method === "GET" && is(route, "certificate-capture", "catalogs"))
  )
    return "certificate-field"

  if (
    (route[0] === "clients" && ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) ||
    (method === "GET" && is(route, "yacimientos")) ||
    (method === "POST" && is(route, "yacimientos")) ||
    (method === "PATCH" && route[0] === "yacimientos" && route.length === 2) ||
    (method === "GET" && route[0] === "yacimientos" && route.length === 3 && route[2] === "tree") ||
    (method === "GET" &&
      route[0] === "yacimientos" &&
      route.length === 3 &&
      route[2] === "assignment") ||
    (method === "POST" && is(route, "hierarchy")) ||
    (method === "PATCH" && route[0] === "hierarchy" && route.length === 2) ||
    (method === "GET" && route[0] === "valves" && route.length === 2) ||
    (method === "PATCH" && route[0] === "valves" && route.length === 2)
  )
    return "asset-access"

  if (method === "POST" && route[0] === "admin" && route[1] === "requests" && route.length === 2)
    return "service-workflow"

  if (
    (method === "POST" &&
      route[0] === "requests" &&
      route.length === 3 &&
      route[2] === "schedule") ||
    (method === "GET" && route[0] === "requests" && (route.length === 1 || route.length === 2)) ||
    (method === "POST" && is(route, "requests")) ||
    (method === "PATCH" && route[0] === "requests" && route.length === 2) ||
    (method === "GET" && route[0] === "visits" && (route.length === 1 || route.length === 2)) ||
    (method === "POST" &&
      route[0] === "visits" &&
      route.length === 3 &&
      ["accept", "reject", "cancel", "start", "complete", "work-orders"].includes(route[2])) ||
    (method === "PATCH" && route[0] === "work-orders" && route.length === 2) ||
    (method === "GET" && route[0] === "operations" && (route.length === 1 || route.length === 2)) ||
    (method === "GET" &&
      route[0] === "audit" &&
      (route.length === 1 || (route.length === 2 && route[1] === "export"))) ||
    (method === "GET" && route[0] === "audit" && route.length === 2) ||
    (method === "GET" && route[0] === "admin" && route.length >= 2) ||
    (method === "POST" && is(route, "attachments"))
  )
    return "service-workflow"

  if (
    (method === "POST" &&
      route[0] === "work-orders" &&
      route.length === 3 &&
      route[2] === "certificate-draft") ||
    (method === "GET" && route[0] === "certificates" && route.length === 2) ||
    (method === "PATCH" && route[0] === "certificates" && route.length === 2) ||
    (method === "GET" &&
      route[0] === "certificates" &&
      route.length === 3 &&
      ["finalized", "download"].includes(route[2])) ||
    (method === "GET" &&
      route[0] === "valves" &&
      route.length === 3 &&
      route[2] === "certificates") ||
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "signatures")
  )
    return "certificate-field"

  if (
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "sync") ||
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "claim") ||
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "media") ||
    (method === "GET" && is(route, "offline", "working-set"))
  )
    return "offline-sync"

  return null
}

export const canHandleRoute = (
  functionName: FunctionName,
  method: string,
  route: string[],
): boolean => {
  const owner = routeOwner(method, route)
  return owner === functionName
}

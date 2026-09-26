export type FunctionName =
  | "service-access"
  | "identity-admin"
  | "asset-access"
  | "service-workflow"
  | "certificate-field"
  | "offline-sync"

export const parseRoute = (request: Request, functionName: string): string[] => {
  const rawSegments = new URL(request.url).pathname.split("/").filter(Boolean)
  const functionIndex = rawSegments.indexOf(functionName)
  return functionIndex >= 0 ? rawSegments.slice(functionIndex + 1) : rawSegments
}

const is = (route: string[], ...expected: string[]) =>
  route.length === expected.length && expected.every((segment, index) => segment === route[index])

export const routeOwner = (method: string, route: string[]): FunctionName | null => {
  if (method === "GET" && (route.length === 0 || is(route, "context"))) return "identity-admin"

  if (
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
    (method === "PATCH" && route[0] === "work-orders" && route.length === 2)
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
      route[2] === "finalized") ||
    (method === "GET" &&
      route[0] === "valves" &&
      route.length === 3 &&
      route[2] === "certificates") ||
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "signatures")
  )
    return "certificate-field"

  if (
    (method === "POST" && route[0] === "visits" && route.length === 3 && route[2] === "sync") ||
    (method === "GET" && is(route, "offline", "working-set"))
  )
    return "offline-sync"

  return null
}

/**
 * The legacy gateway may serve a route during rollout, but it must not become
 * an owner for routes that have not been assigned to a direct function.
 */
export const canHandleRoute = (
  functionName: FunctionName,
  method: string,
  route: string[],
): boolean => {
  const owner = routeOwner(method, route)
  return owner === functionName || (functionName === "service-access" && owner !== null)
}

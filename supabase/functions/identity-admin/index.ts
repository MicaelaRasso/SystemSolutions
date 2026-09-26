import { routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("identity-admin", async ({ request, route, db, correlationId }) => {
  if (route.length === 0 || route[0] === "context") return db.rpc("api_context")

  return routeNotFound(request, correlationId)
})

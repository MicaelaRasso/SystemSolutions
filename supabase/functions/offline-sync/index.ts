import { routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("offline-sync", async ({ request, route, body, db, correlationId }) => {
  const segments = route

  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "sync"
  )
    return db.rpc("api_sync_visit_batch", {
      target_visit: segments[1],
      operations: body.operations,
      target_device: body.device_id,
    })
  if (segments[0] === "offline" && segments[1] === "working-set" && request.method === "GET")
    return db.rpc("api_offline_working_set")

  return routeNotFound(request, correlationId)
})

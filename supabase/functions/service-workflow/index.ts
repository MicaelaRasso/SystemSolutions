import { routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("service-workflow", async ({ request, route, body, db, correlationId }) => {
  const segments = route

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
})

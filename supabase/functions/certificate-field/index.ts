import { routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("certificate-field", async ({ request, route, body, db, correlationId }) => {
  const segments = route

  if (
    segments[0] === "work-orders" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "certificate-draft"
  )
    return db.rpc("api_start_certificate_draft", {
      work_order_id: segments[1],
    })
  if (segments[0] === "certificates" && request.method === "GET" && segments[1] && !segments[2])
    return db.rpc("api_certificate_draft", {
      certificate_id: segments[1],
    })
  if (segments[0] === "certificates" && request.method === "PATCH" && segments[1])
    return db.rpc("api_update_certificate_draft", {
      certificate_id: segments[1],
      payload: body,
    })
  if (
    segments[0] === "certificates" &&
    request.method === "GET" &&
    segments[1] &&
    segments[2] === "finalized"
  )
    return db.rpc("api_finalized_certificate", {
      certificate_id: segments[1],
    })
  if (
    segments[0] === "valves" &&
    request.method === "GET" &&
    segments[1] &&
    segments[2] === "certificates"
  )
    return db.rpc("api_valvula_certificates", {
      target_valvula: segments[1],
    })
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "signatures"
  )
    return db.rpc("api_submit_visit_signature", {
      target_visit: segments[1],
      signing_party: body.party,
      signer_name: body.signer_name,
      bucket_name: body.bucket,
      asset_path: body.object_path,
    })

  return routeNotFound(request, correlationId)
})

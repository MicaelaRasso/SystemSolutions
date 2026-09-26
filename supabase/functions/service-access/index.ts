import { isValveUpdatePayload } from "../_shared/validation.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("service-access", async ({ request, route: segments, body, db, correlationId }) => {
  let result
  let error
  try {
    if (segments.length === 0 || segments[0] === "context")
      ({ data: result, error } = await db.rpc("api_context"))
    else if (segments[0] === "yacimientos" && request.method === "GET" && !segments[1])
      ({ data: result, error } = await db.rpc("api_yacimientos"))
    else if (segments[0] === "yacimientos" && request.method === "POST" && !segments[1])
      ({ data: result, error } = await db.rpc("api_create_yacimiento", {
        asset_name: body.name,
        asset_provincia: body.provincia,
        asset_operadora: body.operadora,
        asset_contratista: body.contratista,
      }))
    else if (
      segments[0] === "yacimientos" &&
      request.method === "PATCH" &&
      segments[1] &&
      !segments[2]
    )
      ({ data: result, error } = await db.rpc("api_update_yacimiento", {
        target: segments[1],
        asset_name: body.name,
        asset_provincia: body.provincia,
        asset_operadora: body.operadora,
        asset_contratista: body.contratista,
      }))
    else if (
      segments[0] === "yacimientos" &&
      segments[1] &&
      segments[2] === "tree" &&
      request.method === "GET"
    )
      ({ data: result, error } = await db.rpc("api_yacimiento_tree", { target: segments[1] }))
    else if (
      segments[0] === "yacimientos" &&
      segments[1] &&
      segments[2] === "assignment" &&
      request.method === "GET"
    )
      ({ data: result, error } = await db.rpc("api_assignment", { target: segments[1] }))
    else if (segments[0] === "hierarchy" && request.method === "POST")
      ({ data: result, error } = await db.rpc("api_create_descendant", {
        kind: body.kind,
        parent_id: body.parent_id,
        asset_name: body.name,
      }))
    else if (segments[0] === "hierarchy" && request.method === "PATCH" && segments[1])
      ({ data: result, error } = await db.rpc("api_update_descendant", {
        kind: body.kind,
        target: segments[1],
        asset_name: body.name,
      }))
    else if (
      segments[0] === "requests" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "schedule"
    )
      ({ data: result, error } = await db.rpc("api_schedule_visit", {
        request_id: segments[1],
        provider_id: body.taller_movil_id,
        visit_starts_at: body.starts_at,
        visit_ends_at: body.ends_at,
      }))
    else if (segments[0] === "requests" && request.method === "GET" && !segments[1])
      ({ data: result, error } = await db.rpc("api_service_requests"))
    else if (segments[0] === "requests" && request.method === "GET" && segments[1])
      ({ data: result, error } = await db.rpc("api_service_request", {
        request_id: segments[1],
      }))
    else if (segments[0] === "requests" && request.method === "POST" && !segments[1])
      ({ data: result, error } = await db.rpc("api_create_service_request", {
        target_yacimiento: body.yacimiento_id,
        selections: body.selections,
      }))
    else if (segments[0] === "requests" && request.method === "PATCH" && segments[1])
      ({ data: result, error } = await db.rpc("api_update_service_request", {
        request_id: segments[1],
        selections: body.selections,
      }))
    else if (segments[0] === "visits" && request.method === "GET" && !segments[1])
      ({ data: result, error } = await db.rpc("api_visits"))
    else if (segments[0] === "visits" && request.method === "GET" && segments[1] && !segments[2])
      ({ data: result, error } = await db.rpc("api_visit", { visit_id: segments[1] }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "accept"
    )
      ({ data: result, error } = await db.rpc("api_accept_visit", { visit_id: segments[1] }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "reject"
    )
      ({ data: result, error } = await db.rpc("api_reject_visit", { visit_id: segments[1] }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "cancel"
    )
      ({ data: result, error } = await db.rpc("api_cancel_visit", { visit_id: segments[1] }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "start"
    )
      ({ data: result, error } = await db.rpc("api_start_visit", { visit_id: segments[1] }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "complete"
    )
      ({ data: result, error } = await db.rpc("api_complete_visit", {
        visit_id: segments[1],
      }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "work-orders"
    )
      ({ data: result, error } = await db.rpc("api_add_work_order", {
        visit_id: segments[1],
        target_valvula: body.valvula_id,
      }))
    else if (segments[0] === "work-orders" && request.method === "PATCH" && segments[1])
      ({ data: result, error } = await db.rpc("api_update_work_order", {
        work_order_id: segments[1],
        outcome: body.outcome,
        not_evaluated_reason: body.not_evaluated_reason,
      }))
    else if (
      segments[0] === "work-orders" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "certificate-draft"
    )
      ({ data: result, error } = await db.rpc("api_start_certificate_draft", {
        work_order_id: segments[1],
      }))
    else if (
      segments[0] === "certificates" &&
      request.method === "GET" &&
      segments[1] &&
      !segments[2]
    )
      ({ data: result, error } = await db.rpc("api_certificate_draft", {
        certificate_id: segments[1],
      }))
    else if (segments[0] === "certificates" && request.method === "PATCH" && segments[1])
      ({ data: result, error } = await db.rpc("api_update_certificate_draft", {
        certificate_id: segments[1],
        payload: body,
      }))
    else if (
      segments[0] === "certificates" &&
      request.method === "GET" &&
      segments[1] &&
      segments[2] === "finalized"
    )
      ({ data: result, error } = await db.rpc("api_finalized_certificate", {
        certificate_id: segments[1],
      }))
    else if (segments[0] === "valves" && request.method === "GET" && segments[1] && !segments[2])
      ({ data: result, error } = await db.rpc("api_valvula", {
        target: segments[1],
      }))
    else if (
      segments[0] === "valves" &&
      request.method === "PATCH" &&
      segments[1] &&
      !segments[2]
    ) {
      if (!isValveUpdatePayload(body)) {
        return json(request, { error: "Invalid valve update payload" }, 400, correlationId)
      }
      ;({ data: result, error } = await db.rpc("api_update_valvula", {
        target: segments[1],
        asset_name: body.name,
        asset_marca: body.marca,
        asset_numero_serie: body.numero_serie,
        asset_modelo: body.modelo,
        asset_tipo: body.tipo,
        asset_diametro_entrada: body.diametro_entrada,
        asset_clase_entrada: body.clase_entrada,
        asset_diametro_salida: body.diametro_salida,
        asset_clase_salida: body.clase_salida,
        asset_rosca: body.rosca,
        asset_razon_disponibilidad: body.razon_disponibilidad,
      }))
    } else if (
      segments[0] === "valves" &&
      request.method === "GET" &&
      segments[1] &&
      segments[2] === "certificates"
    )
      ({ data: result, error } = await db.rpc("api_valvula_certificates", {
        target_valvula: segments[1],
      }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "signatures"
    )
      ({ data: result, error } = await db.rpc("api_submit_visit_signature", {
        target_visit: segments[1],
        signing_party: body.party,
        signer_name: body.signer_name,
        bucket_name: body.bucket,
        asset_path: body.object_path,
      }))
    else if (
      segments[0] === "visits" &&
      request.method === "POST" &&
      segments[1] &&
      segments[2] === "sync"
    )
      ({ data: result, error } = await db.rpc("api_sync_visit_batch", {
        target_visit: segments[1],
        operations: body.operations,
        target_device: body.device_id,
      }))
    else if (segments[0] === "offline" && segments[1] === "working-set" && request.method === "GET")
      ({ data: result, error } = await db.rpc("api_offline_working_set"))
    else return routeNotFound(request, correlationId)
  } catch {
    return json(request, { error: "Invalid request" }, 400, correlationId)
  }
  return { data: result, error }
})

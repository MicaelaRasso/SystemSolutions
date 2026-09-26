import { isValveUpdatePayload } from "../_shared/validation.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("asset-access", async ({ request, route, body, db, correlationId }) => {
  const segments = route

  if (segments[0] === "yacimientos" && request.method === "GET" && !segments[1])
    return db.rpc("api_yacimientos")
  if (segments[0] === "yacimientos" && request.method === "POST" && !segments[1])
    return db.rpc("api_create_yacimiento", {
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    })
  if (segments[0] === "yacimientos" && request.method === "PATCH" && segments[1] && !segments[2])
    return db.rpc("api_update_yacimiento", {
      target: segments[1],
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    })
  if (
    segments[0] === "yacimientos" &&
    segments[1] &&
    segments[2] === "tree" &&
    request.method === "GET"
  )
    return db.rpc("api_yacimiento_tree", { target: segments[1] })
  if (
    segments[0] === "yacimientos" &&
    segments[1] &&
    segments[2] === "assignment" &&
    request.method === "GET"
  )
    return db.rpc("api_assignment", { target: segments[1] })
  if (segments[0] === "hierarchy" && request.method === "POST")
    return db.rpc("api_create_descendant", {
      kind: body.kind,
      parent_id: body.parent_id,
      asset_name: body.name,
    })
  if (segments[0] === "hierarchy" && request.method === "PATCH" && segments[1])
    return db.rpc("api_update_descendant", {
      kind: body.kind,
      target: segments[1],
      asset_name: body.name,
    })
  if (segments[0] === "valves" && request.method === "GET" && segments[1] && !segments[2])
    return db.rpc("api_valvula", {
      target: segments[1],
    })
  if (segments[0] === "valves" && request.method === "PATCH" && segments[1] && !segments[2]) {
    if (!isValveUpdatePayload(body))
      return json(request, { error: "Invalid valve update payload" }, 400, correlationId)
    return db.rpc("api_update_valvula", {
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
    })
  }

  return routeNotFound(request, correlationId)
})

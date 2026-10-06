import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { isUuid } from "../_shared/route.ts"
import { uploadStorageObject, validateStorageObject } from "../_shared/storage.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

export const offlineSyncHandler: RouteHandler = async ({ request, route, body, db, correlationId }) => {
  const segments = route

  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "media"
  ) {
    const file = body.file instanceof File ? body.file : null
    const visitId = segments[1]
    const mediaId = typeof body.media_id === "string" ? body.media_id : ""
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    const operationId = typeof body.operation_id === "string" ? body.operation_id : ""
    const kind = body.kind === "signature" ? "signature" : body.kind === "photo" ? "photo" : null
    const party = body.party === "tecnico" || body.party === "cliente" ? body.party : null
    if (!file) throw new HttpError(400, "A media file is required")
    if (![visitId, mediaId, deviceId, operationId].every(isUuid))
      throw new HttpError(400, "Media identifiers must be UUIDs")
    if (!kind || (kind === "signature" && !party))
      throw new HttpError(400, "A valid media kind and signature party are required")

    const claim = await db.rpc("api_claim_visit_device", {
      target_visit: visitId,
      target_device: deviceId,
    })
    if (claim.error) return claim

    const validation = validateStorageObject(
      { objectName: "placeholder", contentType: file.type, size: file.size },
      { maxBytes: 10 * 1024 * 1024 },
    )
    if (!validation.ok) return json(request, { error: validation.error }, 400, correlationId)
    const extension =
      validation.metadata.contentType === "image/jpeg"
        ? "jpg"
        : validation.metadata.contentType === "image/png"
          ? "png"
          : "webp"
    const bucket = kind === "signature" ? "certificate-signatures" : "certificate-evidence"
    const objectPath =
      kind === "signature"
        ? `visits/${visitId}/${party}/${mediaId}.${extension}`
        : `visits/${visitId}/evidence/${mediaId}.${extension}`
    await uploadStorageObject(bucket, objectPath, file)
    return {
      data: {
        media_id: mediaId,
        image_id: mediaId,
        bucket,
        object_path: objectPath,
        content_type: validation.metadata.contentType,
        server_received_at: new Date().toISOString(),
      },
      error: null,
    }
  }

  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "claim"
  )
    return db.rpc("api_claim_visit_device", {
      target_visit: segments[1],
      target_device: body.device_id,
    })
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

  if (segments[0] === "offline" && segments[1] === "working-set" && request.method === "POST") {
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    if (!isUuid(deviceId)) throw new HttpError(400, "A valid device_id is required")
    return db.rpc("api_offline_working_set_for_device", { target_device: deviceId })
  }

  return routeNotFound(request, correlationId)
}

serveFunction("offline-sync", offlineSyncHandler)

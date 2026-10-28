import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { isUuid } from "../_shared/route.ts"
import { uploadStorageObject, validateStorageObject } from "../_shared/storage.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

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
    const category = typeof body.category === "string" ? body.category : ""
    if (!file) throw new HttpError(400, "A media file is required")
    if (![visitId, mediaId, deviceId, operationId].every(isUuid))
      throw new HttpError(400, "Media identifiers must be UUIDs")
    if (!kind)
      throw new HttpError(400, "A valid media kind is required")
    if (kind === "signature" && (!party || (category && category !== `firma_${party}`)))
      throw new HttpError(400, "A signature category must match its party")
    if (kind === "photo" && !["desarmada", "ensamblada_prueba", "placa_precinto", "parte_diario"].includes(category))
      throw new HttpError(400, "A valid certificate evidence category is required")

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
        : category === "parte_diario"
          ? `visits/${visitId}/parte-diario/${mediaId}.${extension}`
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
  ) {
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    if (!isUuid(segments[1]) || !isUuid(deviceId))
      throw new HttpError(400, "A valid visit id and device_id are required")
    return db.rpc("api_claim_visit_device", {
      target_visit: segments[1],
      target_device: deviceId,
    })
  }
  if (
    segments[0] === "visits" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "sync"
  ) {
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    if (!isUuid(segments[1]) || !isUuid(deviceId))
      throw new HttpError(400, "A valid visit id and device_id are required")
    if (!Array.isArray(body.operations))
      throw new HttpError(400, "An operations array is required")
    const operations = body.operations
    const groups: Array<{ isParteDiario: boolean; operations: unknown[] }> = []
    for (const operation of operations) {
      const isParteDiario = isRecord(operation) &&
        ["set_part_diario", "attach_part_diario_image"].includes(String(operation.kind))
      const current = groups[groups.length - 1]
      if (!current || current.isParteDiario !== isParteDiario)
        groups.push({ isParteDiario, operations: [operation] })
      else current.operations.push(operation)
    }

    const responses = new Map<string, unknown>()
    let lastResult: Awaited<ReturnType<typeof db.rpc>> | null = null
    for (const group of groups) {
      const result = await db.rpc(
        group.isParteDiario ? "api_sync_visit_part_diario_batch" : "api_sync_visit_batch",
        {
          target_visit: segments[1],
          operations: group.operations,
          target_device: deviceId,
        },
      )
      if (result.error) return result
      lastResult = result
      if (!isRecord(result.data) || !Array.isArray(result.data.operations)) continue
      for (const response of result.data.operations) {
        if (isRecord(response) && typeof response.operation_id === "string")
          responses.set(response.operation_id, response)
      }
    }
    if (!lastResult) return db.rpc("api_sync_visit_batch", {
      target_visit: segments[1],
      operations: [],
      target_device: deviceId,
    })
    const orderedResponses = operations.flatMap((operation) => {
      const operationId = isRecord(operation) ? operation.operation_id : null
      const response = typeof operationId === "string" ? responses.get(operationId) : null
      return response ? [response] : []
    })
    const finalData = isRecord(lastResult.data) ? lastResult.data : {}
    return {
      data: {
        ...finalData,
        visit_id: segments[1],
        operations: orderedResponses,
        visit_acknowledgement: finalData.visit_acknowledgement ?? null,
      },
      error: null,
    }
  }
  if (segments[0] === "offline" && segments[1] === "working-set" && request.method === "GET")
    return db.rpc("api_offline_working_set")

  if (segments[0] === "offline" && segments[1] === "working-set" && request.method === "POST") {
    const deviceId = typeof body.device_id === "string" ? body.device_id : ""
    if (!isUuid(deviceId)) throw new HttpError(400, "A valid device_id is required")
    return db.rpc("api_offline_working_set_for_device", { target_device: deviceId })
  }

  if (segments[0] === "offline" && segments[1] === "conflict-outcomes" && request.method === "GET")
    return db.rpc("api_workshop_sync_conflict_outcomes")

  if (segments[0] === "conflicts" && request.method === "GET" && segments.length === 1)
    return db.rpc("api_sync_conflicts")

  if (segments[0] === "conflicts" && request.method === "GET" && segments.length === 2) {
    if (!isUuid(segments[1])) throw new HttpError(400, "A valid conflict id is required")
    return db.rpc("api_sync_conflict", { target_conflict: segments[1] })
  }

  if (segments[0] === "conflicts" && request.method === "POST" && segments[2] === "resolve") {
    const conflictId = segments[1] ?? ""
    if (!isUuid(conflictId)) throw new HttpError(400, "A valid conflict id is required")
    const action = body.action
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (action !== "accept" && action !== "reject" && action !== "correction")
      throw new HttpError(400, "Action must be accept, reject, or correction")
    if (!reason || reason.length > 1000)
      throw new HttpError(400, "A resolution reason of 1 to 1000 characters is required")
    const sourceCertificateId = body.source_certificate_id
    const providerId = body.provider_id
    const startsAt = body.starts_at
    const endsAt = body.ends_at
    if (sourceCertificateId !== undefined && (typeof sourceCertificateId !== "string" || !isUuid(sourceCertificateId)))
      throw new HttpError(400, "source_certificate_id must be a UUID")
    if (providerId !== undefined && (typeof providerId !== "string" || !isUuid(providerId)))
      throw new HttpError(400, "provider_id must be a UUID")
    if (action === "correction") {
      if (typeof providerId !== "string" || !isUuid(providerId))
        throw new HttpError(400, "A valid provider_id is required for correction")
      if (typeof startsAt !== "string" || Number.isNaN(Date.parse(startsAt)))
        throw new HttpError(400, "A valid starts_at timestamp is required for correction")
      if (typeof endsAt !== "string" || Number.isNaN(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt))
        throw new HttpError(400, "ends_at must be later than starts_at")
    }
    return db.rpc("api_resolve_sync_conflict", {
      p_target_conflict: conflictId,
      p_resolution_action: action,
      p_action_reason: reason,
      correction_source_certificate_id: typeof sourceCertificateId === "string" ? sourceCertificateId : null,
      correction_provider_id: typeof providerId === "string" ? providerId : null,
      correction_starts_at: typeof startsAt === "string" ? startsAt : null,
      correction_ends_at: typeof endsAt === "string" ? endsAt : null,
    })
  }

  return routeNotFound(request, correlationId)
}

serveFunction("offline-sync", offlineSyncHandler)

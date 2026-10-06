import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import {
  removeStorageObject,
  uploadStorageObject,
  validateStorageObject,
} from "../_shared/storage.ts"
import { isUuid } from "../_shared/route.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const SIGNATURE_BUCKET = "certificate-signatures"

const signatureCaptureMethod = (party: unknown, requested: unknown): string => {
  if (party === "tecnico") {
    if (requested !== undefined && requested !== "pwa_tecnico")
      throw new HttpError(400, "Invalid Técnico capture method")
    return "pwa_tecnico"
  }
  if (party !== "cliente") throw new HttpError(400, "Invalid signature party")
  if (requested === undefined) return "pwa_cliente_presencial"
  if (requested !== "pwa_cliente_presencial" && requested !== "panel_cliente")
    throw new HttpError(400, "Invalid Cliente capture method")
  return requested
}

const signatureExtension = (contentType: string) =>
  (({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }) as Record<string, string>)[
    contentType
  ] ?? "png"

export const certificateFieldHandler: RouteHandler = async ({
  request,
  route,
  body,
  db,
  correlationId,
}) => {
  const segments = route

  if (
    segments[0] === "certificate-templates" &&
    request.method === "GET" &&
    segments[1] === "active" &&
    segments.length === 2
  )
    return db.rpc("api_active_certificate_template")

  if (segments[0] === "certificate-templates" && request.method === "GET" && segments.length === 1)
    return db.rpc("api_certificate_templates")

  if (segments[0] === "certificate-templates" && request.method === "POST" && segments.length === 1)
    return db.rpc("api_create_certificate_template", {
      template_version: body.version,
      template_fields: body.campos ?? [],
    })

  if (
    segments[0] === "certificate-templates" &&
    request.method === "PATCH" &&
    segments.length === 2
  )
    return db.rpc("api_update_certificate_template", {
      target: segments[1],
      template_version: body.version,
      template_fields: body.campos ?? [],
    })

  if (
    segments[0] === "certificate-templates" &&
    request.method === "POST" &&
    segments[2] === "activate" &&
    segments.length === 3
  )
    return db.rpc("api_activate_certificate_template", { target: segments[1] })

  if (
    segments[0] === "certificate-capture" &&
    segments[1] === "catalogs" &&
    request.method === "GET" &&
    segments.length === 2
  )
    return db.rpc("api_certificate_capture_catalogs")

  if (
    segments[0] === "work-orders" &&
    request.method === "POST" &&
    segments[1] &&
    segments[2] === "certificate-draft"
  ) {
    if (typeof body.source_certificate_id === "string")
      return db.rpc("api_create_certificate_replacement", {
        source_certificate_id: body.source_certificate_id,
        work_order_id: segments[1],
        reason: body.reason ?? "correccion",
      })
    return db.rpc("api_start_certificate_draft", {
      work_order_id: segments[1],
    })
  }
  if (
    segments[0] === "clients" &&
    request.method === "GET" &&
    segments[1] === "me" &&
    segments[2] === "pending-certificates"
  )
    return db.rpc("api_cliente_pending_certificates")
  if (segments[0] === "certificates" && request.method === "GET" && segments[1] && !segments[2])
    return db.rpc("api_certificate_draft", {
      certificate_id: segments[1],
    })
  if (segments[0] === "certificates" && request.method === "POST" && segments[1] && segments[2] === "corrections" && segments.length === 3) {
    if (!isUuid(segments[1]) || typeof body.provider_id !== "string" || !isUuid(body.provider_id) ||
      typeof body.starts_at !== "string" || typeof body.ends_at !== "string" ||
      Number.isNaN(Date.parse(body.starts_at)) || Number.isNaN(Date.parse(body.ends_at)) ||
      typeof body.reason !== "string" || !body.reason.trim())
      throw new HttpError(400, "A source certificate, Taller Móvil, visit window, and reason are required")
    return db.rpc("api_authorize_certificate_correction", {
      source_certificate_id: segments[1],
      provider_id: body.provider_id,
      visit_starts_at: body.starts_at,
      visit_ends_at: body.ends_at,
      action_reason: body.reason.trim(),
    })
  }
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
    segments[0] === "certificates" &&
    request.method === "GET" &&
    segments[1] &&
    segments[2] === "download"
  )
    return db.rpc("api_cliente_certificate_export", {
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
  ) {
    if (!isUuid(segments[1])) throw new HttpError(400, "visitId must be a UUID")
    const file = body.file instanceof File ? body.file : null
    if (!file)
      return json(request, { error: "A signature image file is required" }, 400, correlationId)

    const party = body.party
    const signerName = typeof body.signer_name === "string" ? body.signer_name.trim() : ""
    if (!signerName)
      return json(request, { error: "A signer name is required" }, 400, correlationId)
    const captureMethod = signatureCaptureMethod(party, body.capture_method)
    const objectName = `visits/${segments[1]}/${party}/${crypto.randomUUID()}.${signatureExtension(file.type)}`
    const validation = validateStorageObject({
      objectName,
      contentType: file.type,
      size: file.size,
    })
    if (!validation.ok) return json(request, { error: validation.error }, 400, correlationId)

    await uploadStorageObject(SIGNATURE_BUCKET, validation.metadata.objectName, file)
    const result = await db.rpc("api_submit_visit_signature", {
      target_visit: segments[1],
      signing_party: party,
      signer_name: signerName,
      bucket_name: SIGNATURE_BUCKET,
      asset_path: validation.metadata.objectName,
      capture_method: captureMethod,
    })
    if (result.error) {
      try {
        await removeStorageObject(SIGNATURE_BUCKET, validation.metadata.objectName)
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            event: "certificate_signature_cleanup_failed",
            visitId: segments[1],
            objectName: validation.metadata.objectName,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          }),
        )
      }
    }
    return result
  }

  return routeNotFound(request, correlationId)
}

serveFunction("certificate-field", certificateFieldHandler)

import type { RpcResult, ServiceRoleClient } from "../_shared/db.ts"
import { HttpError } from "../_shared/errors.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import {
  createSignedStorageUrl,
  removeStorageObject,
  uploadStorageObject,
  validateStorageObject,
} from "../_shared/storage.ts"
import { isUuid } from "../_shared/route.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const SIGNATURE_BUCKET = "certificate-signatures"

/** Buckets de imágenes que muestra el certificado; los adjuntos privados nunca se firman acá. */
const CERTIFICATE_IMAGE_BUCKETS = new Set(["certificate-evidence", SIGNATURE_BUCKET, "client-logos"])

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * D7: las lecturas del certificado devuelven referencias de Storage (`bucket`, `object_path`) sin
 * dirección, y la vista no podía mostrar firmas ni fotos. Se agrega una `url` firmada (1 h) a cada
 * referencia de imagen del certificado. Si Storage falla, la referencia queda sin `url` y la vista
 * muestra «Foto registrada» en lugar de cortar la lectura.
 */
const withSignedImageUrls = async (
  value: unknown,
  cache = new Map<string, Promise<string | null>>(),
): Promise<unknown> => {
  if (Array.isArray(value)) return Promise.all(value.map((item) => withSignedImageUrls(item, cache)))
  if (!isPlainRecord(value)) return value
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await withSignedImageUrls(item, cache)] as const),
  )
  const result: Record<string, unknown> = Object.fromEntries(entries)
  const { bucket, object_path: objectPath } = value
  if (
    typeof bucket === "string" &&
    CERTIFICATE_IMAGE_BUCKETS.has(bucket) &&
    typeof objectPath === "string" &&
    objectPath !== "" &&
    result.url === undefined
  ) {
    const key = `${bucket}/${objectPath}`
    if (!cache.has(key)) cache.set(key, createSignedStorageUrl(bucket, objectPath).catch(() => null))
    const url = await cache.get(key)
    if (url) result.url = url
  }
  return result
}

const withSignedCertificateImages = async (read: PromiseLike<RpcResult>): Promise<RpcResult> => {
  const result = await read
  if (result.error) return result
  return { data: await withSignedImageUrls(result.data), error: null }
}

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

/** Tope de Válvulas por pedido del historial en lote. */
const MAX_VALVE_HISTORIES = 200
/** Consultas simultáneas a la base por pedido. */
const VALVE_HISTORY_CONCURRENCY = 8

/**
 * Historial de varias Válvulas en un solo pedido: el portal del Cliente pedía uno por Válvula.
 * Cada historial pasa por el mismo RPC (y la misma autorización) que `GET valves/:id/certificates`;
 * las Válvulas cuya consulta falla se informan en `failed_valve_ids` y no cortan el resto.
 */
const valveHistories = async (
  db: ServiceRoleClient,
  requested: unknown,
): Promise<RpcResult> => {
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > MAX_VALVE_HISTORIES ||
    !requested.every((id) => typeof id === "string" && isUuid(id))
  )
    throw new HttpError(400, `valve_ids must be 1 to ${MAX_VALVE_HISTORIES} valve UUIDs`)
  const ids = [...new Set(requested as string[])]
  const results: (RpcResult | null)[] = new Array(ids.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const index = next++
      results[index] = await db.rpc("api_valvula_certificates_by_pd", {
        target_valvula: ids[index],
        pd_code: null,
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(VALVE_HISTORY_CONCURRENCY, ids.length) }, worker))
  const histories: Record<string, unknown>[] = []
  const failed: string[] = []
  ids.forEach((id, index) => {
    const result = results[index]
    if (result && !result.error && isPlainRecord(result.data)) histories.push({ valve_id: id, ...result.data })
    else failed.push(id)
  })
  return { data: { histories, failed_valve_ids: failed }, error: null }
}

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
    return withSignedCertificateImages(
      db.rpc("api_finalized_certificate", {
        certificate_id: segments[1],
      }),
    )
  if (
    segments[0] === "certificates" &&
    request.method === "GET" &&
    segments[1] &&
    segments[2] === "download"
  )
    return withSignedCertificateImages(
      db.rpc("api_cliente_certificate_export", {
        certificate_id: segments[1],
      }),
    )
  if (
    segments[0] === "certificates" &&
    segments[1] === "valve-histories" &&
    segments.length === 2 &&
    request.method === "POST"
  ) {
    return valveHistories(db, body.valve_ids)
  }
  if (
    segments[0] === "valves" &&
    request.method === "GET" &&
    segments[1] &&
    segments[2] === "certificates"
  ) {
    if (!isUuid(segments[1])) throw new HttpError(400, "valveId must be a UUID")
    const requestedCode = new URL(request.url).searchParams.get("pd_code")
    const pdCode = requestedCode?.trim() || null
    if (pdCode !== null && !/^[A-Za-z0-9]+$/.test(pdCode))
      throw new HttpError(400, "pd_code must be alphanumeric")
    return db.rpc("api_valvula_certificates_by_pd", {
      target_valvula: segments[1],
      pd_code: pdCode,
    })
  }
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
    // Si la firma de esa parte ya estaba registrada, el RPC devuelve la registrada y la imagen
    // recién subida queda sin usar: se borra igual que cuando el registro falla (P1).
    const alreadyRegistered =
      !result.error &&
      typeof result.data === "object" &&
      result.data !== null &&
      (result.data as Record<string, unknown>).already_registered === true
    if (result.error || alreadyRegistered) {
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

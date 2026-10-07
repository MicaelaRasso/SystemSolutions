import { HttpError } from "../_shared/errors.ts"
import { routeNotFound } from "../_shared/http.ts"
import { runtimeEnv } from "../_shared/runtime-env.ts"
import { handleRequest, type RouteHandler } from "../_shared/transport.ts"
import { createServiceRoleClient } from "../_shared/db.ts"
import { isUuid } from "../_shared/route.ts"

type Delivery = {
  id: string
  notification_type: "certificate_expiry" | "pending_signature"
  recipient_email: string | null
  subject: string
  payload: Record<string, unknown>
  attempt_count: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;")

const absolutePortalUrl = (env: Record<string, string | undefined>) => {
  if (!env.APP_BASE_URL) throw new HttpError(500, "APP_BASE_URL is not configured")
  return new URL("/portal/certificados", env.APP_BASE_URL).toString()
}

const messageParts = (delivery: Delivery, env: Record<string, string | undefined>) => {
  const payload = delivery.payload
  const portalUrl = absolutePortalUrl(env)
  const deposit = String(payload.yacimiento ?? "Yacimiento")
  const plantList = Array.isArray(payload.plantas)
    ? payload.plantas.map((plant) => String(plant)).filter(Boolean)
    : []
  const plantNames = plantList.length ? plantList.join(", ") : "las plantas informadas en la visita"
  const isPendingSignature = delivery.notification_type === "pending_signature"
  const title = isPendingSignature ? "Tenés certificados pendientes de firma" : "Próximo vencimiento de certificado"
  const description = isPendingSignature
    ? `La visita de ${deposit} se cerró sin la firma del Cliente. Hay certificados pendientes para ${plantNames}. Ingresá al portal y agregá la firma.`
    : `El certificado ${payload.numero ? `N.º ${payload.numero}` : ""} de ${deposit}, ${payload.planta ?? ""} vence el ${payload.vigencia_hasta ?? ""}. Ingresá al portal para consultar el certificado.`
  const text = `SYSTEM SOLUTIONS\n\n${title}\n\n${description}\n\nAbrir certificados: ${portalUrl}\n\nEste mensaje fue enviado automáticamente por System Solutions.`
  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#142c4c">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
          <tr><td style="background:#102b4e;padding:24px 32px">
            <div style="font-size:22px;letter-spacing:1px;font-weight:700;color:#fff">SYSTEM <span style="color:#39c5de">SOLUTIONS</span></div>
            <div style="margin-top:5px;color:#c9d7e6;font-size:12px">Servicio y certificación industrial</div>
          </td></tr>
          <tr><td style="padding:36px 32px 28px">
            <div style="width:42px;height:4px;background:#35bfd8;border-radius:3px;margin-bottom:22px"></div>
            <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;color:#102b4e">${escapeHtml(title)}</h1>
            <p style="font-size:16px;line-height:1.65;margin:0 0 26px;color:#344b64">${escapeHtml(description)}</p>
            <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#087fa3;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:8px">Ver certificados</a>
            <p style="font-size:13px;line-height:1.6;color:#60758b;margin:26px 0 0">Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br>
              <a href="${escapeHtml(portalUrl)}" style="color:#087fa3;word-break:break-all">${escapeHtml(portalUrl)}</a>
            </p>
          </td></tr>
          <tr><td style="background:#f7f9fb;border-top:1px solid #e7edf3;padding:18px 32px;color:#718196;font-size:12px;line-height:1.5">Este correo fue enviado automáticamente por System Solutions. Si necesitás ayuda, contactá al administrador de tu cuenta.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { text, html }
}

const smtpSend = async (delivery: Delivery, env: Record<string, string | undefined>) => {
  const host = env.SMTP_HOST ?? "smtp.resend.com"
  const port = Number(env.SMTP_PORT ?? "2587")
  if (!env.SMTP_USERNAME || !env.SMTP_PASSWORD || !env.SMTP_FROM || !delivery.recipient_email)
    throw new HttpError(500, "SMTP sender credentials or recipient are not configured")
  const nodemailer = await import("npm:nodemailer@9.0.3")
  const transporter = nodemailer.default.createTransport({
    host,
    port,
    secure: port === 465 || port === 2465,
    requireTLS: port !== 465 && port !== 2465,
    auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  const content = messageParts(delivery, env)
  try {
    return await transporter.sendMail({
      from: env.SMTP_FROM,
      to: delivery.recipient_email,
      subject: delivery.subject,
      text: content.text,
      html: content.html,
    })
  } finally {
    transporter.close()
  }
}

const adminHandler: RouteHandler = async ({ request, route, body, db }) => {
  if (route.length === 1 && route[0] === "email-deliveries" && request.method === "GET") {
    const query = new URL(request.url).searchParams
    const status = query.get("status")
    const type = query.get("type")
    const limit = Number(query.get("limit") ?? "50")
    const offset = Number(query.get("offset") ?? "0")
    if (status && !["queued", "sending", "smtp_accepted", "failed", "uncertain", "cancelled"].includes(status))
      throw new HttpError(400, "Unsupported delivery status")
    if (type && !["certificate_expiry", "pending_signature"].includes(type))
      throw new HttpError(400, "Unsupported notification type")
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
      throw new HttpError(400, "limit must be 1–100 and offset must be non-negative")
    return db.rpc("api_email_deliveries", {
      requested_status: status, requested_type: type, limit_count: limit, offset_count: offset,
    })
  }
  if (route[0] === "email-deliveries" && route.length === 2 && request.method === "GET") {
    if (!isUuid(route[1])) throw new HttpError(400, "delivery id must be a UUID")
    return db.rpc("api_email_delivery", { delivery_id: route[1] })
  }
  if (route[0] === "email-deliveries" && route.length === 3 && route[2] === "retry" && request.method === "POST") {
    if (!isUuid(route[1])) throw new HttpError(400, "delivery id must be a UUID")
    const reason = body.reason
    if (typeof reason !== "string" || reason.trim().length < 5 || reason.length > 500)
      throw new HttpError(400, "reason must contain between 5 and 500 characters")
    return db.rpc("api_retry_email_delivery", { delivery_id: route[1], retry_reason: reason.trim() })
  }
  return routeNotFound(request, "")
}

const worker = async (request: Request) => {
  const env = runtimeEnv()
  const expected = env.MAILER_WORKER_TOKEN
  if (!expected || request.headers.get("x-mailer-worker-token") !== expected)
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await request.json()
    if (isRecord(parsed)) body = parsed
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const db = await createServiceRoleClient({ actorId: "00000000-0000-0000-0000-000000000000", correlationId: crypto.randomUUID(), functionName: "email-delivery" })
  let enqueued = 0
  if (body.enqueue_expiry === true) {
    const result = await db.rpc("api_enqueue_expiring_certificate_emails")
    if (result.error) throw new HttpError(503, "Unable to enqueue certificate expiry messages")
    enqueued = Number(result.data ?? 0)
  }
  const claimed = await db.rpc("api_claim_email_deliveries", { batch_size: 4 })
  if (claimed.error) throw new HttpError(503, "Unable to claim queued email messages")
  const deliveries = Array.isArray(claimed.data) ? claimed.data as Delivery[] : []
  let accepted = 0
  let failed = 0
  let uncertain = 0
  for (const delivery of deliveries) {
    let smtpAccepted = false
    try {
      const result = await smtpSend(delivery, env)
      smtpAccepted = true
      const recorded = await db.rpc("api_record_email_delivery_result", {
        delivery_id: delivery.id, delivery_status: "smtp_accepted",
        response_text: result.response ?? "SMTP accepted message", error_text: null, retryable: false,
      })
      if (recorded.error) throw new Error("Unable to record SMTP acceptance")
      accepted++
    } catch (error) {
      const candidate = error as { responseCode?: number; command?: string; code?: string; message?: string }
      const ambiguous = smtpAccepted || candidate.command === "DATA" || candidate.code === "ETIMEDOUT" || candidate.code === "ECONNECTION" || candidate.code === "ECONNRESET"
      const temporary = typeof candidate.responseCode === "number" && candidate.responseCode >= 400 && candidate.responseCode < 500
      const status = ambiguous ? "uncertain" : "failed"
      const recorded = await db.rpc("api_record_email_delivery_result", {
        delivery_id: delivery.id, delivery_status: status,
        response_text: candidate.responseCode ? String(candidate.responseCode) : null,
        error_text: candidate.message ?? "SMTP transaction failed", retryable: temporary,
      })
      if (recorded.error) console.error("email_delivery_result_record_failed", delivery.id, recorded.error)
      if (ambiguous) uncertain++
      else failed++
    }
  }
  return Response.json({ enqueued_expiry: enqueued, claimed: deliveries.length, smtp_accepted: accepted, failed, uncertain })
}

Deno.serve(async (request) => {
  const pathname = new URL(request.url).pathname
  if (request.method === "OPTIONS") return handleRequest(request, "email-delivery", adminHandler)
  if (pathname.endsWith("/internal/process") && request.method === "POST") {
    try { return await worker(request) }
    catch (error) {
      console.error("email_delivery_worker_failed", error)
      return Response.json({ error: "Email worker failed" }, { status: 500 })
    }
  }
  return handleRequest(request, "email-delivery", adminHandler)
})

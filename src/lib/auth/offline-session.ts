import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

export const OFFLINE_SESSION_COOKIE = "systemsolutions.taller-offline-session"
export const OFFLINE_SESSION_TTL_SECONDS = 12 * 60 * 60

type OfflineSessionTicket = {
  version: 1
  accountId: string
  role: "taller"
  issuedAt: number
  expiresAt: number
}

function secret() {
  const value = process.env.OFFLINE_SESSION_SECRET
  return value && value.length >= 32 ? value : undefined
}

export function issueTallerOfflineTicket(accountId: string, now = Date.now()) {
  const key = secret()
  if (!key) return undefined

  const issuedAt = Math.floor(now / 1000)
  const ticket: OfflineSessionTicket = {
    version: 1,
    accountId,
    role: "taller",
    issuedAt,
    expiresAt: issuedAt + OFFLINE_SESSION_TTL_SECONDS,
  }
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url")
  const signature = createHmac("sha256", key).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

export function verifyTallerOfflineTicket(
  value: string | undefined,
  expectedAccountId?: string,
  now = Date.now(),
): OfflineSessionTicket | undefined {
  const key = secret()
  if (!key || !value) return undefined

  const [payload, encodedSignature, extra] = value.split(".")
  if (!payload || !encodedSignature || extra !== undefined) return undefined

  const expectedSignature = createHmac("sha256", key).update(payload).digest()
  let providedSignature: Buffer
  try {
    providedSignature = Buffer.from(encodedSignature, "base64url")
  } catch {
    return undefined
  }
  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  )
    return undefined

  let ticket: Partial<OfflineSessionTicket>
  try {
    ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OfflineSessionTicket>
  } catch {
    return undefined
  }

  const nowSeconds = Math.floor(now / 1000)
  if (
    ticket.version !== 1 ||
    typeof ticket.accountId !== "string" ||
    ticket.role !== "taller" ||
    typeof ticket.issuedAt !== "number" ||
    typeof ticket.expiresAt !== "number" ||
    ticket.issuedAt > nowSeconds ||
    ticket.expiresAt <= nowSeconds ||
    ticket.expiresAt - ticket.issuedAt > OFFLINE_SESSION_TTL_SECONDS ||
    (expectedAccountId !== undefined && ticket.accountId !== expectedAccountId)
  )
    return undefined

  return ticket as OfflineSessionTicket
}

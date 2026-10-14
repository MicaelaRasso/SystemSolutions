import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import type { Rol } from "@/lib/domain/types"

/**
 * Caché corta del rol que devuelve `GET /context` (identity-admin), para que el proxy y los
 * layouts no llamen a la Edge Function en cada navegación.
 *
 * Solo alimenta el chequeo optimista de rutas: la autorización real la siguen aplicando las
 * Edge Functions en cada request de datos. La cookie es httpOnly, está firmada con HMAC (clave
 * derivada de `OFFLINE_SESSION_SECRET`, separada de la del ticket offline), atada al `sub` y al
 * `session_id` del JWT ya verificado con `getClaims()`, y vence a los pocos minutos: un cambio de
 * rol o una cuenta deshabilitada se reflejan en la navegación a lo sumo en ese plazo. Sin secreto
 * configurado no se cachea y todo vuelve a consultar `/context`.
 */
export const CONTEXT_CACHE_COOKIE = "systemsolutions.context-cache"
export const CONTEXT_CACHE_TTL_SECONDS = 5 * 60

const ROLES: readonly Rol[] = ["superadmin", "admin", "taller", "cliente"]

type ContextCacheEntry = {
  version: 1
  sub: string
  sid: string | null
  rol: Rol
  issuedAt: number
  expiresAt: number
}

export type ContextCacheIdentity = { sub: string; sid?: string }

function key() {
  const secret = process.env.OFFLINE_SESSION_SECRET
  if (!secret || secret.length < 32) return undefined
  return createHmac("sha256", secret).update("systemsolutions.context-cache.v1").digest()
}

function sign(payload: string, signingKey: Buffer) {
  return createHmac("sha256", signingKey).update(payload).digest()
}

export function issueContextCache(
  { sub, sid, rol }: ContextCacheIdentity & { rol: Rol },
  now = Date.now(),
): string | undefined {
  const signingKey = key()
  if (!signingKey) return undefined

  const issuedAt = Math.floor(now / 1_000)
  const entry: ContextCacheEntry = {
    version: 1,
    sub,
    sid: sid ?? null,
    rol,
    issuedAt,
    expiresAt: issuedAt + CONTEXT_CACHE_TTL_SECONDS,
  }
  const payload = Buffer.from(JSON.stringify(entry)).toString("base64url")
  return `${payload}.${sign(payload, signingKey).toString("base64url")}`
}

/** Devuelve el rol cacheado solo si la cookie es auténtica, vigente y de esta misma sesión. */
export function verifyContextCache(
  value: string | undefined,
  { sub, sid }: ContextCacheIdentity,
  now = Date.now(),
): Rol | undefined {
  const signingKey = key()
  if (!signingKey || !value) return undefined

  const [payload, encodedSignature, extra] = value.split(".")
  if (!payload || !encodedSignature || extra !== undefined) return undefined

  const expected = sign(payload, signingKey)
  const provided = Buffer.from(encodedSignature, "base64url")
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined

  let entry: Partial<ContextCacheEntry>
  try {
    entry = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ContextCacheEntry>
  } catch {
    return undefined
  }

  const nowSeconds = Math.floor(now / 1_000)
  if (
    entry.version !== 1 ||
    entry.sub !== sub ||
    entry.sid !== (sid ?? null) ||
    !ROLES.includes(entry.rol as Rol) ||
    typeof entry.issuedAt !== "number" ||
    typeof entry.expiresAt !== "number" ||
    entry.issuedAt > nowSeconds ||
    entry.expiresAt <= nowSeconds ||
    entry.expiresAt - entry.issuedAt > CONTEXT_CACHE_TTL_SECONDS
  )
    return undefined

  return entry.rol
}

import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import type { Sesion } from "@/lib/domain/types"
import {
  OFFLINE_SESSION_COOKIE,
  verifyTallerOfflineTicket,
} from "@/lib/auth/offline-session"

import { getSupabaseConfig } from "./config"
import { fetchAuthenticatedContext, sesionDesdeContexto } from "./context"

/**
 * Server Components are read-only for cookies. `src/proxy.ts` refreshes and
 * persists the session first; this client only verifies the resulting JWT.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const { url, publishableKey } = getSupabaseConfig()

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
    },
  })
}

/** Verified Auth identity plus server-authorized application context. */
export async function getVerifiedSesion(): Promise<Sesion | null> {
  const cookieStore = await cookies()
  const offlineSesion = (accountId?: string): Sesion | null => {
    const ticket = verifyTallerOfflineTicket(
      cookieStore.get(OFFLINE_SESSION_COOKIE)?.value,
      accountId,
    )
    return ticket
      ? {
          usuarioId: ticket.accountId,
          rol: ticket.role,
          nombre: "",
          exp: ticket.expiresAt * 1_000,
        }
      : null
  }

  const supabase = await createClient()
  let claims: Record<string, unknown> | undefined
  try {
    const result = await supabase.auth.getClaims()
    if (!result.error) claims = result.data?.claims as Record<string, unknown> | undefined
  } catch {
    return offlineSesion()
  }

  if (typeof claims?.sub !== "string" || typeof claims.exp !== "number") return offlineSesion()

  // `getClaims` above is the identity verification step. The raw access token
  // is forwarded only to identity-admin, which verifies it again before it
  // returns the authoritative Cuenta and role context.
  let accessToken: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    accessToken = data.session?.access_token
  } catch {
    return offlineSesion(claims.sub)
  }
  if (!accessToken) return offlineSesion(claims.sub)

  const contextResult = await fetchAuthenticatedContext(accessToken)
  if (contextResult.status === "unavailable") return offlineSesion(claims.sub)
  if (contextResult.status === "denied" || contextResult.context.cuenta_id !== claims.sub)
    return null

  return sesionDesdeContexto(contextResult.context, claims.exp)
}

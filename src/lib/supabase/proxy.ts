import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import {
  CONTEXT_CACHE_COOKIE,
  CONTEXT_CACHE_TTL_SECONDS,
  issueContextCache,
  verifyContextCache,
} from "@/lib/auth/context-cache"
import type { Sesion } from "@/lib/domain/types"
import {
  OFFLINE_SESSION_COOKIE,
  OFFLINE_SESSION_TTL_SECONDS,
  issueTallerOfflineTicket,
  verifyTallerOfflineTicket,
} from "@/lib/auth/offline-session"

import { getSupabaseConfig } from "./config"
import { fetchAuthenticatedContext, sesionDesdeContexto } from "./context"

function copySessionCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie))
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header)
    if (value) to.headers.set(header, value)
  }
  return to
}

export function redirectWithSessionCookies(url: URL | string, request: NextRequest, response: NextResponse) {
  return copySessionCookies(response, NextResponse.redirect(new URL(url, request.url)))
}

export function rewriteWithSessionCookies(url: URL | string, request: NextRequest, response: NextResponse) {
  return copySessionCookies(response, NextResponse.rewrite(new URL(url, request.url)))
}

/**
 * Refreshes cookie-backed Supabase Auth state exactly once per request, then
 * obtains the role from GET /context through the Edge gateway. The role is kept
 * in a short-lived signed cookie bound to the verified JWT subject and session,
 * so most navigations skip the Edge round-trip (see `context-cache.ts`).
 */
export async function updateSupabaseSession(
  request: NextRequest,
): Promise<{ response: NextResponse; sesion: Sesion | null }> {
  const { url, publishableKey } = getSupabaseConfig()
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  const readOfflineSesion = (accountId?: string): Sesion | null => {
    const ticket = verifyTallerOfflineTicket(
      request.cookies.get(OFFLINE_SESSION_COOKIE)?.value,
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
  const setPrivateCookie = (name: string, value: string, maxAge: number) =>
    supabaseResponse.cookies.set(name, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge,
    })
  const clearOfflineTicket = () => setPrivateCookie(OFFLINE_SESSION_COOKIE, "", 0)
  const clearContextCache = () => {
    if (request.cookies.has(CONTEXT_CACHE_COOKIE)) setPrivateCookie(CONTEXT_CACHE_COOKIE, "", 0)
  }

  // Do not use getSession for identity checks: it only reads a cookie. This
  // call verifies the JWT and refreshes it when necessary.
  let claims: Record<string, unknown> | undefined
  try {
    const result = await supabase.auth.getClaims()
    if (!result.error) claims = result.data?.claims as Record<string, unknown> | undefined
  } catch {
    // A valid, server-signed offline ticket can keep a previously authorized
    // Taller Móvil session available while Supabase cannot be reached.
  }
  const subject = typeof claims?.sub === "string" ? claims.sub : undefined
  const offlineSesion = readOfflineSesion(subject)
  if (!subject || typeof claims?.exp !== "number") {
    clearContextCache()
    return { response: supabaseResponse, sesion: offlineSesion }
  }

  const exp = claims.exp
  const identity = {
    sub: subject,
    sid: typeof claims.session_id === "string" ? claims.session_id : undefined,
  }
  const cachedRol = verifyContextCache(request.cookies.get(CONTEXT_CACHE_COOKIE)?.value, identity)
  if (cachedRol) {
    // Fast path: no Edge round-trip. The offline ticket is left as issued on the
    // last /context check, which happened at most CONTEXT_CACHE_TTL_SECONDS ago.
    return {
      response: supabaseResponse,
      sesion: { usuarioId: subject, rol: cachedRol, nombre: "", exp: exp * 1_000 },
    }
  }

  let accessToken: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    accessToken = data.session?.access_token
  } catch {
    return { response: supabaseResponse, sesion: offlineSesion }
  }
  if (!accessToken) return { response: supabaseResponse, sesion: offlineSesion }

  const contextResult = await fetchAuthenticatedContext(accessToken)
  if (contextResult.status === "unavailable")
    return { response: supabaseResponse, sesion: offlineSesion }
  if (contextResult.status === "denied" || contextResult.context.cuenta_id !== subject) {
    clearOfflineTicket()
    clearContextCache()
    return { response: supabaseResponse, sesion: null }
  }

  const { context } = contextResult
  if (context.rol === "taller_movil") {
    const ticket = issueTallerOfflineTicket(context.cuenta_id)
    if (ticket) setPrivateCookie(OFFLINE_SESSION_COOKIE, ticket, OFFLINE_SESSION_TTL_SECONDS)
  } else {
    clearOfflineTicket()
  }

  const sesion = sesionDesdeContexto(context, exp)
  const cache = issueContextCache({ ...identity, rol: sesion.rol })
  if (cache) {
    // Also forward it to this request's Server Components, so `requerirSesion`
    // in the layouts reuses this check instead of calling /context again.
    request.cookies.set(CONTEXT_CACHE_COOKIE, cache)
    supabaseResponse = copySessionCookies(supabaseResponse, NextResponse.next({ request }))
    setPrivateCookie(CONTEXT_CACHE_COOKIE, cache, CONTEXT_CACHE_TTL_SECONDS)
  }

  return { response: supabaseResponse, sesion }
}

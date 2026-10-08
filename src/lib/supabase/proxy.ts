import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

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
 * obtains the role from GET /context through the Edge gateway.
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
  const clearOfflineTicket = () =>
    supabaseResponse.cookies.set(OFFLINE_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 0,
    })

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
  if (!subject || typeof claims?.exp !== "number")
    return { response: supabaseResponse, sesion: offlineSesion }

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
    return { response: supabaseResponse, sesion: null }
  }

  const { context } = contextResult
  if (context.rol === "taller_movil") {
    const ticket = issueTallerOfflineTicket(context.cuenta_id)
    if (ticket) {
      supabaseResponse.cookies.set(OFFLINE_SESSION_COOKIE, ticket, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: OFFLINE_SESSION_TTL_SECONDS,
      })
    }
  } else {
    clearOfflineTicket()
  }

  return { response: supabaseResponse, sesion: sesionDesdeContexto(context, claims.exp as number) }
}

import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import type { Sesion } from "@/lib/domain/types"

import { getSupabaseConfig } from "./config"
import { getAuthenticatedContext, sesionDesdeContexto } from "./context"

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

  // Do not use getSession for identity checks: it only reads a cookie. This
  // call verifies the JWT and refreshes it when necessary.
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims || typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return { response: supabaseResponse, sesion: null }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) return { response: supabaseResponse, sesion: null }

  const context = await getAuthenticatedContext(session.access_token)
  if (!context || context.cuenta_id !== claims.sub) return { response: supabaseResponse, sesion: null }

  return { response: supabaseResponse, sesion: sesionDesdeContexto(context, claims.exp) }
}

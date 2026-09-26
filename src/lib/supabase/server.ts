import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import type { Sesion } from "@/lib/domain/types"

import { getSupabaseConfig } from "./config"
import { getAuthenticatedContext, sesionDesdeContexto } from "./context"

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
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims

  if (error || !claims || typeof claims.sub !== "string" || typeof claims.exp !== "number") return null

  // `getClaims` above is the identity verification step. The raw access token
  // is forwarded only to service-access, which verifies it again before it
  // returns the authoritative Cuenta and role context.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) return null

  const context = await getAuthenticatedContext(session.access_token)
  if (!context || context.cuenta_id !== claims.sub) return null

  return sesionDesdeContexto(context, claims.exp)
}

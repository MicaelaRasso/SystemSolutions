import type { NextRequest } from "next/server"

import { rolesPermitidos, RUTA_INICIO } from "@/lib/domain/rules"
import {
  redirectWithSessionCookies,
  rewriteWithSessionCookies,
  updateSupabaseSession,
} from "@/lib/supabase/proxy"

/**
 * Chequeo optimista de sesión y rol. La autorización real la aplican las Edge Functions.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const { response, sesion } = await updateSupabaseSession(request)
  const redirigir = (ruta: string) => redirectWithSessionCookies(ruta, request, response)

  if (pathname === "/login") {
    return sesion ? redirigir(RUTA_INICIO[sesion.rol]) : response
  }

  if (pathname === "/") {
    return redirigir(sesion ? RUTA_INICIO[sesion.rol] : "/login")
  }

  const roles = rolesPermitidos(pathname)
  if (!roles) return response

  if (!sesion) {
    const params = new URLSearchParams({ next: pathname + search })
    return redirigir(`/login?${params}`)
  }

  if (!roles.includes(sesion.rol)) {
    return rewriteWithSessionCookies("/sin-acceso", request, response)
  }

  return response
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/cuenta/:path*",
    "/superadmin/:path*",
    "/taller/:path*",
    "/portal/:path*",
  ],
}

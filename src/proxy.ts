import { NextResponse, type NextRequest } from "next/server"

import { decodificarSesion, SESSION_COOKIE, sesionExpirada } from "@/lib/auth/session"
import { rolesPermitidos, RUTA_INICIO } from "@/lib/domain/rules"
import { usesSupabaseDataSource } from "@/lib/supabase/config"
import {
  redirectWithSessionCookies,
  rewriteWithSessionCookies,
  updateSupabaseSession,
} from "@/lib/supabase/proxy"

/**
 * Chequeo optimista de sesión y rol (Next 16: `proxy` reemplaza a `middleware`).
 * No es la barrera de seguridad: con Supabase la autorización real la dan RLS y las Edge Functions.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (usesSupabaseDataSource()) {
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

  const sesion = decodificarSesion(request.cookies.get(SESSION_COOKIE)?.value)
  const valida = sesion && !sesionExpirada(sesion) ? sesion : null

  const redirigir = (ruta: string) => {
    const res = NextResponse.redirect(new URL(ruta, request.url))
    if (sesion && !valida) res.cookies.delete(SESSION_COOKIE)
    return res
  }

  if (pathname === "/login") {
    return valida ? redirigir(RUTA_INICIO[valida.rol]) : NextResponse.next()
  }

  if (pathname === "/") {
    return redirigir(valida ? RUTA_INICIO[valida.rol] : "/login")
  }

  const roles = rolesPermitidos(pathname)
  if (!roles) return NextResponse.next()

  if (!valida) {
    const params = new URLSearchParams({ next: pathname + search })
    if (sesion) params.set("expirada", "1")
    return redirigir(`/login?${params}`)
  }

  if (!roles.includes(valida.rol)) {
    return NextResponse.rewrite(new URL("/sin-acceso", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/superadmin/:path*",
    "/taller/:path*",
    "/portal/:path*",
  ],
}

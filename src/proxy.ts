import { NextResponse, type NextRequest } from "next/server"

import { decodificarSesion, SESSION_COOKIE, sesionExpirada } from "@/lib/auth/session"
import { rolesPermitidos, RUTA_INICIO } from "@/lib/domain/rules"

/**
 * Chequeo optimista de sesión y rol (Next 16: `proxy` reemplaza a `middleware`).
 * No es la barrera de seguridad: con Supabase la autorización real la dan RLS y las Edge Functions.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
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

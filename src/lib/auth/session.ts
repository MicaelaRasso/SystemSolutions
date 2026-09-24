/**
 * Sesión simulada en cookie, legible por `proxy.ts` para redirigir por rol.
 * SOLO para el modo demo: no está firmada. En producción la reemplaza la sesión de Supabase Auth
 * y la autorización real la hacen las políticas RLS.
 */

import type { Rol, Sesion, Usuario } from "@/lib/domain/types"

export const SESSION_COOKIE = "ss_session"
export const SESSION_HORAS = 12

const ROLES: Rol[] = ["superadmin", "admin", "taller", "cliente"]

/** JSON → base64url (seguro para cookies y con soporte de acentos). */
export function codificarSesion(s: Sesion): string {
  const bytes = new TextEncoder().encode(JSON.stringify(s))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function decodificarSesion(valor: string | undefined): Sesion | null {
  if (!valor) return null
  try {
    const bin = atob(valor.replace(/-/g, "+").replace(/_/g, "/"))
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    const s = JSON.parse(json) as Sesion
    if (typeof s.usuarioId !== "string" || !ROLES.includes(s.rol) || typeof s.exp !== "number") {
      return null
    }
    return s
  } catch {
    return null
  }
}

export const sesionExpirada = (s: Sesion, ahora = Date.now()) => s.exp <= ahora

export function sesionDesdeUsuario(u: Usuario): Sesion {
  return {
    usuarioId: u.id,
    rol: u.rol,
    nombre: `${u.nombre} ${u.apellido}`.trim(),
    exp: Date.now() + SESSION_HORAS * 60 * 60 * 1000,
  }
}

// --- Solo navegador -------------------------------------------------------

export function guardarSesionCookie(s: Sesion) {
  document.cookie = `${SESSION_COOKIE}=${codificarSesion(s)}; path=/; max-age=${SESSION_HORAS * 3600}; samesite=lax`
}

export function borrarSesionCookie() {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/** Valor crudo de la cookie (string estable, apto para useSyncExternalStore). */
export function leerSesionCookieRaw(): string | null {
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  return par ? par.slice(SESSION_COOKIE.length + 1) || null : null
}

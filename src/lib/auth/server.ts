import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import type { Rol, Sesion } from "@/lib/domain/types"

import { decodificarSesion, SESSION_COOKIE, sesionExpirada } from "./session"

/** Sesión desde la cookie en Server Components. `proxy.ts` ya filtró el acceso por rol. */
export async function requerirSesion(roles: Rol[]): Promise<Sesion> {
  const sesion = decodificarSesion((await cookies()).get(SESSION_COOKIE)?.value)
  if (!sesion || sesionExpirada(sesion)) redirect("/login?expirada=1")
  if (!roles.includes(sesion.rol)) redirect("/sin-acceso")
  return sesion
}

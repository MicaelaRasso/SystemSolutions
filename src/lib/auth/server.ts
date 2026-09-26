import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import type { Rol, Sesion } from "@/lib/domain/types"
import { usesSupabaseDataSource } from "@/lib/supabase/config"
import { getVerifiedSesion } from "@/lib/supabase/server"

import { decodificarSesion, SESSION_COOKIE, sesionExpirada } from "./session"

/**
 * Verifies the production Auth JWT and gets the role from service-access.
 * The mock source retains its existing demo-cookie behavior.
 */
export async function requerirSesion(roles: Rol[]): Promise<Sesion> {
  const sesion = usesSupabaseDataSource()
    ? await getVerifiedSesion()
    : decodificarSesion((await cookies()).get(SESSION_COOKIE)?.value)

  if (!sesion || sesionExpirada(sesion)) redirect("/login?expirada=1")
  if (!roles.includes(sesion.rol)) redirect("/sin-acceso")
  return sesion
}
